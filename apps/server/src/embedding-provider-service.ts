import { randomBytes } from "node:crypto";
import type {
  EmbeddingIndexListRow,
  EmbeddingIndexRow,
  EmbeddingProviderRow,
  EmbeddingRepository,
  VectorStore
} from "@dibao/db";
import {
  EmbeddingProviderError,
  type EmbeddingProviderAdapter,
  type EmbeddingProviderConfig
} from "./embedding/types.js";

export type EmbeddingProviderResponse = {
  id: string;
  type: EmbeddingProviderRow["type"];
  name: string;
  baseUrl: string | null;
  model: string;
  dimension: number;
  textMaxChars: number;
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
  enabled: boolean;
  qualityTier: EmbeddingProviderRow["qualityTier"];
  hasApiKey: boolean;
  lastTestStatus: EmbeddingProviderRow["lastTestStatus"];
  lastTestError: string | null;
  lastTestAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmbeddingIndexResponse = {
  id: string;
  providerId: string;
  model: string;
  dimension: number;
  textMaxChars: number;
  distanceMetric: EmbeddingIndexRow["distanceMetric"];
  status: EmbeddingIndexRow["status"];
  candidateCount: number;
  eligibleArticleCount: number;
  missingEmbeddingCount: number;
  staleEmbeddingCount: number;
  coveredArticleCount: number;
  embeddingCount: number;
  coverageRatio: number;
  pendingJobs: number;
  failedJobs: number;
  lastFailedAt: string | null;
  lastError: string | null;
  usage: EmbeddingIndexListRow["usage"];
  createdAt: string | null;
  updatedAt: string | null;
};

export type TestEmbeddingProviderResponse = {
  status: "success";
  dimension: number;
  latencyMs: number;
};

export class EmbeddingProviderServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "EmbeddingProviderServiceError";
  }
}

export type EmbeddingProviderServiceOptions = {
  embeddings: EmbeddingRepository;
  vectorStore: Pick<VectorStore, "ensureIndex">;
  adapters: Partial<Record<EmbeddingProviderRow["type"], EmbeddingProviderAdapter>>;
  now?: () => number;
};

export type ActiveEmbeddingProviderConfig = {
  provider: EmbeddingProviderConfig;
  index: EmbeddingIndexRow;
  adapter: EmbeddingProviderAdapter;
};

export class EmbeddingProviderService {
  private readonly now: () => number;

