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
}): DibaoPluginValidationResult {
  const signature = input.pluginPackage.signature;
  if (!signature) {
    return { ok: true };
  }
  if (signature.algorithm !== "ed25519" || !signature.signature) {
    return { ok: false, errors: ["Plugin signature is invalid"] };
  }
  const publicKeyPem =
    (signature.keyId ? input.trustedPublicKeys?.[signature.keyId] : undefined) ??
    signature.publicKeyPem;
  if (!publicKeyPem) {
    return { ok: false, errors: ["Plugin signature has no public key"] };
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
  }
  const signatureResult = verifyPluginPackageSignature({ pluginPackage });
  if (!signatureResult.ok) {
    errors.push(...signatureResult.errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
