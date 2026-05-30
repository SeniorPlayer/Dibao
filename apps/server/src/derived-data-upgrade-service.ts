import type { AppSettingsRepository, DibaoDatabase } from "@dibao/db";
import {
  type AsyncProfileRebuildInput,
  type ProfileRebuildProgress,
  type ProfileRebuildResult,
  type ProfileRebuildService
} from "./profile-rebuild-service.js";

export const DERIVED_DATA_UPGRADE_ID = "v0.1.1-interest-profile-calibration-rebuild" as const;
export const DERIVED_DATA_UPGRADE_TARGET_VERSION = "0.1.1" as const;

const DERIVED_DATA_UPGRADE_SETTING_KEY = `upgrade.derivedData.${DERIVED_DATA_UPGRADE_ID}`;
const PROFILE_REBUILD_CHUNK_SIZE = 50;

export type DerivedDataUpgradeState =
  | "not_required"
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type DerivedDataUpgradeStep =
  | "detecting"
  | ProfileRebuildProgress["step"]
  | "completed"
  | "failed"
  | "skipped";

export type DerivedDataUpgradeStatus = {
  id: typeof DERIVED_DATA_UPGRADE_ID;
  targetVersion: typeof DERIVED_DATA_UPGRADE_TARGET_VERSION;
  state: DerivedDataUpgradeState;
  blocking: boolean;
  step: DerivedDataUpgradeStep;
  activeIndexId: string | null;
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
  result: ProfileRebuildResult | null;
};

export type DerivedDataUpgradeServiceOptions = {
  db: DibaoDatabase;
  settings: AppSettingsRepository;
  profileRebuild: Pick<ProfileRebuildService, "rebuildActiveIndexProfileAsync">;
  now?: () => number;
  onError?: (error: unknown) => void;
};

export class DerivedDataUpgradeService {
  private readonly now: () => number;
  private running: Promise<DerivedDataUpgradeStatus> | null = null;