  constructor(private readonly options: EmbeddingProviderServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  hasActiveProviderAndIndex(): boolean {
    return this.options.embeddings.findActiveProviderWithIndex() !== null;
  }

  listProviders(): EmbeddingProviderResponse[] {
    return this.options.embeddings.listProviders().map(mapProvider);
  }

  listIndexes(): EmbeddingIndexResponse[] {
    return this.options.embeddings.listIndexes().map(mapIndex);
  }

  createProvider(body: unknown): EmbeddingProviderResponse {
    const input = parseCreateProviderBody(body);
    const now = this.now();
    const providerId = randomId("provider");

    validateEnabledProviderType(input.type, input.enabled);
    if (input.enabled) {
      this.adapterForProviderType(input.type);
      this.assertProviderSwitchCompatible(null, input.model, input.dimension);
    }
    this.options.embeddings.upsertProvider({
      id: providerId,
      type: input.type,
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      dimension: input.dimension,
      textMaxChars: input.textMaxChars,
      requestsPerMinute: input.requestsPerMinute,
      requestsPerDay: input.requestsPerDay,
      apiKeyEncrypted:
        providerTypeUsesApiKey(input.type) && input.apiKey !== undefined
          ? encodeApiKey(input.apiKey)
          : null,
      enabled: input.enabled,
      qualityTier: input.qualityTier,
      now
    });

    if (input.enabled) {
      this.ensureActiveIndex(providerId, input.model, input.dimension, input.textMaxChars, now);
    }

    return mapProvider(this.mustFindProvider(providerId));
  }

  updateProvider(id: string, body: unknown): EmbeddingProviderResponse {
    const existing = this.options.embeddings.findProviderById(id);
    if (!existing) {
      throw notFound("Embedding provider not found");
    }

    const input = parseUpdateProviderBody(body, existing.type);
    const nextType = input.type ?? existing.type;
    const nextEnabled = input.enabled ?? existing.enabled;
    const nextModel = input.model ?? existing.model;
    const nextDimension = input.dimension ?? existing.dimension;
    const nextTextMaxChars = input.textMaxChars ?? existing.textMaxChars;
    const apiKeyEncryptedPatch =
      input.apiKey !== undefined
        ? encodeApiKey(input.apiKey)
        : providerTypeUsesApiKey(nextType)
          ? undefined
          : null;
    const now = this.now();

    validateEnabledProviderType(nextType, nextEnabled);
    if (nextEnabled) {
      this.adapterForProviderType(nextType);
      this.assertProviderSwitchCompatible(id, nextModel, nextDimension);
    }

    const updated = this.options.embeddings.updateProvider({
      id,
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.dimension !== undefined ? { dimension: input.dimension } : {}),
      ...(input.textMaxChars !== undefined ? { textMaxChars: input.textMaxChars } : {}),
      ...(input.requestsPerMinute !== undefined
        ? { requestsPerMinute: input.requestsPerMinute }
        : {}),
      ...(input.requestsPerDay !== undefined ? { requestsPerDay: input.requestsPerDay } : {}),
      ...(apiKeyEncryptedPatch !== undefined ? { apiKeyEncrypted: apiKeyEncryptedPatch } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.qualityTier !== undefined ? { qualityTier: input.qualityTier } : {}),
      now
    });

    if (!updated) {
      throw notFound("Embedding provider not found");
    }

    if (nextEnabled) {
      this.ensureActiveIndex(id, nextModel, nextDimension, nextTextMaxChars, now);
    }

    return mapProvider(this.mustFindProvider(id));
  }

  activateProvider(id: string): EmbeddingProviderResponse {
    const existing = this.options.embeddings.findProviderById(id);
    if (!existing) {
      throw notFound("Embedding provider not found");
    }

    validateEnabledProviderType(existing.type, true);
    this.adapterForProviderType(existing.type);
    this.assertProviderSwitchCompatible(id, existing.model, existing.dimension);

    const now = this.now();
    const updated = this.options.embeddings.updateProvider({
      id,
      enabled: true,
      now
    });
    if (!updated) {
      throw notFound("Embedding provider not found");
    }

    this.ensureActiveIndex(id, existing.model, existing.dimension, existing.textMaxChars, now);
    return mapProvider(this.mustFindProvider(id));
  }

  deleteProvider(id: string): { ok: true } {
    const existing = this.options.embeddings.findProviderById(id);
    if (!existing) {
      throw notFound("Embedding provider not found");
    }

    if (this.options.embeddings.providerHasIndexes(id)) {
      throw new EmbeddingProviderServiceError(
        409,
        "CONFLICT",
        "Embedding provider has indexes; disable it instead"
      );
    }

    this.options.embeddings.deleteProvider(id);
    return { ok: true };
  }

  async testProvider(id: string): Promise<TestEmbeddingProviderResponse> {
    const provider = this.options.embeddings.findProviderById(id);
    if (!provider) {
      throw notFound("Embedding provider not found");
    }

    validateEnabledProviderType(provider.type, true);

    try {
      const result = await this.adapterForProviderType(provider.type).test(configForProvider(provider));
      this.options.embeddings.recordProviderTestResult({
        id,
        status: "success",
        testedAt: this.now()
      });
      return {
        status: "success",
        dimension: result.dimension,
        latencyMs: result.latencyMs
      };
    } catch (error) {
      const message = providerErrorMessage(error);
      this.options.embeddings.recordProviderTestResult({
        id,
        status: "failed",
        error: message,
        testedAt: this.now()
      });
      throw providerError(error, message);
    }
  }

