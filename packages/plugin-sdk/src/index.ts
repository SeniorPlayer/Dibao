import { createHash, sign as signPayload, verify as verifyPayload } from "node:crypto";

export type DibaoPluginSignature = {
  algorithm: "ed25519";
  publicKeyPem?: string;
  keyId?: string;
  signedAt?: string;
  signature: string;
};

export type DibaoPluginPackage = {
  manifest: unknown;
  files?: Record<string, string>;
  updateUrl?: string;
  signature?: DibaoPluginSignature;
};

export const dibaoPluginCapabilities = [
  "articles:read",
  "articles:write",
  "feeds:read",
  "feeds:write",
  "ranking:read",
  "ranking:write",
  "settings:plugin",
  "settings:core:read",
  "settings:core:write",
  "jobs:read",
  "jobs:write",
  "database:plugin",
  "network:outbound",
  "secrets:plugin",
  "deliveries:read",
  "deliveries:write",
  "files:plugin-data",
  "telemetry:emit"
] as const;

export type DibaoPluginCapability = typeof dibaoPluginCapabilities[number];

export const dibaoPluginEvents = [
  "article.created",
  "article.updated",
  "article.actionRecorded",
  "feed.refreshCompleted",
  "ranking.afterRanked",
  "settings.afterUpdated",
  "plugin.taskSucceeded",
  "plugin.taskFailed",
  "maintenance.tick",
  "dailyBrief.generated"
] as const;

export type DibaoPluginEvent = typeof dibaoPluginEvents[number];

export type DibaoPluginSecretMetadata = {
  key: string;
  hasValue: boolean;
  hint: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DibaoPluginDeliveryStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type DibaoPluginDelivery = {
  id: string;
  pluginId: string;
  status: DibaoPluginDeliveryStatus;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  request: unknown;
  response: unknown;
  error: string | null;
  idempotencyKey: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type DibaoPluginValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function pluginPackageSigningPayload(pluginPackage: DibaoPluginPackage): string {
  return stableStringify({
    manifest: pluginPackage.manifest,
    files: pluginPackage.files ?? {},
    updateUrl: pluginPackage.updateUrl ?? null
  });
}

export function pluginPackageSha256(pluginPackage: DibaoPluginPackage): string {
  return createHash("sha256").update(pluginPackageSigningPayload(pluginPackage)).digest("hex");
}

export function signPluginPackage(input: {
  pluginPackage: DibaoPluginPackage;
  privateKeyPem: string;
  publicKeyPem?: string;
  keyId?: string;
  now?: () => Date;
}): DibaoPluginPackage {
  const payload = pluginPackageSigningPayload(input.pluginPackage);
  const signature = signPayload(null, Buffer.from(payload), input.privateKeyPem).toString("base64");
  return {
    ...input.pluginPackage,
    signature: {
      algorithm: "ed25519",
      publicKeyPem: input.publicKeyPem,
      keyId: input.keyId,
      signedAt: (input.now ?? (() => new Date()))().toISOString(),
      signature
    }
  };
}

export function verifyPluginPackageSignature(input: {
  pluginPackage: DibaoPluginPackage;
  trustedPublicKeys?: Record<string, string>;
  requireSignature?: boolean;
}): DibaoPluginValidationResult {
  const signature = input.pluginPackage.signature;
  if (!signature) {
    return input.requireSignature === false
      ? { ok: true }
      : { ok: false, errors: ["Plugin signature is required"] };
  }
  if (signature.algorithm !== "ed25519" || !signature.signature) {
    return { ok: false, errors: ["Plugin signature is invalid"] };
  }
  if (!signature.keyId) {
    return { ok: false, errors: ["Plugin signature keyId is required"] };
  }
  const publicKeyPem = input.trustedPublicKeys?.[signature.keyId];
  if (!publicKeyPem) {
    return { ok: false, errors: ["Plugin signature key is not trusted"] };
  }
  const ok = verifyPayload(
    null,
    Buffer.from(pluginPackageSigningPayload(input.pluginPackage)),
    publicKeyPem,
    Buffer.from(signature.signature, "base64")
  );
  return ok ? { ok: true } : { ok: false, errors: ["Plugin signature verification failed"] };
}

export function validatePluginPackage(pluginPackage: DibaoPluginPackage): DibaoPluginValidationResult {
  const errors: string[] = [];
  const manifest = pluginPackage.manifest as Record<string, unknown> | null;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push("manifest must be an object");
  } else {
    for (const key of ["manifestVersion", "id", "name", "version", "publisher", "dibao", "capabilities"]) {
      if (!Object.hasOwn(manifest, key)) {
        errors.push(`manifest.${key} is required`);
      }
    }
    const entry = manifest.entry as Record<string, unknown> | undefined;
    for (const entryPath of [entry?.server, entry?.web]) {
      if (typeof entryPath === "string" && pluginPackage.files && !Object.hasOwn(pluginPackage.files, entryPath)) {
        errors.push(`entry file is missing: ${entryPath}`);
      }
    }
    const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
    for (const capability of capabilities) {
      if (typeof capability !== "string" || !dibaoPluginCapabilities.includes(capability as DibaoPluginCapability)) {
        errors.push(`manifest.capabilities contains unsupported capability: ${String(capability)}`);
      }
    }
    const contributes = manifest.contributes as Record<string, unknown> | undefined;
    const hooks = Array.isArray(contributes?.hooks) ? contributes.hooks : [];
    for (const hook of hooks) {
      if (typeof hook !== "string" || !dibaoPluginEvents.includes(hook as DibaoPluginEvent)) {
        errors.push(`manifest.contributes.hooks contains unsupported event: ${String(hook)}`);
      }
    }
  }
  const signatureResult = verifyPluginPackageSignature({
    pluginPackage,
    requireSignature: false
  });
  if (!signatureResult.ok) {
    errors.push(...signatureResult.errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