  constructor(private readonly options: DerivedDataUpgradeServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  getStatus(): DerivedDataUpgradeStatus {
    const stored = this.readStoredStatus();
    if (stored?.state === "completed" || stored?.state === "failed") {
      return stored;
    }

    if (stored?.state === "running" && this.running) {
      return stored;
    }

    const detection = this.detectRequired();
    if (!detection.required) {
      const status = statusFor({
        state: "not_required",
        blocking: false,
        step: "skipped",
        activeIndexId: detection.activeIndexId,
        reason: detection.reason,
        now: this.now()
      });
      this.writeStatus(status);
      return status;
    }

    const pending =
      stored?.state === "pending"
        ? stored
        : statusFor({
            state: "pending",
            blocking: true,
            step: "detecting",
            activeIndexId: detection.activeIndexId,
            reason: detection.reason,
            now: this.now()
          });
    this.writeStatus(pending);
    return pending;
  }

  isBlocking(): boolean {
    return this.getStatus().blocking;
  }

  startIfRequired(): Promise<DerivedDataUpgradeStatus> {
    const status = this.getStatus();
    if (!status.blocking || status.state === "failed") {
      return Promise.resolve(status);
    }
    if (this.running) {
      return this.running;
    }

    this.running = this.runUpgrade(status).finally(() => {
      this.running = null;
    });
    this.running.catch((error) => this.options.onError?.(error));
    return this.running;
  }

  retry(): Promise<DerivedDataUpgradeStatus> {
    const status = this.getStatus();
    if (status.state !== "failed") {
      return this.startIfRequired();
    }

    const pending = statusFor({
      state: "pending",
      blocking: true,
      step: "detecting",
      activeIndexId: status.activeIndexId,
      reason: status.reason ?? "retry_after_failure",
      now: this.now()
    });
    this.writeStatus(pending);
    return this.startIfRequired();
  }

  private async runUpgrade(initial: DerivedDataUpgradeStatus): Promise<DerivedDataUpgradeStatus> {
    const startedAt = this.now();
    this.writeStatus({
      ...initial,
      state: "running",
      blocking: true,
      step: "detecting",
      startedAt,
      finishedAt: null,
      error: null
    });

    try {
      const result = await this.options.profileRebuild.rebuildActiveIndexProfileAsync({
        chunkSize: PROFILE_REBUILD_CHUNK_SIZE,
        onProgress: (progress) => this.recordProgress(progress, startedAt)
      } satisfies AsyncProfileRebuildInput);
      const completed = {
        ...this.getStatus(),
        state: "completed" as const,
        blocking: false,
        step: "completed" as const,
        activeIndexId: result.embeddingIndexId,
        progress: {
          current: result.replay.articleIdsProcessed,
          total: result.replay.articleCount,
          chunksProcessed: result.replay.chunksProcessed,
          percent: 1
        },
        startedAt,
        finishedAt: this.now(),
        error: null,
        result
      };
      this.writeStatus(completed);
      return completed;
    } catch (error) {
      const failed = {
        ...this.getStatus(),
        state: "failed" as const,
        blocking: true,
        step: "failed" as const,
        startedAt,
        finishedAt: this.now(),
        error: error instanceof Error ? error.message : String(error)
      };
      this.writeStatus(failed);
      throw error;
    }
  }

  private recordProgress(progress: ProfileRebuildProgress, startedAt: number): void {
    const total = Math.max(0, progress.workUnitCount ?? progress.articleCount);
    const current = Math.min(
      total,
      Math.max(0, progress.workUnitsProcessed ?? progress.articleIdsProcessed)
    );
    this.writeStatus({
      ...this.getStatus(),
      state: "running",
      blocking: true,
      step: progress.step,
      progress: {
        current,
        total,
        chunksProcessed: progress.chunksProcessed,
        percent: total > 0 ? current / total : 0
      },
      startedAt,
      finishedAt: null,
      error: null
    });
  }

  private detectRequired(): {
    required: boolean;
    activeIndexId: string | null;
    reason: string;
  } {
    const activeIndexId = this.activeEmbeddingIndexId();
    if (!activeIndexId) {
      return { required: false, activeIndexId: null, reason: "no_active_embedding_index" };
    }

    const replayableArticles = countRow(
      this.options.db
        .prepare(
          `
            select count(distinct be.article_id) as count
            from behavior_events be
            join articles a on a.id = be.article_id
            join feeds f on f.id = a.feed_id
            join article_embeddings ae
              on ae.article_id = a.id
             and ae.embedding_index_id = ?
            where a.deleted_at is null
              and a.status != 'deleted'
              and f.deleted_at is null
              and f.enabled = 1
              and ae.vector_blob is not null
              and ae.content_hash = coalesce(a.content_hash, a.id || ':' || a.updated_at)
          `
        )
        .get(activeIndexId)
    );
    if (replayableArticles === 0) {
      return { required: false, activeIndexId, reason: "no_replayable_profile_signals" };
    }

    return { required: true, activeIndexId, reason: "v0.1.1_interest_cluster_calibration_rebuild" };
  }

  private activeEmbeddingIndexId(): string | null {
    const row = this.options.db
      .prepare(
        `
          select id
          from embedding_indexes
          where status = 'active'
          order by updated_at desc
          limit 1
        `
      )
      .get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  private readStoredStatus(): DerivedDataUpgradeStatus | null {
    const value = this.options.settings.getJson<DerivedDataUpgradeStatus>(
      DERIVED_DATA_UPGRADE_SETTING_KEY
    );
    return isDerivedDataUpgradeStatus(value) ? value : null;
  }

  private writeStatus(status: DerivedDataUpgradeStatus): void {
    this.options.settings.setJson(DERIVED_DATA_UPGRADE_SETTING_KEY, status, this.now());
  }
}

function statusFor(input: {
  state: DerivedDataUpgradeState;
  blocking: boolean;
  step: DerivedDataUpgradeStep;
  activeIndexId: string | null;
  reason: string;
  now: number;
}): DerivedDataUpgradeStatus {
  return {
    id: DERIVED_DATA_UPGRADE_ID,
    targetVersion: DERIVED_DATA_UPGRADE_TARGET_VERSION,
    state: input.state,
    blocking: input.blocking,
    step: input.step,
    activeIndexId: input.activeIndexId,
    reason: input.reason,
    progress: {
      current: 0,
      total: 0,
      chunksProcessed: 0,
      percent: 0
    },
    startedAt: null,
    finishedAt: input.state === "not_required" ? input.now : null,
    error: null,
    result: null
  };
}

function isDerivedDataUpgradeStatus(value: unknown): value is DerivedDataUpgradeStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { id?: unknown }).id === DERIVED_DATA_UPGRADE_ID &&
    typeof (value as { state?: unknown }).state === "string"
  );
}

function countRow(row: unknown): number {
  return (row as { count?: number } | undefined)?.count ?? 0;
}