  ensureActiveIndex(
    providerId: string,
    model: string,
    dimension: number,
    textMaxChars: number,
    now = this.now()
  ) {
    const existing = this.options.embeddings.findActiveIndexForProvider(providerId);
    if (
      existing &&
      existing.model === model &&
      existing.dimension === dimension &&
      existing.textMaxChars === textMaxChars
    ) {
      this.options.vectorStore.ensureIndex(existing.id);
      return existing;
    }

    const index = this.options.embeddings.createIndex({
      id: randomId("index"),
      providerId,
      model,
      dimension,
      textMaxChars,
      status: "active",
      now
    });
    this.options.embeddings.retireActiveIndexesForProvider(providerId, index.id, now);
    this.options.vectorStore.ensureIndex(index.id);
    return index;
  }

  rebuildIndex(id: string): { jobPayload: { embeddingIndexId: string } } {
    const index = this.options.embeddings.findIndexById(id);
    if (!index) {
      throw notFound("Embedding index not found");
    }

    return {
      jobPayload: {
        embeddingIndexId: id
      }
    };
  }

  assertBackfillableIndex(id: string): EmbeddingIndexRow {
    const index = this.options.embeddings.findIndexById(id);
    if (!index) {
      throw notFound("Embedding index not found");
    }
    if (index.status !== "active") {
      throw new EmbeddingProviderServiceError(
        409,
        "CONFLICT",
        "Backfill can only run for the active embedding index"
      );
    }
    return index;
  }

  activeProviderConfig(): ActiveEmbeddingProviderConfig | null {
    const active = this.options.embeddings.findActiveProviderWithIndex();
    if (!active) {
      return null;
    }

    const adapter = this.options.adapters[active.provider.type];
    if (!adapter) {
      return null;
    }

    return {
      provider: configForProvider(active.provider),
      index: active.index,
      adapter
    };
  }

  private adapterForProviderType(type: EmbeddingProviderRow["type"]): EmbeddingProviderAdapter {
    const adapter = this.options.adapters[type];
    if (!adapter) {
      throw validationError(`Embedding provider type ${type} is not supported in this version`, {
        field: "type"
      });
    }
    return adapter;
  }

  private assertProviderSwitchCompatible(
    enablingProviderId: string | null,
    model: string,
    dimension: number
  ): void {
    const active = this.options.embeddings.findActiveProviderWithIndex();
    if (!active || active.provider.id === enablingProviderId) {
      return;
    }

    if (
      sameEmbeddingModelFamily(active.index.model, model) &&
      active.index.dimension === dimension
    ) {
      return;
    }

    throw new EmbeddingProviderServiceError(
      409,
      "INCOMPATIBLE_PROVIDER_SWITCH",
      "Embedding provider switches are only allowed between providers with the same model and dimension",
      {
        activeProviderId: active.provider.id,
        activeModel: active.index.model,
        activeDimension: active.index.dimension,
        requestedModel: model,
        requestedDimension: dimension
      }
    );
  }

  private mustFindProvider(id: string): EmbeddingProviderRow {
    const provider = this.options.embeddings.findProviderById(id);
    if (!provider) {
      throw new Error(`Failed to load embedding provider: ${id}`);
    }
    return provider;
  }
}

type CreateProviderInput = {
  type: EmbeddingProviderRow["type"];
  name: string;
  baseUrl: string | null;
  model: string;
  dimension: number;
  textMaxChars: number;
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
  apiKey?: string;
  enabled: boolean;
  qualityTier: EmbeddingProviderRow["qualityTier"];
};

type UpdateProviderInput = Partial<CreateProviderInput>;

const DEFAULT_EMBEDDING_TEXT_MAX_CHARS = 8_000;
const DEFAULT_OLLAMA_EMBEDDING_TEXT_MAX_CHARS = 4_000;

