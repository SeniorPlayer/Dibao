import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checksumSql,
  getAppliedMigrations,
  loadDefaultMigrations,
  runMigrations,
  type AppliedMigration,
  type DibaoDatabase,
  type Migration
} from "@dibao/db";

export const CORE_DATABASE_MIGRATION_ID = "core-database-schema-migrations" as const;
export const CORE_DATABASE_MIGRATION_TARGET_VERSION = "0.2" as const;

export type CoreDatabaseMigrationState =
  | "not_required"
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type CoreDatabaseMigrationStep =
  | "detecting"
  | "schemaMigration"
  | "completed"
  | "failed"
  | "skipped";

export type CoreDatabaseMigrationStatus = {
  id: typeof CORE_DATABASE_MIGRATION_ID;
  targetVersion: typeof CORE_DATABASE_MIGRATION_TARGET_VERSION;
  state: CoreDatabaseMigrationState;
  blocking: boolean;
  step: CoreDatabaseMigrationStep;
  activeIndexId: null;
  reason: string | null;
  progress: {
    current: number;
    total: number;
    chunksProcessed: number;
    percent: number;
  };
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  result: {
    appliedNow: AppliedMigration[];
  } | null;
};

export type CoreDatabaseMigrationServiceOptions = {
  db: DibaoDatabase;
  databasePath?: string;
  migrations?: readonly Migration[];
  now?: () => number;
  deferMs?: number;
  runInChildProcess?: boolean;
  runnerScriptPath?: string;
  spawnMigrationProcess?: (input: {
    scriptPath: string;
    databasePath: string;
  }) => ChildProcess;
  onError?: (error: unknown) => void;
};

export class CoreDatabaseMigrationService {
  private readonly migrations: readonly Migration[];
  private readonly now: () => number;
  private readonly deferMs: number;
  private status: CoreDatabaseMigrationStatus | null = null;
  private running: Promise<CoreDatabaseMigrationStatus> | null = null;
  private activeChild: ChildProcess | null = null;

  constructor(private readonly options: CoreDatabaseMigrationServiceOptions) {
    this.migrations = options.migrations ?? loadDefaultMigrations();
    this.now = options.now ?? Date.now;
    this.deferMs = options.deferMs ?? 1500;
  }

  getStatus(): CoreDatabaseMigrationStatus {
    if (this.status?.state === "running" && this.running) {
      return this.status;
    }
    if (this.status?.state === "completed" || this.status?.state === "failed") {
      return this.status;
    }

    const detection = this.detectPendingMigrations();
    if (!detection.required) {
      this.status = statusFor({
        state: "not_required",
        blocking: false,
        step: "skipped",
        reason: detection.reason,
        total: 0,
        current: 0,
        now: this.now(),
        result: null
      });
      return this.status;
    }

    this.status = statusFor({
      state: "pending",
      blocking: true,
      step: "detecting",
      reason: detection.reason,
      total: detection.pending.length,
      current: 0,
      now: this.now(),
      result: null
    });
    return this.status;
  }

  isBlocking(): boolean {
    return this.getStatus().blocking;
  }

  startIfRequired(): Promise<CoreDatabaseMigrationStatus> {
    const status = this.getStatus();
    if (!status.blocking || status.state === "failed") {
      return Promise.resolve(status);
    }
    if (this.running) {
      return this.running;
    }

    this.running = this.runMigration(status).finally(() => {
      this.running = null;
    });
    this.running.catch((error) => this.options.onError?.(error));
    return this.running;
  }

  retry(): Promise<CoreDatabaseMigrationStatus> {
    if (this.status?.state === "failed") {
      this.status = null;
    }
    return this.startIfRequired();
  }

  stop(): void {
    if (this.activeChild && this.activeChild.exitCode === null && !this.activeChild.killed) {
      this.activeChild.kill("SIGTERM");
    }
  }

  private async runMigration(initial: CoreDatabaseMigrationStatus): Promise<CoreDatabaseMigrationStatus> {
    if (this.deferMs > 0) {
      await delay(this.deferMs);
    }

    const pending = this.detectPendingMigrations().pending;
    const startedAt = this.now();
    this.status = {
      ...initial,
      state: "running",
      blocking: true,
      step: "schemaMigration",
      progress: {
        current: 0,
        total: pending.length,
        chunksProcessed: 0,
        percent: pending.length > 0 ? 0 : 1
      },
      startedAt,
      finishedAt: null,
      error: null
    };

    try {
      const appliedNow = await this.applyMigrations(pending);
      this.status = {
        ...this.status,
        state: "completed",
        blocking: false,
        step: "completed",
        progress: progressFor(pending.length, pending.length),
        finishedAt: this.now(),
        error: null,
        result: { appliedNow }
      };
      return this.status;
    } catch (error) {
      this.status = {
        ...this.status,
        state: "failed",
        blocking: true,
        step: "failed",
        finishedAt: this.now(),
        error: error instanceof Error ? error.message : String(error)
      };
      throw error;
    }
  }

  private applyMigrations(pending: readonly Migration[]): Promise<AppliedMigration[]> {
    if (this.shouldRunInChildProcess()) {
      return this.applyMigrationsInChildProcess(pending);
    }
    return Promise.resolve(runMigrations(this.options.db, this.migrations, this.now));
  }

  private shouldRunInChildProcess(): boolean {
    if (this.options.runInChildProcess !== undefined) {
      return this.options.runInChildProcess;
    }
    return Boolean(this.options.databasePath && this.options.databasePath !== ":memory:");
  }

