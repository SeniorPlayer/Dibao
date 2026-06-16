import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type {
  AppSettingsRepository,
  AuthCredentialRepository,
  SessionRepository
} from "@dibao/db";
import { isSqliteBusyError } from "./sqlite-errors.js";

export const AUTH_CREDENTIAL_ID = "single_user";
export const PASSWORD_ALGO = "scrypt:v1";
export const SCRYPT_N = 16_384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_SALT_BYTES = 32;
export const SCRYPT_KEYLEN = 64;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 1024;
export const USERNAME_MIN_LENGTH = 1;
export const USERNAME_MAX_LENGTH = 128;
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_AUTH_MAX_FAILED_ATTEMPTS = 5;
export const DEFAULT_AUTH_LOCKOUT_MS = 15 * 60 * 1000;
export const DEFAULT_SESSION_TOUCH_THROTTLE_MS = 5 * 60 * 1000;
export const DEFAULT_SESSION_CREATE_BUSY_RETRY_DELAYS_MS = [50, 150, 350] as const;
export const DATABASE_BUSY_RETRY_AFTER_MS = 5_000;

export type AuthSessionStatus = {
  setupCompleted: boolean;
  authenticated: boolean;
  username: string | null;
};

export type AuthSessionResult = {
  token: string;
  expiresAt: number;
};

export type AuthRequestMeta = {
  userAgent?: string | null;
  ip?: string | null;
};

export class AuthServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "AuthServiceError";
  }
}

export type AuthServiceOptions = {
  credentials: AuthCredentialRepository;
  sessions: SessionRepository;
  settings: AppSettingsRepository;
  now?: () => number;
  maxFailedLoginAttempts?: number;
  loginLockoutMs?: number;
  sessionTouchThrottleMs?: number;
  sessionCreateBusyRetryDelaysMs?: readonly number[];
  onSessionTouchError?: (error: unknown) => void;
};

export class AuthService {
  private readonly now: () => number;
  private readonly maxFailedLoginAttempts: number;
  private readonly loginLockoutMs: number;
  private readonly sessionTouchThrottleMs: number;
  private readonly sessionCreateBusyRetryDelaysMs: readonly number[];
  private readonly loginFailures = new Map<
    string,
    { firstFailedAt: number; failedAttempts: number; lockedUntil: number | null }
  >();

  constructor(private readonly options: AuthServiceOptions) {
    this.now = options.now ?? Date.now;
    this.maxFailedLoginAttempts = normalizeNonNegativeInteger(
      options.maxFailedLoginAttempts ?? readNonNegativeIntegerEnv("DIBAO_AUTH_MAX_FAILED_ATTEMPTS"),
      DEFAULT_AUTH_MAX_FAILED_ATTEMPTS
    );
    this.loginLockoutMs = normalizeNonNegativeInteger(
      options.loginLockoutMs ?? readNonNegativeIntegerEnv("DIBAO_AUTH_LOCKOUT_MS"),
      DEFAULT_AUTH_LOCKOUT_MS
    );
    this.sessionTouchThrottleMs = normalizeNonNegativeInteger(
      options.sessionTouchThrottleMs,
      DEFAULT_SESSION_TOUCH_THROTTLE_MS
    );
    this.sessionCreateBusyRetryDelaysMs =
      options.sessionCreateBusyRetryDelaysMs ?? DEFAULT_SESSION_CREATE_BUSY_RETRY_DELAYS_MS;
  }

  async setup(
    username: string,
    password: string,
    meta: AuthRequestMeta = {}
  ): Promise<AuthSessionResult> {
    const normalizedUsername = normalizeUsername(username);
    validateUsername(normalizedUsername);
    validatePassword(password);

    if (this.options.credentials.hasCredential()) {
      throw new AuthServiceError(409, "CONFLICT", "Setup has already been completed");
    }

    const now = this.now();
    const passwordHash = await hashPassword(password);
    this.options.credentials.createCredential({
      id: AUTH_CREDENTIAL_ID,
      username: normalizedUsername,
      passwordHash,
      passwordAlgo: PASSWORD_ALGO,
      now
    });
    this.options.settings.setJson("setup.completed", true, now);

    return await this.createSession(meta, now);
  }