function parseCreateProviderBody(body: unknown): CreateProviderInput {
  const input = readObject(body);
  rejectUnknownKeys(input, [
    "type",
    "name",
    "baseUrl",
    "model",
    "dimension",
    "textMaxChars",
    "requestsPerMinute",
    "requestsPerDay",
    "apiKey",
    "enabled",
    "qualityTier"
  ]);

  const type = parseProviderType(input.type);
  const baseUrl = parseBaseUrl(input.baseUrl, type);

  return {
    type,
    name: parseNonEmptyString(input.name, "name"),
    baseUrl,
    model: parseNonEmptyString(input.model, "model"),
    dimension: parseDimension(input.dimension),
    textMaxChars:
      input.textMaxChars === undefined
        ? defaultTextMaxCharsForProvider(type)
        : parseTextMaxChars(input.textMaxChars),
    requestsPerMinute:
      input.requestsPerMinute === undefined
        ? null
        : parseOptionalPositiveInteger(input.requestsPerMinute, "requestsPerMinute"),
    requestsPerDay:
      input.requestsPerDay === undefined
        ? null
        : parseOptionalPositiveInteger(input.requestsPerDay, "requestsPerDay"),
    ...(input.apiKey !== undefined ? { apiKey: parseApiKey(input.apiKey) } : {}),
    enabled: input.enabled === undefined ? false : parseBoolean(input.enabled, "enabled"),
    qualityTier:
      input.qualityTier === undefined ? "basic" : parseQualityTier(input.qualityTier)
  };
}

function defaultTextMaxCharsForProvider(type: EmbeddingProviderRow["type"]): number {
  return type === "ollama"
    ? DEFAULT_OLLAMA_EMBEDDING_TEXT_MAX_CHARS
    : DEFAULT_EMBEDDING_TEXT_MAX_CHARS;
}

function parseUpdateProviderBody(
  body: unknown,
  currentType: EmbeddingProviderRow["type"]
): UpdateProviderInput {
  const input = readObject(body);
  rejectUnknownKeys(input, [
    "type",
    "name",
    "baseUrl",
    "model",
    "dimension",
    "textMaxChars",
    "requestsPerMinute",
    "requestsPerDay",
    "apiKey",
    "enabled",
    "qualityTier"
  ]);

  return {
    ...(input.type !== undefined ? { type: parseProviderType(input.type) } : {}),
    ...(input.name !== undefined ? { name: parseNonEmptyString(input.name, "name") } : {}),
    ...(input.baseUrl !== undefined
      ? { baseUrl: parseBaseUrl(input.baseUrl, parseProviderType(input.type ?? currentType)) }
      : {}),
    ...(input.model !== undefined ? { model: parseNonEmptyString(input.model, "model") } : {}),
    ...(input.dimension !== undefined ? { dimension: parseDimension(input.dimension) } : {}),
    ...(input.textMaxChars !== undefined
      ? { textMaxChars: parseTextMaxChars(input.textMaxChars) }
      : {}),
    ...(input.requestsPerMinute !== undefined
      ? {
          requestsPerMinute: parseOptionalPositiveInteger(
            input.requestsPerMinute,
            "requestsPerMinute"
          )
        }
      : {}),
    ...(input.requestsPerDay !== undefined
      ? { requestsPerDay: parseOptionalPositiveInteger(input.requestsPerDay, "requestsPerDay") }
      : {}),
    ...(input.apiKey !== undefined ? { apiKey: parseApiKey(input.apiKey) } : {}),
    ...(input.enabled !== undefined ? { enabled: parseBoolean(input.enabled, "enabled") } : {}),
    ...(input.qualityTier !== undefined
      ? { qualityTier: parseQualityTier(input.qualityTier) }
      : {})
  };
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError("request body must be an object");
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw validationError(`${key} is not a writable provider field`, { field: key });
    }
  }
}

