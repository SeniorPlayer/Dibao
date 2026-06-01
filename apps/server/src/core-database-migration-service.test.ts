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
  });
});
