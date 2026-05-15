import { randomBytes } from "node:crypto";
import type {
  ArticleEmbeddingCandidateRow,
  ArticleRepository,
  EmbeddingRepository,
  JobRepository,
  JobRow,
  VectorStore
} from "@dibao/db";
import { EmbeddingProviderError, type EmbeddingProviderAdapter } from "./embedding/types.js";
import type { EmbeddingProviderService } from "./embedding-provider-service.js";
import { PermanentJobFailure } from "./job-runner.js";
import type { ProfileService } from "./profile-service.js";
import type { RankingRecalculateJobService } from "./ranking-job-service.js";

export const EMBEDDING_GENERATE_JOB_TYPE = "embedding_generate" as const;
export const EMBEDDING_JOB_ARTICLE_LIMIT = 16;
export const EMBEDDING_TEXT_MAX_CHARS = 8_000;
export const EMBEDDING_BACKFILL_LIMIT = 1_000;

export type EmbeddingGenerateJobPayload = {
  embeddingIndexId: string;
  articleIds: string[];
};

export type EmbeddingJobServiceOptions = {
  articles: Pick<ArticleRepository, "listEmbeddingCandidates">;
  embeddings: EmbeddingRepository;
  jobs: JobRepository;
  providerService: Pick<EmbeddingProviderService, "activeProviderConfig">;
  adapter: EmbeddingProviderAdapter;
  profile?: Pick<ProfileService, "processArticleEvents">;
  rankingJobs?: Pick<RankingRecalculateJobService, "enqueueAll" | "enqueueArticles">;
  vectorStore: Pick<VectorStore, "upsertArticleVector">;
  now?: () => number;
  jobIdFactory?: () => string;
};

export class EmbeddingJobService {
  private readonly now: () => number;
  private readonly jobIdFactory: () => string;

  constructor(private readonly options: EmbeddingJobServiceOptions) {
    this.now = options.now ?? Date.now;
    this.jobIdFactory = options.jobIdFactory ?? randomJobId;
  }

  enqueueArticlesForActiveIndex(articleIds: string[]): JobRow[] {
    const active = this.options.providerService.activeProviderConfig();
    if (!active || articleIds.length === 0) {
      return [];
    }

    const candidates = this.options.articles.listEmbeddingCandidates({
      embeddingIndexId: active.index.id,
      articleIds: uniqueStrings(articleIds),
      limit: EMBEDDING_BACKFILL_LIMIT
    });

    return this.enqueueCandidates(active.index.id, candidates);
  }

  enqueueBackfillForActiveIndex(): JobRow[] {
    const active = this.options.providerService.activeProviderConfig();
    if (!active) {
      return [];
    }

    const candidates = this.options.articles.listEmbeddingCandidates({
      embeddingIndexId: active.index.id,
      limit: EMBEDDING_BACKFILL_LIMIT
    });

    return this.enqueueCandidates(active.index.id, candidates);
  }

