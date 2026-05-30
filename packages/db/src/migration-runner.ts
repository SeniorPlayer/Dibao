import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppliedMigration, DibaoDatabase, Migration } from "./types.js";

const initialSchemaPath = fileURLToPath(
  new URL("../migrations/001_initial_schema.sql", import.meta.url)
);
const articleStateLikesPath = fileURLToPath(
  new URL("../migrations/002_article_state_likes.sql", import.meta.url)
);
const profileEventJobsPath = fileURLToPath(
  new URL("../migrations/003_profile_event_jobs.sql", import.meta.url)
);
const recommendationV2Path = fileURLToPath(
  new URL("../migrations/004_recommendation_v2.sql", import.meta.url)
);
const recommendationV2CompletionPath = fileURLToPath(
  new URL("../migrations/005_recommendation_v2_completion.sql", import.meta.url)
);
const recommendationMaintenanceSchedulePath = fileURLToPath(
  new URL("../migrations/006_recommendation_maintenance_schedule.sql", import.meta.url)
);
const embeddingUsageAndProfileEvidenceSnapshotsPath = fileURLToPath(
  new URL("../migrations/007_embedding_usage_and_profile_evidence_snapshots.sql", import.meta.url)
);
const interestClusterLabelsPath = fileURLToPath(
  new URL("../migrations/008_interest_cluster_labels.sql", import.meta.url)
);
const interestClusterMergeCandidatesPath = fileURLToPath(
  new URL("../migrations/009_interest_cluster_merge_candidates.sql", import.meta.url)
);
const removeCorpusTopicSnapshotsPath = fileURLToPath(
  new URL("../migrations/011_remove_corpus_topic_snapshots.sql", import.meta.url)
);
const geminiEmbeddingProviderPath = fileURLToPath(
  new URL("../migrations/012_gemini_embedding_provider.sql", import.meta.url)
);
const embeddingProviderLimitsPath = fileURLToPath(
  new URL("../migrations/013_embedding_provider_limits.sql", import.meta.url)
);
const readerCommandEventsPath = fileURLToPath(
  new URL("../migrations/014_reader_command_events.sql", import.meta.url)
);
const feedFullContentModePath = fileURLToPath(
  new URL("../migrations/015_feed_full_content_mode.sql", import.meta.url)
);
const authUsernamePath = fileURLToPath(
  new URL("../migrations/016_auth_username.sql", import.meta.url)
);
const interestFamiliesPath = fileURLToPath(
  new URL("../migrations/017_interest_families.sql", import.meta.url)
);
const interestClusterCalibrationsPath = fileURLToPath(
  new URL("../migrations/018_interest_cluster_calibrations.sql", import.meta.url)
);

export function loadDefaultMigrations(): Migration[] {
  return [
    {
      version: "001",
      name: "initial_schema",
      sql: readFileSync(initialSchemaPath, "utf8")
    },
    {
      version: "002",
      name: "article_state_likes",
      sql: readFileSync(articleStateLikesPath, "utf8")
    },
    {
      version: "003",
      name: "profile_event_jobs",
      sql: readFileSync(profileEventJobsPath, "utf8")
    },
    {
      version: "004",
      name: "recommendation_v2",
      sql: readFileSync(recommendationV2Path, "utf8")
    },
    {
      version: "005",
      name: "recommendation_v2_completion",
      sql: readFileSync(recommendationV2CompletionPath, "utf8")
    },
    {
      version: "006",
      name: "recommendation_maintenance_schedule",
      sql: readFileSync(recommendationMaintenanceSchedulePath, "utf8")
    },
    {
      version: "007",
      name: "embedding_usage_and_profile_evidence_snapshots",
      sql: readFileSync(embeddingUsageAndProfileEvidenceSnapshotsPath, "utf8")
    },
    {
      version: "008",
      name: "interest_cluster_labels",
      sql: readFileSync(interestClusterLabelsPath, "utf8")
    },
    {
      version: "009",
      name: "interest_cluster_merge_candidates",
      sql: readFileSync(interestClusterMergeCandidatesPath, "utf8")
    },
    {
      version: "011",
      name: "remove_corpus_topic_snapshots",
      sql: readFileSync(removeCorpusTopicSnapshotsPath, "utf8")
    },
    {
      version: "012",
      name: "gemini_embedding_provider",
      sql: readFileSync(geminiEmbeddingProviderPath, "utf8")
    },
    {
      version: "013",
      name: "embedding_provider_limits",
      sql: readFileSync(embeddingProviderLimitsPath, "utf8")
    },
    {
      version: "014",
      name: "reader_command_events",
      sql: readFileSync(readerCommandEventsPath, "utf8")
    },
    {
      version: "015",
      name: "feed_full_content_mode",
      sql: readFileSync(feedFullContentModePath, "utf8")
    },
    {
      version: "016",
      name: "auth_username",
      sql: readFileSync(authUsernamePath, "utf8")
    },
    {
      version: "017",
      name: "interest_families",
      sql: readFileSync(interestFamiliesPath, "utf8")
    },
    {
      version: "018",
      name: "interest_cluster_calibrations",
      sql: readFileSync(interestClusterCalibrationsPath, "utf8")
    }
  ];
}

export function runMigrations(
  db: DibaoDatabase,
  migrations: readonly Migration[] = loadDefaultMigrations(),
  now: () => number = Date.now
): AppliedMigration[] {
  ensureMigrationTable(db);

  const applied = getAppliedMigrations(db);
  const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration]));
  const appliedNow: AppliedMigration[] = [];

  for (const migration of migrations) {
    const checksum = migration.checksum ?? checksumSql(migration.sql);
    const existing = appliedByVersion.get(migration.version);

    if (existing) {
      if (existing.checksum !== checksum || existing.name !== migration.name) {
        throw new Error(
          `Migration ${migration.version} has changed since it was applied`
        );
      }
      continue;
    }

    const appliedAt = now();
    const disableForeignKeys = migration.sql.includes("-- dibao: disable-foreign-keys");

    try {
      if (disableForeignKeys) {
        db.pragma("foreign_keys = OFF");
      }

      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare(
          `
            insert into schema_migrations (version, name, applied_at, checksum)
            values (?, ?, ?, ?)
          `
        ).run(migration.version, migration.name, appliedAt, checksum);
      })();
    } finally {
      if (disableForeignKeys) {
        db.pragma("foreign_keys = ON");
      }
    }

    appliedNow.push({
      version: migration.version,
      name: migration.name,
      appliedAt,
      checksum
    });
  }

  return appliedNow;
}

export function getAppliedMigrations(db: DibaoDatabase): AppliedMigration[] {
  ensureMigrationTable(db);

  return db
    .prepare(
      `
        select
          version,
          name,
          applied_at as appliedAt,
          checksum
        from schema_migrations
        order by version
      `
    )
    .all() as AppliedMigration[];
}

export function checksumSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function ensureMigrationTable(db: DibaoDatabase): void {
  db.exec(`
    create table if not exists schema_migrations (
      version text primary key,
      name text not null,
      applied_at integer not null,
      checksum text
    )
  `);
}
