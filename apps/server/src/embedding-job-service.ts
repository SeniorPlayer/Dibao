import { randomBytes } from "node:crypto";
import type {
  ArticleEmbeddingCandidateRow,
  ArticleRepository,
  EmbeddingRepository,
  JobRepository,
  JobRow,
  VectorStore
} from "@dibao/db";
import { EmbeddingProviderError } from "./embedding/types.js";
import type { EmbeddingProviderService } from "./embedding-provider-service.js";
import { PermanentJobFailure } from "./job-runner.js";
import type { ProfileService } from "./profile-service.js";
import type { RankingRecalculateJobService } from "./ranking-job-service.js";

export const EMBEDDING_GENERATE_JOB_TYPE = "embedding_generate" as const;
export const OPENAI_COMPATIBLE_EMBEDDING_BATCH_SIZE = 16;
export const OLLAMA_EMBEDDING_BATCH_SIZE = 4;
export const EMBEDDING_JOB_ARTICLE_LIMIT = OPENAI_COMPATIBLE_EMBEDDING_BATCH_SIZE;
export const EMBEDDING_TEXT_MAX_CHARS = 8_000;
export const EMBEDDING_BACKFILL_LIMIT = 1_000;

export type EmbeddingGenerateJobPayload = {
  embeddingIndexId: string;
  articleIds: string[];
};

export type EmbeddingBackfillEnqueueResult = {
  jobIds: string[];
  candidateCount: number;
  enqueuedArticleCount: number;
  dedupedArticleCount: number;
};

