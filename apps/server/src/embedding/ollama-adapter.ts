import {
  EmbeddingProviderError,
  type EmbeddingInput,
  type EmbeddingProviderAdapter,
  type EmbeddingProviderConfig,
  type EmbeddingTestResult,
  type EmbeddingVector
} from "./types.js";
import { providerHttpError, providerNetworkError } from "./provider-http-errors.js";

export const OLLAMA_TEST_TEXT = "Dibao embedding provider test";
export const OLLAMA_TIMEOUT_MS = 30_000;

type OllamaAdapterOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type OllamaEmbedResponse = {
  embeddings?: unknown;
};

export class OllamaEmbeddingAdapter implements EmbeddingProviderAdapter {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaAdapterOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? OLLAMA_TIMEOUT_MS;
  }

  async test(provider: EmbeddingProviderConfig): Promise<EmbeddingTestResult> {
    const startedAt = Date.now();
    const [result] = await this.embedBatch({
      provider,
      items: [
        {
          id: "test",
          text: OLLAMA_TEST_TEXT
        }
      ]
    });

    if (!result) {
      throw new EmbeddingProviderError("Ollama response did not include a test embedding", false);
    }

    return {
      dimension: result.vector.length,
      latencyMs: Math.max(0, Date.now() - startedAt)
    };
  }

  async embedBatch(input: {
    provider: EmbeddingProviderConfig;
    items: EmbeddingInput[];
  }): Promise<EmbeddingVector[]> {
    if (input.items.length === 0) {
      return [];
    }

    const response = await this.postEmbeddings(input.provider, input.items.map((item) => item.text));
    const vectors = parseOllamaEmbedResponse(response, input.items);

    for (const vector of vectors) {
      if (vector.vector.length !== input.provider.dimension) {
        throw new EmbeddingProviderError(
          `Ollama returned dimension ${vector.vector.length}; expected ${input.provider.dimension}`,
          false,
          {
            expectedDimension: input.provider.dimension,
            actualDimension: vector.vector.length
          }
        );
      }
    }

    return vectors;
  }

  private async postEmbeddings(provider: EmbeddingProviderConfig, texts: string[]): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(embeddingEndpoint(provider), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: provider.model,
          input: texts
        }),
        signal: controller.signal
      });

      const text = await response.text();
      const payload = parseJson(text);

      if (!response.ok) {
        throw providerHttpError({
          providerLabel: "Ollama",
          status: response.status,
          payload,
          text
        });
      }

      return payload;
    } catch (error) {
      if (error instanceof EmbeddingProviderError) {
        throw error;
      }

      throw providerNetworkError({ providerLabel: "Ollama", error });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function embeddingEndpoint(provider: EmbeddingProviderConfig): string {
  if (!provider.baseUrl) {
    throw new EmbeddingProviderError("Ollama baseUrl is required", false);
  }

  return `${provider.baseUrl.replace(/\/+$/u, "")}/api/embed`;
}

function parseOllamaEmbedResponse(
  payload: unknown,
  items: EmbeddingInput[]
): EmbeddingVector[] {
  if (!isOllamaEmbedResponse(payload) || !Array.isArray(payload.embeddings)) {
    throw new EmbeddingProviderError(
      "Ollama provider returned a malformed response: missing embeddings array",
      false
    );
  }

  if (payload.embeddings.length !== items.length) {
    throw new EmbeddingProviderError(
      `Ollama returned ${payload.embeddings.length} embeddings for ${items.length} inputs`,
      false,
      {
        expectedCount: items.length,
        actualCount: payload.embeddings.length
      }
    );
  }

  return payload.embeddings.map((embedding, index) => {
    if (!Array.isArray(embedding) || !embedding.every(isFiniteNumber)) {
      throw new EmbeddingProviderError(
        "Ollama provider returned a malformed response: embedding must be a number array",
        false,
        {
          index
        }
      );
    }

    return {
      id: items[index].id,
      vector: embedding
    };
  });
}

function isOllamaEmbedResponse(value: unknown): value is OllamaEmbedResponse {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseJson(text: string): unknown {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
