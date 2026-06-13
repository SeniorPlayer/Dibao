import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  getAppliedMigrations,
  loadDefaultMigrations,
  openDatabase,
  runMigrations
} from "@dibao/db";
import { CoreDatabaseMigrationService } from "./core-database-migration-service.js";

describe("CoreDatabaseMigrationService", () => {
  it("upgrades every historical migration prefix to the latest schema", async () => {
    const migrations = loadDefaultMigrations();
    const latestVersion = migrations.at(-1)?.version;

    for (let prefixLength = 0; prefixLength <= migrations.length; prefixLength += 1) {
      const db = openDatabase(":memory:");
      try {
        if (prefixLength > 0) {
          runMigrations(db, migrations.slice(0, prefixLength), () => 1000 + prefixLength);
        }

        const service = new CoreDatabaseMigrationService({
          db,
          migrations,
          deferMs: 0,
          now: () => 2000 + prefixLength
        });
        const initial = service.getStatus();
        expect(initial.blocking).toBe(prefixLength < migrations.length);

        const result = await service.startIfRequired();
        expect(result.blocking).toBe(false);
        expect(result.state === "completed" || result.state === "not_required").toBe(true);
        expect(getAppliedMigrations(db).at(-1)?.version).toBe(latestVersion);
        expect(result.result?.appliedNow.length ?? 0).toBe(migrations.length - prefixLength);
      } finally {
        db.close();
      }
    }
  }, 30_000);

  it("keeps migration status responsive while child-process migrations run", async () => {
    const db = openDatabase(":memory:");
    const fakeChild = createFakeChildProcess();
    const service = new CoreDatabaseMigrationService({
      db,
      databasePath: "/tmp/dibao-test.sqlite",
      migrations: [
        {
          version: "001",
          name: "one",
          sql: "create table one (id text primary key);"
        }
      ],
      deferMs: 0,
      now: () => 3000,
      spawnMigrationProcess: () => fakeChild
    });

    try {
      expect(service.getStatus()).toMatchObject({
        state: "pending",
        blocking: true
      });

      const running = service.startIfRequired();
      await Promise.resolve();

      expect(service.getStatus()).toMatchObject({
        state: "running",
        blocking: true,
        progress: {
          current: 0,
          total: 1
        }
      });

      fakeChild.stdout.write(
        `${JSON.stringify({ type: "migration_applied", index: 1, total: 1 })}\n`
      );
      fakeChild.stdout.write(`${JSON.stringify({ type: "completed", appliedNow: [] })}\n`);
      fakeChild.emit("exit", 0, null);

      await expect(running).resolves.toMatchObject({
        state: "completed",
        blocking: false,
        progress: {
          current: 1,
          total: 1,
          percent: 1
        }
      });
    } finally {
      db.close();
    }
  });
});

function createFakeChildProcess(): ChildProcess & {
  stdout: PassThrough;
  stderr: PassThrough;
} {
  const child = new EventEmitter() as ChildProcess & {
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}