  async handleEmbeddingGenerateJob(job: JobRow): Promise<void> {
    const payload = parseEmbeddingGeneratePayload(job.payloadJson);
    if (!payload) {
      throw new PermanentJobFailure("Invalid embedding_generate job payload");
    }

    const index = this.options.embeddings.findIndexById(payload.embeddingIndexId);
    if (!index) {
      throw new PermanentJobFailure("Embedding index not found");
    }

    if (index.status !== "active") {
      return;
    }

    const provider = this.options.embeddings.findProviderById(index.providerId);
    if (!provider || !provider.enabled) {
      return;
    }

    if (provider.type !== "openai_compatible") {
      throw new PermanentJobFailure("Embedding provider type is not supported");
    }

    const active = this.options.providerService.activeProviderConfig();
    if (!active || active.index.id !== index.id || active.provider.id !== provider.id) {
      return;
    }

    const candidates = this.options.articles.listEmbeddingCandidates({
      embeddingIndexId: index.id,
      articleIds: payload.articleIds,
      limit: EMBEDDING_JOB_ARTICLE_LIMIT
    });
    if (candidates.length === 0) {
      return;
    }

    try {
      const vectors = await this.options.adapter.embedBatch({
        provider: active.provider,
        items: candidates.map((candidate) => ({
          id: candidate.articleId,
          text: textForEmbedding(candidate)
        }))
      });
      const vectorByArticleId = new Map(vectors.map((vector) => [vector.id, vector.vector]));
      const now = this.now();
      const writtenArticleIds: string[] = [];

      for (const candidate of candidates) {
        const vector = vectorByArticleId.get(candidate.articleId);
        if (!vector) {
          throw new PermanentJobFailure("Provider response did not include every article vector");
        }

        this.options.vectorStore.upsertArticleVector({
          articleId: candidate.articleId,
          embeddingIndexId: index.id,
          vector,
          contentHash: candidate.contentHash,
          now
        });
        writtenArticleIds.push(candidate.articleId);
      }

      const profileResult = this.options.profile?.processArticleEvents(writtenArticleIds);
      if (profileResult?.profileChanged || profileResult?.feedStatsChanged) {
        this.options.rankingJobs?.enqueueAll();
      } else {
        this.options.rankingJobs?.enqueueArticles(writtenArticleIds);
      }
    } catch (error) {
      if (error instanceof PermanentJobFailure) {
        throw error;
      }
      if (error instanceof EmbeddingProviderError) {
        if (error.retryable) {
          throw error;
        }
        throw new PermanentJobFailure(error.message, error.details);
      }
      if (error instanceof Error && error.message.includes("Vector dimension mismatch")) {
        throw new PermanentJobFailure(error.message);
      }
      throw error;
    }
  }

  private enqueueCandidates(
    embeddingIndexId: string,
    candidates: ArticleEmbeddingCandidateRow[]
  ): JobRow[] {
    const openArticleIds = this.openArticleIdsForIndex(embeddingIndexId);
    const articleIds = candidates
      .map((candidate) => candidate.articleId)
      .filter((articleId) => !openArticleIds.has(articleId));
    const jobs: JobRow[] = [];
    const now = this.now();

    for (const chunk of chunks(uniqueStrings(articleIds), EMBEDDING_JOB_ARTICLE_LIMIT)) {
      if (chunk.length === 0) {
        continue;
      }

      jobs.push(
        this.options.jobs.enqueue({
          id: this.jobIdFactory(),
          type: EMBEDDING_GENERATE_JOB_TYPE,
          payloadJson: JSON.stringify({
            embeddingIndexId,
            articleIds: chunk
          } satisfies EmbeddingGenerateJobPayload),
          maxAttempts: 3,
          runAfter: now,
          now
        })
      );
    }

    return jobs;
  }

  private openArticleIdsForIndex(embeddingIndexId: string): Set<string> {
    const ids = new Set<string>();

    for (const job of this.options.jobs.listOpenByType(EMBEDDING_GENERATE_JOB_TYPE)) {
      const payload = parseEmbeddingGeneratePayload(job.payloadJson);
      if (!payload || payload.embeddingIndexId !== embeddingIndexId) {
        continue;
      }

      for (const articleId of payload.articleIds) {
        ids.add(articleId);
      }
    }

    return ids;
  }
}

export function parseEmbeddingGeneratePayload(
  payloadJson: string | null
): EmbeddingGenerateJobPayload | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 2 &&
      typeof (payload as { embeddingIndexId?: unknown }).embeddingIndexId === "string" &&
      (payload as { embeddingIndexId: string }).embeddingIndexId.trim() !== "" &&
      Array.isArray((payload as { articleIds?: unknown }).articleIds) &&
      (payload as { articleIds: unknown[] }).articleIds.length >= 1 &&
      (payload as { articleIds: unknown[] }).articleIds.length <= EMBEDDING_JOB_ARTICLE_LIMIT &&
      (payload as { articleIds: unknown[] }).articleIds.every(
        (value) => typeof value === "string" && value.trim() !== ""
      )
    ) {
      return {
        embeddingIndexId: (payload as { embeddingIndexId: string }).embeddingIndexId,
        articleIds: (payload as { articleIds: string[] }).articleIds
      };
    }
  } catch {
    return null;
  }

  return null;
}

function textForEmbedding(article: ArticleEmbeddingCandidateRow): string {
  return [article.title, article.summary, article.contentText]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, EMBEDDING_TEXT_MAX_CHARS);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function randomJobId(): string {
  return `job_embed_${randomBytes(10).toString("hex")}`;
}
