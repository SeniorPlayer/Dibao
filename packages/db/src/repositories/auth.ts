import type {
  AuthCredentialRow,
  CreateAuthCredentialInput,
  CreateSessionInput,
  DibaoDatabase,
  SessionRow
} from "../types.js";

type AuthCredentialDbRow = {
  id: string;
  username: string | null;
  passwordHash: string;
  passwordAlgo: string;
  createdAt: number;
  updatedAt: number;
};

type SessionDbRow = {
  id: string;
  sessionHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number | null;
  userAgent: string | null;
  ipHash: string | null;
};

export interface AuthCredentialRepository {
  createCredential(input: CreateAuthCredentialInput): AuthCredentialRow;
  findCredential(): AuthCredentialRow | null;
  findCredentialByUsername(username: string): AuthCredentialRow | null;
  hasCredential(): boolean;
  updatePasswordHash(id: string, passwordHash: string, passwordAlgo: string, now?: number): void;
}

export interface SessionRepository {
  createSession(input: CreateSessionInput): SessionRow;
  deleteAll(): void;
  deleteByHash(sessionHash: string): void;
  deleteExpired(now: number): void;
  findByHash(sessionHash: string): SessionRow | null;
  touchSession(id: string, lastSeenAt: number): void;
}

export class SqliteAuthCredentialRepository implements AuthCredentialRepository {
  constructor(private readonly db: DibaoDatabase) {}

  createCredential(input: CreateAuthCredentialInput): AuthCredentialRow {
    const now = input.now ?? Date.now();

    this.db
      .prepare(
        `
          insert into auth_credentials (
            id,
            username,
            password_hash,
            password_algo,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?)
        `
      )
      .run(input.id, input.username, input.passwordHash, input.passwordAlgo, now, now);

    const row = this.findCredential();
    if (!row) {
      throw new Error(`Failed to create auth credential: ${input.id}`);
    }
    return row;
  }

  findCredential(): AuthCredentialRow | null {
    const row = this.db
      .prepare(
        `
          ${baseCredentialSelect()}
          order by created_at, id
          limit 1
        `
      )
      .get() as AuthCredentialDbRow | undefined;

    return row ? mapCredential(row) : null;
  }

  findCredentialByUsername(username: string): AuthCredentialRow | null {
    const row = this.db
      .prepare(`${baseCredentialSelect()} where username = ? limit 1`)
      .get(username) as AuthCredentialDbRow | undefined;

    return row ? mapCredential(row) : null;
  }

  hasCredential(): boolean {
    const row = this.db
      .prepare("select 1 as found from auth_credentials limit 1")
      .get() as { found: 1 } | undefined;

    return Boolean(row);
  }

  updatePasswordHash(
    id: string,
    passwordHash: string,
    passwordAlgo: string,
    now = Date.now()
  ): void {
    this.db
      .prepare(
        `
          update auth_credentials
          set
            password_hash = ?,
            password_algo = ?,
            updated_at = ?
          where id = ?
        `
      )
      .run(passwordHash, passwordAlgo, now, id);
  }
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: DibaoDatabase) {}

  createSession(input: CreateSessionInput): SessionRow {
    this.db
      .prepare(
        `
          insert into sessions (
            id,
            session_hash,
            created_at,
            expires_at,
            last_seen_at,
            user_agent,
            ip_hash
          )
          values (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.id,
        input.sessionHash,
        input.createdAt,
        input.expiresAt,
        input.createdAt,
        input.userAgent ?? null,
        input.ipHash ?? null
      );

    const row = this.findByHash(input.sessionHash);
    if (!row) {
      throw new Error(`Failed to create session: ${input.id}`);
    }
    return row;
  }

  deleteByHash(sessionHash: string): void {
    this.db.prepare("delete from sessions where session_hash = ?").run(sessionHash);
  }

  deleteAll(): void {
    this.db.prepare("delete from sessions").run();
  }

  deleteExpired(now: number): void {
    this.db.prepare("delete from sessions where expires_at <= ?").run(now);
  }

  findByHash(sessionHash: string): SessionRow | null {
    const row = this.db
      .prepare(`${baseSessionSelect()} where session_hash = ?`)
      .get(sessionHash) as SessionDbRow | undefined;

    return row ? mapSession(row) : null;
  }

  touchSession(id: string, lastSeenAt: number): void {
    this.db
      .prepare("update sessions set last_seen_at = ? where id = ?")
      .run(lastSeenAt, id);
  }
}

function baseCredentialSelect(): string {
  return `
    select
      id,
      username,
      password_hash as passwordHash,
      password_algo as passwordAlgo,
      created_at as createdAt,
      updated_at as updatedAt
    from auth_credentials
  `;
}

function baseSessionSelect(): string {
  return `
    select
      id,
      session_hash as sessionHash,
      created_at as createdAt,
      expires_at as expiresAt,
      last_seen_at as lastSeenAt,
      user_agent as userAgent,
      ip_hash as ipHash
    from sessions
  `;
}

function mapCredential(row: AuthCredentialDbRow): AuthCredentialRow {
  return row;
}

function mapSession(row: SessionDbRow): SessionRow {
  return row;
}
