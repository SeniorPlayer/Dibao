#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  signPluginPackage,
  validatePluginPackage,
  type DibaoPluginPackage
} from "@dibao/plugin-sdk";

type CommandOptions = Record<string, string | true>;

async function main(argv: string[]): Promise<void> {
  const [command = "help", target = ".", ...rest] = argv;
  const options = parseOptions(rest);
  if (command === "create") {
    createPlugin(target);
    return;
  }
  if (command === "validate") {
    validatePackage(target);
    return;
  }
  if (command === "pack") {
    packPlugin(target, stringOption(options.out) ?? `${basename(target)}.dibao-plugin`);
    return;
  }
  if (command === "sign") {
    signPackage(target, {
      privateKey: requiredStringOption(options.privateKey, "--private-key is required"),
      publicKey: stringOption(options.publicKey),
      keyId: stringOption(options.keyId),
      out: stringOption(options.out) ?? target
    });
    return;
  }
  if (command === "dev") {
    console.log("dibao-plugin dev: validate the package during local development.");
    validatePackage(target);
    return;
  }
  printHelp();
}

function createPlugin(targetDir: string): void {
  mkdirSync(join(targetDir, "server"), { recursive: true });
  mkdirSync(join(targetDir, "web"), { recursive: true });
  const id = `dev.example.${basename(targetDir).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  writeFileSync(
    join(targetDir, "plugin.json"),
    `${JSON.stringify(
      {
        manifestVersion: 1,
        id,
        name: basename(targetDir),
        version: "0.1.0",
        publisher: "Example",
        dibao: { minVersion: "0.2.0", maxVersion: "<0.3.0" },
        entry: { server: "server/index.mjs", web: "web/index.html" },
        capabilities: ["settings:plugin", "files:plugin-data"],
        contributes: {
          actions: [],
          routes: [],
          settingsTabs: [],
          hooks: [],
          tasks: []
        }
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(targetDir, "server/index.mjs"), "export default { activate() {} };\n");
  writeFileSync(
    join(targetDir, "web/index.html"),
    "<!doctype html><html><body><h1>Dibao Plugin</h1></body></html>\n"
  );
  console.log(`Created plugin template in ${targetDir}`);
}

function validatePackage(inputPath: string): void {
  const pluginPackage = readPackageOrDirectory(inputPath);
  const result = validatePluginPackage(pluginPackage);
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Plugin package is valid.");
}

function packPlugin(sourceDir: string, outPath: string): void {
  const pluginPackage = packageFromDirectory(sourceDir);
  const result = validatePluginPackage(pluginPackage);
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }
  writeFileSync(outPath, `${JSON.stringify(pluginPackage, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
}

function signPackage(inputPath: string, options: {
  privateKey: string;
  publicKey?: string;
  keyId?: string;
  out: string;
}): void {
  const pluginPackage = readPackageOrDirectory(inputPath);
  const signed = signPluginPackage({
    pluginPackage,
    privateKeyPem: readFileSync(options.privateKey, "utf8"),
    publicKeyPem: options.publicKey ? readFileSync(options.publicKey, "utf8") : undefined,
    keyId: options.keyId
  });
  writeFileSync(options.out, `${JSON.stringify(signed, null, 2)}\n`);
  console.log(`Signed ${options.out}`);
}

function readPackageOrDirectory(inputPath: string): DibaoPluginPackage {
  if (statSync(inputPath).isDirectory()) {
    return packageFromDirectory(inputPath);
  }
  return JSON.parse(readFileSync(inputPath, "utf8")) as DibaoPluginPackage;
}

function packageFromDirectory(sourceDir: string): DibaoPluginPackage {
  const manifestPath = join(sourceDir, "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`plugin.json not found in ${sourceDir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  const files: Record<string, string> = {};
  for (const file of listFiles(sourceDir)) {
    const rel = relative(sourceDir, file);
    if (rel === "plugin.json" || rel.endsWith(".dibao-plugin")) {
      continue;
    }
    files[rel] = readFileSync(file, "utf8");
  }
  return { manifest, files };
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function parseOptions(args: string[]): CommandOptions {
  const options: CommandOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = args[index + 1];
    if (value && !value.startsWith("--")) {
      options[key] = value;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function stringOption(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredStringOption(value: string | true | undefined, message: string): string {
  const option = stringOption(value);
  if (!option) {
    throw new Error(message);
  }
  return option;
}

function printHelp(): void {
  console.log(`dibao-plugin create <dir>
dibao-plugin validate <dir|package>
dibao-plugin pack <dir> --out plugin.dibao-plugin
dibao-plugin sign <dir|package> --private-key key.pem --public-key pub.pem --out signed.dibao-plugin
dibao-plugin dev <dir|package>`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