  async login(
    username: string,
    password: string,
    meta: AuthRequestMeta = {}
  ): Promise<AuthSessionResult> {
    const normalizedUsername = normalizeUsername(username);
    validateUsernameLengthForLogin(normalizedUsername);
    validatePasswordLengthForLogin(password);
    this.assertLoginAllowed(normalizedUsername, meta);

    const credential = this.options.credentials.findCredentialByUsername(normalizedUsername);
    if (!credential) {
      if (!this.options.credentials.hasCredential()) {
        throw new AuthServiceError(409, "CONFLICT", "Setup has not been completed");
      }
      this.recordFailedLogin(normalizedUsername, meta);
      throw new AuthServiceError(401, "UNAUTHORIZED", "Invalid username or password");
    }

    const ok = await verifyPassword(password, credential.passwordHash);
    if (!ok) {
      this.recordFailedLogin(normalizedUsername, meta);
      throw new AuthServiceError(401, "UNAUTHORIZED", "Invalid username or password");
    }

    this.clearFailedLogin(normalizedUsername, meta);
    return await this.createSession(meta, this.now());
  }

  getSessionStatus(token: string | null): AuthSessionStatus {
    const setupCompleted = this.options.credentials.hasCredential();
    const authenticated = setupCompleted && this.authenticate(token);

    return {
      setupCompleted,
      authenticated,
      username: authenticated ? this.options.credentials.findCredential()?.username ?? null : null
    };
  }

  authenticate(token: string | null): boolean {
    if (!token) {
      return false;
    }

    const sessionHash = hashSessionToken(token);
    const session = this.options.sessions.findByHash(sessionHash);
    if (!session) {
      return false;
    }

    const now = this.now();
    if (session.expiresAt <= now) {
      this.options.sessions.deleteByHash(sessionHash);
      return false;
    }

    if (
      session.lastSeenAt === null ||
      now - session.lastSeenAt >= this.sessionTouchThrottleMs
    ) {
      try {
        this.options.sessions.touchSession(session.id, now);
      } catch (error) {
        if (!isSqliteBusyError(error)) {
          throw error;
        }
        this.options.onSessionTouchError?.(error);
      }
    }
    return true;
  }

  logout(token: string | null): void {
    if (!token) {
      return;
    }

    this.options.sessions.deleteByHash(hashSessionToken(token));
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
    meta: AuthRequestMeta = {}
  ): Promise<AuthSessionResult> {
    validatePasswordLengthForLogin(currentPassword);
    validatePassword(newPassword);

    const credential = this.options.credentials.findCredential();
    if (!credential) {
      throw new AuthServiceError(409, "CONFLICT", "Setup has not been completed");
    }

    const ok = await verifyPassword(currentPassword, credential.passwordHash);
    if (!ok) {
      throw new AuthServiceError(401, "UNAUTHORIZED", "Invalid current password");
    }

    this.options.credentials.updatePasswordHash(
      credential.id,
      await hashPassword(newPassword),
      PASSWORD_ALGO,
      this.now()
    );
    const now = this.now();
    this.options.sessions.deleteAll();
    return await this.createSession(meta, now);
  }

  logoutAll(): void {
    this.options.sessions.deleteAll();
  }

  deleteExpiredSessions(): void {
    this.options.sessions.deleteExpired(this.now());
  }

  private async createSession(meta: AuthRequestMeta, now: number): Promise<AuthSessionResult> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const expiresAt = now + SESSION_DURATION_MS;
    const input = {
      id: `session_${randomBytes(16).toString("hex")}`,
      sessionHash: hashSessionToken(token),
      createdAt: now,
      expiresAt,
      userAgent: normalizeUserAgent(meta.userAgent),
      ipHash: meta.ip ? hashMetadata(meta.ip) : null
    };

    for (let attempt = 0; ; attempt += 1) {
      try {
        this.options.sessions.createSession(input);
        break;
      } catch (error) {
        if (
          !isSqliteBusyError(error) ||
          attempt >= this.sessionCreateBusyRetryDelaysMs.length
        ) {
          if (isSqliteBusyError(error)) {
            throw new AuthServiceError(
              503,
              "DATABASE_BUSY",
              "Dibao is busy with background maintenance. Please try again shortly.",
              { retryAfterMs: DATABASE_BUSY_RETRY_AFTER_MS }
            );
          }
          throw error;
        }
        await delay(this.sessionCreateBusyRetryDelaysMs[attempt] ?? 0);
      }
    }

