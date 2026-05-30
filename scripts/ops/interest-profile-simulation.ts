import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  fromVectorBlob,
  openDatabase,
  SqliteAppSettingsRepository,
  SqliteEmbeddingRepository,
  SqliteProfileRepository,
  SqliteRankingRepository,
  type DibaoDatabase,
  type InterestClusterPolarity
} from "@dibao/db";
import { cosineSimilarity, profileAlgorithmDefaults } from "@dibao/ranking";
import { InterestClusterCalibrationService } from "../../apps/server/src/interest-cluster-calibration-service.js";
import { InterestClusterLabelService } from "../../apps/server/src/interest-cluster-label-service.js";
import { InterestFamilyService } from "../../apps/server/src/interest-family-service.js";
import { ProfileRebuildService } from "../../apps/server/src/profile-rebuild-service.js";
import { ProfileService } from "../../apps/server/src/profile-service.js";
import { RecommendationRankingService } from "../../apps/server/src/ranking-service.js";
import { SettingsService } from "../../apps/server/src/settings-service.js";

type ClusterSummary = {
  polarity: InterestClusterPolarity;
  count: number;
  singletonCount: number;
  singletonRatio: number;
  multiSampleCount: number;
  maxSampleCount: number;
  totalSampleCount: number;
  maxSampleShare: number;
};

type FamilySummary = {
  polarity: InterestClusterPolarity;
  count: number;
  topDominanceRatio: number;
  immatureRows: number;
  maxClusterCount: number;
  maxSupportArticleCount: number;
};

type GateCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

const REGRESSION_ARTICLE_IDS = [
  "article_600e233ceda31b1624d1",
  "article_7da9a5139b782bf132b1",
  "article_ee68a605f0858bff7cf2"
];

const args = parseArgs(process.argv.slice(2));
if (!args.db) {
  fail("Usage: npm run ops:simulate:interest-profile -- --db .tmp/synology-data/dibao.sqlite");
}

const sourceDbPath = resolve(args.db);
if (!existsSync(sourceDbPath)) {
  fail(`Database not found: ${sourceDbPath}`);
}

const workDir = resolve(args.outDir ?? ".tmp/interest-profile-sim");
mkdirSync(workDir, { recursive: true });
const workDbPath = resolve(
  workDir,
  `${Date.now()}-${basename(sourceDbPath).replace(/[^a-zA-Z0-9_.-]/g, "_")}`
);
copyFileSync(sourceDbPath, workDbPath);

const db = openDatabase(workDbPath, { migrate: true });
try {
  const result = runSimulation(db);
  const json = JSON.stringify(
    {
      ...result,
      sourceDbPath,
      workDbPath
    },
    null,
    2
  );
  console.log(json);
  if (!result.ok) {
    process.exitCode = 1;
  }
} finally {
  db.close();
}

function runSimulation(db: DibaoDatabase) {
  const settings = new SqliteAppSettingsRepository(db);
  const settingsService = new SettingsService({ settings });
  const embeddings = new SqliteEmbeddingRepository(db);
  const profiles = new SqliteProfileRepository(db);
  const rankings = new SqliteRankingRepository(db);
  const calibration = new InterestClusterCalibrationService({ db });
  const profile = new ProfileService({
    embeddings,
    profiles,
    getClusterLimits: () => settingsService.getSettings().ranking,
    getClusterCalibration: (embeddingIndexId) => calibration.getOrCreateCalibration(embeddingIndexId)
  });
  const labels = new InterestClusterLabelService({ db, settings });
  const families = new InterestFamilyService({
    db,
    getFamilyLimits: () => settingsService.getSettings().ranking,
    getClusterCalibration: (embeddingIndexId) => calibration.getOrCreateCalibration(embeddingIndexId)
  });
  const ranking = new RecommendationRankingService({
    db,
    embeddings,
    profiles,
    rankings,
    getRankingSettings: () => settingsService.getSettings().ranking
  });
  const rebuild = new ProfileRebuildService({
    db,
    profile,
    clusterLabels: labels,
    calibration,
    interestFamilies: families,
    ranking
  });

  const rebuildResult = rebuild.rebuildActiveIndexProfile({ chunkSize: 50 });
  const activeIndexId = rebuildResult.embeddingIndexId;
  const activeCalibration = activeIndexId
    ? calibration.getOrCreateCalibration(activeIndexId)
    : null;
  const clusterSummaries = activeIndexId ? summarizeClusters(db, activeIndexId) : [];
  const familySummaries = activeIndexId ? summarizeFamilies(db, activeIndexId) : [];
  const regression = activeIndexId
    ? regressionMatches(db, activeIndexId, REGRESSION_ARTICLE_IDS)
    : [];
  const checks = gateChecks({
    clusterSummaries,
    familySummaries,
    regression
  });

  return {
    ok: checks.every((check) => check.ok),
    activeIndexId,
    rebuildResult,
    calibration: activeCalibration
      ? {
          confidence: activeCalibration.confidence,
          positiveSampleCount: activeCalibration.positiveSampleCount,
          negativeSampleCount: activeCalibration.negativeSampleCount,
          backgroundSampleCount: activeCalibration.backgroundSampleCount,
          thresholds: activeCalibration.thresholds,
          percentiles: activeCalibration.percentiles,
          diagnostics: activeCalibration.diagnostics
        }
      : null,
    clusterSummaries,
    familySummaries,
    regression,
    checks
  };
}

