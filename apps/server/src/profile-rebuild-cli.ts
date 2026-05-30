import {
  openDatabase,
  SqliteAppSettingsRepository,
  SqliteEmbeddingRepository,
  SqliteProfileRepository,
  SqliteRankingRepository
} from "@dibao/db";
import { InterestClusterLabelService } from "./interest-cluster-label-service.js";
import { InterestClusterCalibrationService } from "./interest-cluster-calibration-service.js";
import { InterestFamilyService } from "./interest-family-service.js";
import { ProfileRebuildService } from "./profile-rebuild-service.js";
import { ProfileService } from "./profile-service.js";
import { RecommendationRankingService } from "./ranking-service.js";
import { SettingsService } from "./settings-service.js";

const dbPath = process.env.DIBAO_DATABASE_PATH;

if (!dbPath) {
  fail("DIBAO_DATABASE_PATH is required.");
}

if (process.env.DIBAO_ALLOW_PROFILE_REBUILD !== "1") {
  fail("Refusing profile rebuild without DIBAO_ALLOW_PROFILE_REBUILD=1.");
}

if (process.env.DIBAO_DB_BACKUP_CONFIRMED !== "1") {
  fail("Refusing profile rebuild without DIBAO_DB_BACKUP_CONFIRMED=1.");
}

const db = openDatabase(dbPath, { migrate: true });

try {
  const embeddings = new SqliteEmbeddingRepository(db);
  const profiles = new SqliteProfileRepository(db);
  const rankings = new SqliteRankingRepository(db);
  const settings = new SqliteAppSettingsRepository(db);
  const settingsService = new SettingsService({ settings });
  const calibration = new InterestClusterCalibrationService({ db });
  const profile = new ProfileService({
    embeddings,
    profiles,
    getClusterLimits: () => settingsService.getSettings().ranking,
    getClusterCalibration: (embeddingIndexId) => calibration.getOrCreateCalibration(embeddingIndexId)
  });
  const ranking = new RecommendationRankingService({
    db,
    embeddings,
    profiles,
    rankings,
    getRankingSettings: () => settingsService.getSettings().ranking
  });
  const clusterLabels = new InterestClusterLabelService({ db, settings });
  const interestFamilies = new InterestFamilyService({
    db,
    getFamilyLimits: () => settingsService.getSettings().ranking,
    getClusterCalibration: (embeddingIndexId) => calibration.getOrCreateCalibration(embeddingIndexId)
  });
  const rebuild = new ProfileRebuildService({
    db,
    profile,
    clusterLabels,
    calibration,
    interestFamilies,
    ranking
  });

  const result = rebuild.rebuildActiveIndexProfile({
    chunkSize: numberFromEnv(process.env.DIBAO_PROFILE_REBUILD_CHUNK_SIZE)
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