    return {
      token,
      expiresAt
    };
  }

  private assertLoginAllowed(username: string, meta: AuthRequestMeta): void {
    if (!this.loginRateLimitEnabled()) {
      return;
    }

    const state = this.loginFailures.get(this.loginFailureKey(username, meta));
    const now = this.now();
    if (!state) {
      return;
    }
    if (state.lockedUntil !== null && state.lockedUntil > now) {
      throw new AuthServiceError(429, "RATE_LIMITED", "Too many failed login attempts", {
        retryAfterMs: state.lockedUntil - now
      });
    }
    if (now - state.firstFailedAt > this.loginLockoutMs) {
      this.loginFailures.delete(this.loginFailureKey(username, meta));
    }
  }

  private recordFailedLogin(username: string, meta: AuthRequestMeta): void {
    if (!this.loginRateLimitEnabled()) {
      return;
    }

    const key = this.loginFailureKey(username, meta);
    const now = this.now();
    const state = this.loginFailures.get(key);
    const next =
      state && now - state.firstFailedAt <= this.loginLockoutMs
        ? {
            firstFailedAt: state.firstFailedAt,
            failedAttempts: state.failedAttempts + 1,
            lockedUntil: state.lockedUntil
          }
        : { firstFailedAt: now, failedAttempts: 1, lockedUntil: null };

    if (next.failedAttempts >= this.maxFailedLoginAttempts) {
      next.lockedUntil = now + this.loginLockoutMs;
    }
    this.loginFailures.set(key, next);
  }

  private clearFailedLogin(username: string, meta: AuthRequestMeta): void {
    this.loginFailures.delete(this.loginFailureKey(username, meta));
  }

  private loginFailureKey(username: string, meta: AuthRequestMeta): string {
    return `${username}:${hashMetadata(meta.ip ?? "unknown")}`;
  }

  private loginRateLimitEnabled(): boolean {
    return this.maxFailedLoginAttempts > 0 && this.loginLockoutMs > 0;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scryptBuffer(password, salt);

  return [
    "scrypt",
    "v1",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    String(SCRYPT_SALT_BYTES),
    String(SCRYPT_KEYLEN),
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join(":");
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) {
    return false;
  }

  const derived = await scryptBuffer(password, parsed.salt);
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

function parsePasswordHash(value: string): { salt: Buffer; hash: Buffer } | null {
  const parts = value.split(":");
  if (parts.length !== 9) {
    return null;
  }

  const [algo, version, n, r, p, saltBytes, keylen, salt, hash] = parts;
  if (
    algo !== "scrypt" ||
    version !== "v1" ||
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P ||
    Number(saltBytes) !== SCRYPT_SALT_BYTES ||
    Number(keylen) !== SCRYPT_KEYLEN
  ) {
    return null;
  }

  try {
    const saltBuffer = Buffer.from(salt, "base64url");
    const hashBuffer = Buffer.from(hash, "base64url");
    if (saltBuffer.length !== SCRYPT_SALT_BYTES || hashBuffer.length !== SCRYPT_KEYLEN) {
      return null;
    }
    return { salt: saltBuffer, hash: hashBuffer };
  } catch {
    return null;
  }
}

function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthServiceError(400, "VALIDATION_ERROR", "Password must be at least 8 characters", {
      field: "password",
      minLength: PASSWORD_MIN_LENGTH
    });
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new AuthServiceError(400, "VALIDATION_ERROR", "Password is too long", {
      field: "password",
      maxLength: PASSWORD_MAX_LENGTH
    });
  }
}

function normalizeUsername(username: string): string {
  return username.trim();
}

function validateUsername(username: string): void {
  if (username.length < USERNAME_MIN_LENGTH) {
    throw new AuthServiceError(400, "VALIDATION_ERROR", "Username is required", {
      field: "username",
      minLength: USERNAME_MIN_LENGTH
    });
  }

  validateUsernameLengthForLogin(username);

  if (/[\u0000-\u001f\u007f]/u.test(username)) {
    throw new AuthServiceError(400, "VALIDATION_ERROR", "Username cannot contain control characters", {
      field: "username"
    });
  }
}

function validateUsernameLengthForLogin(username: string): void {
  if (username.length > USERNAME_MAX_LENGTH) {
    throw new AuthServiceError(400, "VALIDATION_ERROR", "Username is too long", {
      field: "username",
      maxLength: USERNAME_MAX_LENGTH
    });
  }
}

function validatePasswordLengthForLogin(password: string): void {
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new AuthServiceError(400, "VALIDATION_ERROR", "Password is too long", {
      field: "password",
      maxLength: PASSWORD_MAX_LENGTH
    });
  }
}

function scryptBuffer(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      }
    );
  });
}

function normalizeUserAgent(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 512) : null;
}

function hashMetadata(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function readNonNegativeIntegerEnv(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}
