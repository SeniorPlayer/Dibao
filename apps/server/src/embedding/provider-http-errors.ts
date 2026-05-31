import { EmbeddingProviderError } from "./types.js";

export type ProviderHttpErrorCategory =
  | "authentication"
  | "not_found"
  | "rate_limit"
  | "provider_unavailable"
  | "bad_request"
  | "provider_rejected";

export type ProviderHttpErrorDetails = {
  status: number;
  category: ProviderHttpErrorCategory;
  providerMessage?: string;
};

export function providerHttpError(input: {
  providerLabel: string;
  status: number;
  payload: unknown;
  text: string;
}): EmbeddingProviderError {
  const category = categoryForStatus(input.status);
  const providerMessage = publicProviderMessage(input.payload, input.text);
  const message = messageForHttpError({
    providerLabel: input.providerLabel,
    status: input.status,
    category,
    providerMessage
  });
  const details: ProviderHttpErrorDetails = {
    status: input.status,
    category,
    ...(providerMessage ? { providerMessage } : {})
  };

  return new EmbeddingProviderError(
    message,
    input.status === 429 || input.status >= 500,
    details
  );
}

export function providerNetworkError(input: {
  providerLabel: string;
  error: unknown;
}): EmbeddingProviderError {
  const isTimeout = input.error instanceof Error && input.error.name === "AbortError";
  const cause = input.error instanceof Error ? input.error.message : String(input.error);
  const providerMessage = publicString(cause);

  return new EmbeddingProviderError(
    isTimeout
      ? `${input.providerLabel} provider request timed out. Check the base URL and network connectivity.`
      : `${input.providerLabel} provider could not be reached${
          providerMessage ? `: ${providerMessage}` : ""
        }`,
    true,
    {
      category: isTimeout ? "timeout" : "network",
      ...(providerMessage ? { providerMessage } : {})
    }
  );
}

function categoryForStatus(status: number): ProviderHttpErrorCategory {
  if (status === 401 || status === 403) {
    return "authentication";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 429) {
    return "rate_limit";
  }
  if (status >= 500) {
    return "provider_unavailable";
  }
  if (status === 400 || status === 422) {
    return "bad_request";
  }
  return "provider_rejected";
}

function messageForHttpError(input: {
  providerLabel: string;
  status: number;
  category: ProviderHttpErrorCategory;
  providerMessage: string | null;
}): string {
  const suffix = input.providerMessage ? ` Provider message: ${input.providerMessage}` : "";

  switch (input.category) {
    case "authentication":
      return `${input.providerLabel} provider authentication failed (HTTP ${input.status}). Check the API key and permissions.${suffix}`;
    case "not_found":
      return `${input.providerLabel} provider endpoint or model was not found (HTTP ${input.status}). Check the base URL and model name.${suffix}`;
    case "rate_limit":
      return `${input.providerLabel} provider rate limit was reached (HTTP ${input.status}). Wait and try again or lower the request limits.${suffix}`;
    case "provider_unavailable":
      return `${input.providerLabel} provider is unavailable (HTTP ${input.status}). Check provider status or try again later.${suffix}`;
    case "bad_request":
      return `${input.providerLabel} provider rejected the request (HTTP ${input.status}). Check the model, dimension, and request settings.${suffix}`;
    case "provider_rejected":
      return `${input.providerLabel} provider rejected the request (HTTP ${input.status}).${suffix}`;
  }
}

function publicProviderMessage(payload: unknown, text: string): string | null {
  const candidates = messageCandidates(payload);
  for (const candidate of candidates) {
    const message = publicString(candidate);
    if (message) {
      return message;
    }
  }

  return publicString(text);
}

function messageCandidates(value: unknown): unknown[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const object = value as Record<string, unknown>;
  const error = object.error;
  if (typeof error === "string") {
    return [error];
  }
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const errorObject = error as Record<string, unknown>;
    return [errorObject.message, errorObject.status, errorObject.code, errorObject.type];
  }
  return [object.message, object.status, object.code, object.type];
}

function publicString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const compact = redactSensitive(value).replace(/\s+/gu, " ").trim();
  if (!compact || compact === "{}" || compact === "[]") {
    return null;
  }

  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function redactSensitive(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/(authorization["':\s]+)([^"',\s}]+)/giu, "$1[redacted]")
    .replace(/(api[_-]?key["':\s]+)([^"',\s}]+)/giu, "$1[redacted]")
    .replace(/(token["':\s]+)([^"',\s}]+)/giu, "$1[redacted]")
    .replace(/(secret["':\s]+)([^"',\s}]+)/giu, "$1[redacted]");
}