function parseProviderType(value: unknown): EmbeddingProviderRow["type"] {
  if (
    value === "openai_compatible" ||
    value === "gemini" ||
    value === "ollama" ||
    value === "custom_http" ||
    value === "embedded_local"
  ) {
    return value;
  }

  throw validationError(
    "type must be openai_compatible, gemini, ollama, custom_http, or embedded_local",
    { field: "type" }
  );
}

function validateEnabledProviderType(type: EmbeddingProviderRow["type"], enabled: boolean): void {
  if (enabled && type !== "openai_compatible" && type !== "gemini" && type !== "ollama") {
    throw validationError(
      "Only openai_compatible, gemini, and ollama providers can be enabled in this version",
      {
        field: "type"
      }
    );
  }
}

function parseBaseUrl(value: unknown, type: EmbeddingProviderRow["type"]): string | null {
  if (type !== "openai_compatible" && type !== "gemini" && type !== "ollama") {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw validationError("baseUrl is required", { field: "baseUrl" });
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw validationError("baseUrl must be a valid URL", { field: "baseUrl" });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw validationError("baseUrl must use http or https", { field: "baseUrl" });
  }

  const normalizedPath = url.pathname.replace(/\/+$/u, "");
  const forbiddenSuffix =
    type === "ollama" ? "/api/embed" : type === "gemini" ? ":batchEmbedContents" : "/embeddings";
  const exampleRoot =
    type === "ollama"
      ? "http://127.0.0.1:11434"
      : type === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta"
        : "/v1";
  if (normalizedPath.endsWith(forbiddenSuffix)) {
    throw validationError(
      `baseUrl must not include ${forbiddenSuffix}; use the API root such as ${exampleRoot}`,
      {
        field: "baseUrl"
      }
    );
  }

  url.pathname = normalizedPath;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/u, "");
}

function parseNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function parseApiKey(value: unknown): string {
  if (value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw validationError("apiKey must be a string", { field: "apiKey" });
  }
  return value.trim();
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw validationError(`${field} must be a boolean`, { field });
  }
  return value;
}

function parseDimension(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20_000) {
    throw validationError("dimension must be an integer between 1 and 20000", {
      field: "dimension",
      min: 1,
      max: 20_000
    });
  }
  return value;
}

function parseTextMaxChars(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1_000 || value > 200_000) {
    throw validationError("textMaxChars must be an integer between 1000 and 200000", {
      field: "textMaxChars",
      min: 1_000,
      max: 200_000
    });
  }
  return value;
}

function parseOptionalPositiveInteger(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw validationError(`${field} must be a positive integer or null`, {
      field,
      min: 1
    });
  }
  return value;
}

function parseQualityTier(value: unknown): EmbeddingProviderRow["qualityTier"] {
  if (value === "basic" || value === "recommended" || value === "best_quality") {
    return value;
  }
  throw validationError("qualityTier must be basic, recommended, or best_quality", {
    field: "qualityTier"
  });
}

function configForProvider(provider: EmbeddingProviderRow) {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    dimension: provider.dimension,
    textMaxChars: provider.textMaxChars,
    requestsPerMinute: provider.requestsPerMinute,
    requestsPerDay: provider.requestsPerDay,
    apiKey: decodeApiKey(provider.apiKeyEncrypted)
  };
}

function providerTypeUsesApiKey(type: EmbeddingProviderRow["type"]): boolean {
  return type === "openai_compatible" || type === "gemini";
}

function sameEmbeddingModelFamily(left: string, right: string): boolean {
  return normalizedEmbeddingModelKey(left) === normalizedEmbeddingModelKey(right);
}