function summarizeClusters(db: DibaoDatabase, embeddingIndexId: string): ClusterSummary[] {
  return (["positive", "negative"] as const).map((polarity) => {
    const rows = db
      .prepare(
        `
          select sample_count as sampleCount
          from interest_clusters
          where embedding_index_id = ?
            and polarity = ?
        `
      )
      .all(embeddingIndexId, polarity) as Array<{ sampleCount: number }>;
    const totalSampleCount = rows.reduce((sum, row) => sum + row.sampleCount, 0);
    const singletonCount = rows.filter((row) => row.sampleCount <= 1).length;
    const maxSampleCount = Math.max(0, ...rows.map((row) => row.sampleCount));
    return {
      polarity,
      count: rows.length,
      singletonCount,
      singletonRatio: ratio(singletonCount, rows.length),
      multiSampleCount: rows.filter((row) => row.sampleCount >= 2).length,
      maxSampleCount,
      totalSampleCount,
      maxSampleShare: ratio(maxSampleCount, totalSampleCount)
    };
  });
}

function summarizeFamilies(db: DibaoDatabase, embeddingIndexId: string): FamilySummary[] {
  return (["positive", "negative"] as const).map((polarity) => {
    const rows = db
      .prepare(
        `
          select
            cluster_count as clusterCount,
            support_article_count as supportArticleCount,
            source_count as sourceCount,
            maturity,
            dominance_ratio as dominanceRatio
          from interest_families
          where embedding_index_id = ?
            and polarity = ?
        `
      )
      .all(embeddingIndexId, polarity) as Array<{
      clusterCount: number;
      supportArticleCount: number;
      sourceCount: number;
      maturity: number;
      dominanceRatio: number;
    }>;
    return {
      polarity,
      count: rows.length,
      topDominanceRatio: Math.max(0, ...rows.map((row) => row.dominanceRatio)),
      immatureRows: rows.filter(
        (row) =>
          row.supportArticleCount < 2 ||
          row.maturity < 0.48 ||
          (row.clusterCount < 2 && row.supportArticleCount < 2 && row.sourceCount < 2)
      ).length,
      maxClusterCount: Math.max(0, ...rows.map((row) => row.clusterCount)),
      maxSupportArticleCount: Math.max(0, ...rows.map((row) => row.supportArticleCount))
    };
  });
}

function regressionMatches(
  db: DibaoDatabase,
  embeddingIndexId: string,
  articleIds: string[]
) {
  const clusters = db
    .prepare(
      `
        select
          ic.id,
          ic.polarity,
          ic.centroid_vector_blob as centroidVectorBlob,
          l.auto_label as autoLabel,
          l.manual_label as manualLabel,
          f.id as familyId,
          f.display_label as familyLabel
        from interest_clusters ic
        left join interest_cluster_labels l on l.cluster_id = ic.id
        left join interest_cluster_family_members m on m.cluster_id = ic.id
        left join interest_families f on f.id = m.family_id
        where ic.embedding_index_id = ?
          and ic.polarity = 'positive'
      `
    )
    .all(embeddingIndexId) as Array<{
    id: string;
    polarity: InterestClusterPolarity;
    centroidVectorBlob: Buffer;
    autoLabel: string | null;
    manualLabel: string | null;
    familyId: string | null;
    familyLabel: string | null;
  }>;
  const clusterVectors = clusters.map((cluster) => ({
    ...cluster,
    vector: fromVectorBlob(cluster.centroidVectorBlob)
  }));

  return articleIds.map((articleId) => {
    const row = db
      .prepare(
        `
          select
            a.title,
            ae.vector_blob as vectorBlob
          from articles a
          left join article_embeddings ae
            on ae.article_id = a.id
           and ae.embedding_index_id = ?
          where a.id = ?
        `
      )
      .get(embeddingIndexId, articleId) as
      | { title: string; vectorBlob: Buffer | null }
      | undefined;
    if (!row?.vectorBlob) {
      return { articleId, title: row?.title ?? null, matched: false };
    }
    const vector = fromVectorBlob(row.vectorBlob);
    const best = clusterVectors
      .map((cluster) => ({
        cluster,
        similarity: cosineSimilarity(vector, cluster.vector)
      }))
      .sort((left, right) => right.similarity - left.similarity)[0];
    const matched =
      best !== undefined &&
      best.similarity >= profileAlgorithmDefaults.positiveInterestMatchThreshold;
    return {
      articleId,
      title: row.title,
      matched,
      similarity: best?.similarity ?? null,
      clusterId: matched ? best?.cluster.id ?? null : null,
      clusterLabel: matched
        ? best?.cluster.manualLabel ?? best?.cluster.autoLabel ?? null
        : null,
      familyId: matched ? best?.cluster.familyId ?? null : null,
      familyLabel: matched ? best?.cluster.familyLabel ?? null : null
    };
  });
}

