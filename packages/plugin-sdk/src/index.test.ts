import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  pluginPackageSha256,
  signPluginPackage,
  validatePluginPackage,
  verifyPluginPackageSignature,
  type DibaoPluginPackage
} from "./index.js";

describe("plugin-sdk", () => {
  it("signs and verifies plugin packages with deterministic payloads", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const pluginPackage: DibaoPluginPackage = {
      manifest: {
        manifestVersion: 1,
        id: "com.example.reader-tools",
        name: "Reader Tools",
        version: "1.0.0",
        publisher: "Example",
        dibao: { minVersion: "0.2.0", maxVersion: "<0.3.0" },
        entry: { web: "web/index.html" },
        capabilities: ["settings:plugin"]
      },
      files: {
        "web/index.html": "<!doctype html><html></html>"
      }
    };

    const signed = signPluginPackage({
      pluginPackage,
      privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
      now: () => new Date("2026-06-01T00:00:00Z")
    });

    expect(validatePluginPackage(signed)).toEqual({ ok: true });
    expect(verifyPluginPackageSignature({ pluginPackage: signed })).toEqual({ ok: true });
    expect(pluginPackageSha256(pluginPackage)).toBe(pluginPackageSha256({ ...pluginPackage }));
    expect(
      verifyPluginPackageSignature({
        pluginPackage: {
          ...signed,
          files: {
            ...signed.files,
            "web/index.html": "tampered"
          }
        }
      })
    ).toEqual({ ok: false, errors: ["Plugin signature verification failed"] });
  });
});
