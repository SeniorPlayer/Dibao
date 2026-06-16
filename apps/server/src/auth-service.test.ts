import { describe, expect, it } from "vitest";
import type {
  AppSettingsRepository,
  AuthCredentialRepository,
  CreateAuthCredentialInput,
  CreateSessionInput,
  SessionRepository
} from "@dibao/db";
import { AuthService, AuthServiceError, hashSessionToken } from "./auth-service.js";

describe("AuthService database busy handling", () => {
  it("keeps authentication valid when session touch hits SQLITE_BUSY", () => {
    const busy = sqliteBusy();
    let touchError: unknown = null;
    const sessions = sessionRepository({
      findByHash: () => ({
        id: "session_1",
        sessionHash: hashSessionToken("token_1"),
        createdAt: 1_000,
        expiresAt: 20_000,
        lastSeenAt: 1_000,
        userAgent: null,
        ipHash: null
      }),
      touchSession: () => {
        throw busy;
      }
    });
    const service = new AuthService({
      credentials: credentialRepository(),
      sessions,
      settings: settingsRepository(),
      now: () => 10_000,
      sessionTouchThrottleMs: 1,
      onSessionTouchError: (error) => {
        touchError = error;
      }
    });

    expect(service.authenticate("token_1")).toBe(true);
    expect(touchError).toBe(busy);
  });

  it("retries session creation when SQLite is briefly busy", async () => {
    let attempts = 0;
    const sessions = sessionRepository({
      createSession: (input) => {
        attempts += 1;
        if (attempts < 3) {
          throw sqliteBusy();
        }
        return {
          ...input,
          lastSeenAt: input.createdAt,
          userAgent: input.userAgent ?? null,
          ipHash: input.ipHash ?? null
        };
      }
    });
    const service = new AuthService({
      credentials: credentialRepository(),
      sessions,
      settings: settingsRepository(),
      now: () => 1_000,
      sessionCreateBusyRetryDelaysMs: [0, 0]
    });

    await expect(service.login("Pls", "correct horse battery")).resolves.toMatchObject({
      expiresAt: 1_000 + 30 * 24 * 60 * 60 * 1000
    });
    expect(attempts).toBe(3);
  });

  it("returns a retryable service error when session creation stays busy", async () => {
    const service = new AuthService({
      credentials: credentialRepository(),
      sessions: sessionRepository({
        createSession: () => {
          throw sqliteBusy();
        }
      }),
      settings: settingsRepository(),
      sessionCreateBusyRetryDelaysMs: [0]
    });

    await expect(service.login("Pls", "correct horse battery")).rejects.toMatchObject({
      statusCode: 503,
      code: "DATABASE_BUSY",
      details: { retryAfterMs: 5_000 }
    } satisfies Partial<AuthServiceError>);
  });
});

function sqliteBusy(): Error & { code: string } {
  return Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
}

function credentialRepository(): AuthCredentialRepository {
  const credential = {
    id: "single_user",
    username: "Pls",
    passwordHash:
      "scrypt:v1:16384:8:1:32:64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:TJV6qDF43USXdhBq8qB_P2IGzUWnBU50lPgyAj7WdYpn_xJt72-Fg70b4Z09v0kgUqLGmYpRxgGpnJn9uZB-MQ",
    passwordAlgo: "scrypt:v1",
    createdAt: 1_000,
    updatedAt: 1_000
  };
  return {
    createCredential(input: CreateAuthCredentialInput) {
      return {
        id: input.id,
        username: input.username,
        passwordHash: input.passwordHash,
        passwordAlgo: input.passwordAlgo,
        createdAt: input.now ?? 0,
        updatedAt: input.now ?? 0
      };
    },
    findCredential() {
      return credential;
    },
    findCredentialByUsername(username: string) {
      return username === credential.username ? credential : null;
    },
    hasCredential() {
      return true;
    },
    updatePasswordHash() {}
  };
}

function sessionRepository(
  overrides: Partial<SessionRepository> = {}
): SessionRepository {
  return {
    createSession(input: CreateSessionInput) {
      return {
        ...input,
        lastSeenAt: input.createdAt,
        userAgent: input.userAgent ?? null,
        ipHash: input.ipHash ?? null
      };
    },
    deleteAll() {},
    deleteByHash() {},
    deleteExpired() {},
    findByHash() {
      return null;
    },
    touchSession() {},
    ...overrides
  };
}

function settingsRepository(): AppSettingsRepository {
  const values = new Map<string, unknown>();
  return {
    getJson<T>(key: string): T | null {
      return values.has(key) ? (values.get(key) as T) : null;
    },
    setJson(key, value) {
      values.set(key, value);
    },
    delete(key) {
      return values.delete(key);
    }
  };
}