function gateChecks(input: {
  clusterSummaries: ClusterSummary[];
  familySummaries: FamilySummary[];
  regression: ReturnType<typeof regressionMatches>;
}): GateCheck[] {
  const positive = input.clusterSummaries.find((summary) => summary.polarity === "positive");
  const negative = input.clusterSummaries.find((summary) => summary.polarity === "negative");
  const positiveFamily = input.familySummaries.find((summary) => summary.polarity === "positive");
  const negativeFamily = input.familySummaries.find((summary) => summary.polarity === "negative");
  const matchedRegression = input.regression.filter((item) => item.matched);
  const regressionClusterIds = new Set(
    matchedRegression.map((item) => item.clusterId).filter(Boolean)
  );
  const regressionFamilyIds = new Set(
    matchedRegression.map((item) => item.familyId).filter(Boolean)
  );

  return [
    {
      id: "positive_not_all_singletons",
      ok:
        !positive ||
        positive.count < 5 ||
        (positive.singletonRatio <= 0.72 && positive.multiSampleCount >= 3),
      detail: positive
        ? `${positive.singletonCount}/${positive.count} positive clusters are singletons`
        : "no positive clusters"
    },
    {
      id: "negative_not_all_singletons",
      ok:
        !negative ||
        negative.count < 5 ||
        (negative.singletonRatio <= 0.84 && negative.multiSampleCount >= 2),
      detail: negative
        ? `${negative.singletonCount}/${negative.count} negative clusters are singletons`
        : "no negative clusters"
    },
    {
      id: "no_giant_positive_cluster",
      ok: !positive || positive.maxSampleShare <= 0.18 || positive.totalSampleCount < 20,
      detail: positive
        ? `largest positive cluster share ${positive.maxSampleShare.toFixed(3)}`
        : "no positive clusters"
    },
    {
      id: "no_giant_negative_cluster",
      ok: !negative || negative.maxSampleShare <= 0.24 || negative.totalSampleCount < 20,
      detail: negative
        ? `largest negative cluster share ${negative.maxSampleShare.toFixed(3)}`
        : "no negative clusters"
    },
    {
      id: "published_families_are_mature",
      ok:
        (positiveFamily?.immatureRows ?? 0) === 0 &&
        (negativeFamily?.immatureRows ?? 0) === 0,
      detail: `immature rows: positive ${positiveFamily?.immatureRows ?? 0}, negative ${
        negativeFamily?.immatureRows ?? 0
      }`
    },
    {
      id: "top_family_not_dominant",
      ok:
        (positiveFamily?.topDominanceRatio ?? 0) <= 0.55 &&
        (negativeFamily?.topDominanceRatio ?? 0) <= 0.62,
      detail: `top family dominance: positive ${(
        positiveFamily?.topDominanceRatio ?? 0
      ).toFixed(3)}, negative ${(negativeFamily?.topDominanceRatio ?? 0).toFixed(3)}`
    },
    {
      id: "regression_articles_not_same_cluster",
      ok:
        matchedRegression.length < 2 ||
        regressionClusterIds.size > 1 ||
        regressionFamilyIds.size > 1,
      detail: `${matchedRegression.length} regression articles matched ${regressionClusterIds.size} clusters and ${regressionFamilyIds.size} families`
    }
  ];
}

function parseArgs(argv: string[]): { db?: string; outDir?: string } {
  const result: { db?: string; outDir?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      result.db = argv[index + 1];
      index += 1;
    } else if (arg === "--out-dir") {
      result.outDir = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

function ratio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