export type EmbeddingJobServiceOptions = {
  articles: Pick<ArticleRepository, "listEmbeddingCandidates">;
  embeddings: EmbeddingRepository;
  jobs: JobRepository;
  providerService: Pick<EmbeddingProviderService, "activeProviderConfig">;
  profile?: Pick<ProfileService, "processArticleEvents">;
  rankingJobs?: Pick<RankingRecalculateJobService, "enqueueAll" | "enqueueArticles">;
  recordUsage?: (input: {
    providerId: string;
    embeddingIndexId: string;
    model: string;
    itemCount: number;
    estimatedTokens: number;
    now: number;
  }) => void;
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

    return this.enqueueCandidates(active.index.id, candidates, embeddingBatchSizeFor(active.provider.type)).jobs;
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

    return this.enqueueCandidates(active.index.id, candidates, embeddingBatchSizeFor(active.provider.type)).jobs;
  }

  enqueueBackfillForIndex(embeddingIndexId: string): EmbeddingBackfillEnqueueResult {
    const active = this.options.providerService.activeProviderConfig();
    if (!active || active.index.id !== embeddingIndexId) {
      return {
        jobIds: [],
        candidateCount: 0,
        enqueuedArticleCount: 0,
        dedupedArticleCount: 0
      };
    }

    const candidates = this.options.articles.listEmbeddingCandidates({
      embeddingIndexId,
      limit: EMBEDDING_BACKFILL_LIMIT
    });
    const result = this.enqueueCandidates(
      embeddingIndexId,
      candidates,
      embeddingBatchSizeFor(active.provider.type)
    );

    return {
      jobIds: result.jobs.map((job) => job.id),
      candidateCount: result.candidateCount,
      enqueuedArticleCount: result.enqueuedArticleCount,
      dedupedArticleCount: result.dedupedArticleCount
    };
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
      this.enqueueNextBackfillBatchIfDrained(index.id, provider.type);
      return;
    }

    try {
      const vectors: Array<{ id: string; vector: number[] }> = [];
      for (const chunk of chunks(candidates, embeddingBatchSizeFor(provider.type))) {
        const items = chunk.map((candidate) => ({
          id: candidate.articleId,
          text: textForEmbedding(candidate)
        }));
        vectors.push(
          ...(await active.adapter.embedBatch({
            provider: active.provider,
            items
          }))
        );
        this.options.recordUsage?.({
          providerId: provider.id,
          embeddingIndexId: index.id,
          model: provider.model,
          itemCount: items.length,
          estimatedTokens: items.reduce(
            (total, item) => total + estimateEmbeddingTokens(item.text),
            0
          ),
          now: this.now()
        });
      }
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

      this.enqueueNextBackfillBatchIfDrained(index.id, provider.type);
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
    candidates: ArticleEmbeddingCandidateRow[],
    batchSize: number
  ): {
    jobs: JobRow[];
    candidateCount: number;
    enqueuedArticleCount: number;
    dedupedArticleCount: number;
  } {
    const openArticleIds = this.openArticleIdsForIndex(embeddingIndexId);
    const candidateArticleIds = uniqueStrings(candidates.map((candidate) => candidate.articleId));
    const articleIds = candidateArticleIds
      .filter((articleId) => !openArticleIds.has(articleId));
    const jobs: JobRow[] = [];
    const now = this.now();

    for (const chunk of chunks(articleIds, batchSize)) {
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

    return {
      jobs,
      candidateCount: candidateArticleIds.length,
      enqueuedArticleCount: articleIds.length,
      dedupedArticleCount: candidateArticleIds.length - articleIds.length
    };
  }

  private openArticleIdsForIndex(embeddingIndexId: string): Set<string> {
    const ids = new Set<string>();

    for (const { payload } of this.openEmbeddingJobsForIndex(embeddingIndexId)) {
      for (const articleId of payload.articleIds) {
        ids.add(articleId);
      }
    }

    return ids;
  }

  private enqueueNextBackfillBatchIfDrained(
    embeddingIndexId: string,
    providerType: string
  ): EmbeddingBackfillEnqueueResult | null {
    const openJobs = this.openEmbeddingJobsForIndex(embeddingIndexId);
    if (openJobs.length > 1) {
      return null;
    }

    const candidates = this.options.articles.listEmbeddingCandidates({
      embeddingIndexId,
      limit: EMBEDDING_BACKFILL_LIMIT
    });
    const result = this.enqueueCandidates(
      embeddingIndexId,
      candidates,
      embeddingBatchSizeFor(providerType)
    );

    return {
      jobIds: result.jobs.map((job) => job.id),
      candidateCount: result.candidateCount,
      enqueuedArticleCount: result.enqueuedArticleCount,
      dedupedArticleCount: result.dedupedArticleCount
    };
  }

  private openEmbeddingJobsForIndex(
    embeddingIndexId: string
  ): Array<{ job: JobRow; payload: EmbeddingGenerateJobPayload }> {
    const jobs: Array<{ job: JobRow; payload: EmbeddingGenerateJobPayload }> = [];

    for (const job of this.options.jobs.listOpenByType(EMBEDDING_GENERATE_JOB_TYPE)) {
      const payload = parseEmbeddingGeneratePayload(job.payloadJson);
      if (!payload || payload.embeddingIndexId !== embeddingIndexId) {
        continue;
      }

      jobs.push({ job, payload });
    }

    return jobs;
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
    .map(plainTextForEmbedding)
    .filter(Boolean)
    .join("\n\n")
    .slice(0, EMBEDDING_TEXT_MAX_CHARS);
}

function plainTextForEmbedding(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const text = decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return "\"";
    if (normalized === "apos") return "'";
    if (normalized === "nbsp") return " ";
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return decodeCodePoint(codePoint);
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return decodeCodePoint(codePoint);
    }
    return "";
  });
}

function decodeCodePoint(codePoint: number): string {
  return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "";
}

export function estimateEmbeddingTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  const cjkCount = (trimmed.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length;
  const latinWords = trimmed
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/gu, " ")
    .split(/[^A-Za-z0-9_]+/u)
    .filter(Boolean).length;
  const otherChars = trimmed
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/gu, "")
    .replace(/[A-Za-z0-9_\s]+/gu, "").length;

  return Math.max(1, Math.ceil(cjkCount * 0.7 + latinWords * 1.3 + otherChars * 0.5));
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

function embeddingBatchSizeFor(type: string): number {
  return type === "ollama"
    ? OLLAMA_EMBEDDING_BATCH_SIZE
    : OPENAI_COMPATIBLE_EMBEDDING_BATCH_SIZE;
}

function randomJobId(): string {
  return `job_embed_${randomBytes(10).toString("hex")}`;
}