  private applyMigrationsInChildProcess(
    pending: readonly Migration[]
  ): Promise<AppliedMigration[]> {
    const databasePath = this.options.databasePath;
    if (!databasePath) {
      return Promise.reject(new Error("databasePath is required for child-process migrations"));
    }

    const child = (
      this.options.spawnMigrationProcess ?? spawnDefaultMigrationProcess
    )({
      scriptPath: this.options.runnerScriptPath ?? defaultRunnerScriptPath(),
      databasePath: resolve(databasePath)
    });
    this.activeChild = child;

    return new Promise((resolvePromise, reject) => {
      let stdoutBuffer = "";
      let stderr = "";
      let finalAppliedNow: AppliedMigration[] | null = null;
      let settled = false;

      child.stdout?.on("data", (chunk) => {
        stdoutBuffer += String(chunk);
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          this.handleChildMessage(line, pending, (appliedNow) => {
            finalAppliedNow = appliedNow;
          });
        }
      });

      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.once("error", (error) => {
        if (this.activeChild === child) {
          this.activeChild = null;
        }
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      child.once("exit", (code, signal) => {
        if (this.activeChild === child) {
          this.activeChild = null;
        }
        if (stdoutBuffer.trim()) {
          this.handleChildMessage(stdoutBuffer, pending, (appliedNow) => {
            finalAppliedNow = appliedNow;
          });
          stdoutBuffer = "";
        }
        if (settled) {
          return;
        }
        settled = true;
        if (code === 0) {
          resolvePromise(finalAppliedNow ?? []);
          return;
        }
        reject(
          new Error(
            `Core migration runner exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}${
              stderr.trim() ? `: ${stderr.trim()}` : ""
            }`
          )
        );
      });
    });
  }

  private handleChildMessage(
    line: string,
    pending: readonly Migration[],
    onCompleted: (appliedNow: AppliedMigration[]) => void
  ): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let message: CoreMigrationRunnerMessage;
    try {
      message = JSON.parse(trimmed) as CoreMigrationRunnerMessage;
    } catch {
      return;
    }

    if (!this.status || this.status.state !== "running") {
      return;
    }

    if (message.type === "migration_started") {
      const current = Math.max(0, message.index - 1);
      this.status = {
        ...this.status,
        progress: progressFor(current, message.total || pending.length)
      };
      return;
    }

    if (message.type === "migration_applied") {
      this.status = {
        ...this.status,
        progress: progressFor(message.index, message.total || pending.length)
      };
      return;
    }

    if (message.type === "completed") {
      onCompleted(message.appliedNow);
      this.status = {
        ...this.status,
        progress: progressFor(pending.length, pending.length)
      };
      return;
    }

    if (message.type === "failed") {
      this.status = {
        ...this.status,
        state: "failed",
        blocking: true,
        step: "failed",
        finishedAt: this.now(),
        error: message.error
      };
    }
  }

  private detectPendingMigrations(): {
    required: boolean;
    reason: string;
    pending: readonly Migration[];
  } {
    const applied = getAppliedMigrations(this.options.db);
    const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration]));
    const pending: Migration[] = [];

    for (const migration of this.migrations) {
      const checksum = migration.checksum ?? checksumSql(migration.sql);
      const existing = appliedByVersion.get(migration.version);
      if (!existing) {
        pending.push(migration);
        continue;
      }
      if (existing.checksum !== checksum || existing.name !== migration.name) {
        throw new Error(`Migration ${migration.version} has changed since it was applied`);
      }
    }

    return pending.length > 0
      ? {
          required: true,
          reason: `pending_core_migrations:${pending.map((migration) => migration.version).join(",")}`,
          pending
        }
      : { required: false, reason: "no_pending_core_migrations", pending };
  }
}

type CoreMigrationRunnerMessage =
  | {
      type: "migration_started";
      index: number;
      total: number;
    }
  | {
      type: "migration_applied";
      index: number;
      total: number;
    }
  | {
      type: "completed";
      appliedNow: AppliedMigration[];
    }
  | {
      type: "failed";
      error: string;
    };

function spawnDefaultMigrationProcess(input: {
  scriptPath: string;
  databasePath: string;
}): ChildProcess {
  return spawn(process.execPath, [...process.execArgv, input.scriptPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DIBAO_DATABASE_PATH: input.databasePath,
      DIBAO_PROCESS_ROLE: "core-migration"
    }
  });
}

function defaultRunnerScriptPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const compiled = join(currentDir, "core-migration-runner.js");
  if (existsSync(compiled)) {
    return compiled;
  }
  return join(currentDir, "core-migration-runner.ts");
}

function progressFor(current: number, total: number): CoreDatabaseMigrationStatus["progress"] {
  const normalizedTotal = Math.max(0, total);
  const normalizedCurrent = Math.max(0, Math.min(current, normalizedTotal));
  return {
    current: normalizedCurrent,
    total: normalizedTotal,
    chunksProcessed: normalizedCurrent,
    percent: normalizedTotal > 0 ? normalizedCurrent / normalizedTotal : 1
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function statusFor(input: {
  state: CoreDatabaseMigrationState;
  blocking: boolean;
  step: CoreDatabaseMigrationStep;
  reason: string;
  total: number;
  current: number;
  now: number;
  result: CoreDatabaseMigrationStatus["result"];
}): CoreDatabaseMigrationStatus {
  return {
    id: CORE_DATABASE_MIGRATION_ID,
    targetVersion: CORE_DATABASE_MIGRATION_TARGET_VERSION,
    state: input.state,
    blocking: input.blocking,
    step: input.step,
    activeIndexId: null,
    reason: input.reason,
    progress: {
      current: input.current,
      total: input.total,
      chunksProcessed: input.current,
      percent: input.total > 0 ? input.current / input.total : input.blocking ? 0 : 1
    },
    startedAt: null,
    finishedAt: input.state === "not_required" ? input.now : null,
    error: null,
    result: input.result
  };
}