function normalizedEmbeddingModelKey(model: string): string {
  const normalized = model.trim().toLowerCase().replace(/^models\//u, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function encodeApiKey(apiKey: string): string | null {
  return apiKey ? `plain:v1:${Buffer.from(apiKey, "utf8").toString("base64url")}` : null;
}

function decodeApiKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (!value.startsWith("plain:v1:")) {
    return value;
  }

  return Buffer.from(value.slice("plain:v1:".length), "base64url").toString("utf8");
}

function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

function mapProvider(provider: EmbeddingProviderRow): EmbeddingProviderResponse {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    dimension: provider.dimension,
    textMaxChars: provider.textMaxChars,
    requestsPerMinute: provider.requestsPerMinute,
    requestsPerDay: provider.requestsPerDay,
    enabled: provider.enabled,
    qualityTier: provider.qualityTier,
    hasApiKey: Boolean(provider.apiKeyEncrypted),
    lastTestStatus: provider.lastTestStatus,
    lastTestError: provider.lastTestError,
    lastTestAt: timestampToIso(provider.lastTestAt),
    createdAt: timestampToIsoValue(provider.createdAt),
    updatedAt: timestampToIsoValue(provider.updatedAt)
  };
}

function mapIndex(index: EmbeddingIndexListRow): EmbeddingIndexResponse {
  return {
    id: index.id,
    providerId: index.providerId,
    model: index.model,
    dimension: index.dimension,
    textMaxChars: index.textMaxChars,
    distanceMetric: index.distanceMetric,
    status: index.status,
    candidateCount: index.candidateCount,
    eligibleArticleCount: index.eligibleArticleCount,
    missingEmbeddingCount: index.missingEmbeddingCount,
    staleEmbeddingCount: index.staleEmbeddingCount,
    coveredArticleCount: index.coveredArticleCount,
    embeddingCount: index.embeddingCount,
    coverageRatio: index.coverageRatio,
    pendingJobs: index.pendingJobs,
    failedJobs: index.failedJobs,
    lastFailedAt: timestampToIso(index.lastFailedAt),
    lastError: sanitizePublicError(index.lastError),
    usage: index.usage,
    createdAt: timestampToIso(index.createdAt ?? null),
    updatedAt: timestampToIso(index.updatedAt ?? null)
  };
}

function providerError(error: unknown, message: string): EmbeddingProviderServiceError {
  if (error instanceof EmbeddingProviderError) {
    return new EmbeddingProviderServiceError(
      502,
      "PROVIDER_ERROR",
      sanitizePublicError(message) ?? "Provider request failed",
      sanitizePublicDetails(error.details)
    );
  }
  return new EmbeddingProviderServiceError(
    502,
    "PROVIDER_ERROR",
    sanitizePublicError(message) ?? "Provider request failed"
  );
}

function providerErrorMessage(error: unknown): string {
  return sanitizePublicError(error instanceof Error ? error.message : String(error)) ?? "Provider request failed";
}

function validationError(message: string, details?: unknown): EmbeddingProviderServiceError {
  return new EmbeddingProviderServiceError(400, "VALIDATION_ERROR", message, details);
}

function notFound(message: string): EmbeddingProviderServiceError {
  return new EmbeddingProviderServiceError(404, "NOT_FOUND", message);
}

function timestampToIso(value: number | null): string | null {
  return value === null ? null : timestampToIsoValue(value);
}

function timestampToIsoValue(value: number): string {
  return new Date(value).toISOString();
}

function sanitizePublicError(message: string | null): string | null {
  if (message === null) {
    return null;
  }

  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/(authorization["':\s]+)([^"',\s}]+)/giu, "$1[redacted]")
    .replace(/(api[_-]?key["':\s]+)([^"',\s}]+)/giu, "$1[redacted]")
    .replace(/(token["':\s]+)([^"',\s}]+)/giu, "$1[redacted]");
}

function sanitizePublicDetails(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizePublicError(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizePublicDetails);
  }
  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/authorization|api[_-]?key|token|secret/iu.test(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = sanitizePublicDetails(nested);
      }
    }
    return output;
  }
  return value;
}
