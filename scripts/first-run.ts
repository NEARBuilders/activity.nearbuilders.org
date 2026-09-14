#!/usr/bin/env bun
// `bun run first-run` — the only setup step a new contributor should need
// beyond `bun install`. Bootstraps .env, mints a local signing key if none
// exists, wires the app at the local relay/redis instead of the unresolvable
// production hostnames in bos.config.json (see docs/research/activity-relay-503.md),
// and brings up the local infra. Safe to re-run: every step is additive,
// never overwriting a value an operator already set.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getEnvValue,
  isEnvValueBlank,
  mergeMissingEnvKeys,
  parseEnvKeys,
  setEnvValueIfBlank,
} from "./lib/env-file";

const root = join(import.meta.dir, "..");
const envPath = join(root, ".env");
const envExamplePath = join(root, ".env.example");
const composeFile = join(root, "compose.activity.yml");
const infraTimeoutMs = 60_000;

function loadEnvExampleDefaults(): Record<string, string> {
  const example = readFileSync(envExamplePath, "utf8");
  return Object.fromEntries(
    Array.from(parseEnvKeys(example), (key) => [key, getEnvValue(example, key) ?? ""]),
  );
}

function writeEnv(content: string): void {
  writeFileSync(envPath, content);
}

function logContainerLogs(): void {
  console.error("Container log:");
  Bun.spawnSync(["docker", "compose", "-f", composeFile, "logs"], {
    stdout: "inherit",
    stderr: "inherit",
  });
}

// 1. Bootstrap .env
let envContent: string;
if (!existsSync(envPath)) {
  envContent = readFileSync(envExamplePath, "utf8");
  writeEnv(envContent);
  console.log("Created .env from .env.example.");
} else {
  envContent = readFileSync(envPath, "utf8");
  const { content, added } = mergeMissingEnvKeys(envContent, loadEnvExampleDefaults());
  envContent = content;
  if (added.length > 0) {
    writeEnv(envContent);
    console.log(`Added missing .env keys from .env.example: ${added.join(", ")}`);
  }
}

// 2. Generate or accept master keys
if (isEnvValueBlank(envContent, "ACTIVITY_SIGNING_MASTER_KEYS")) {
  console.log("No signing keyring found — generating one with scripts/keys-gen.ts (version v1)...");
  const keysGen = Bun.spawnSync(["bun", "run", join(root, "scripts", "keys-gen.ts")], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (keysGen.exitCode !== 0) {
    console.error("scripts/keys-gen.ts failed; aborting first-run.");
    process.exit(1);
  }
  const output = keysGen.stdout.toString().split("\n");
  const keysLine = output.find((line) => line.startsWith("ACTIVITY_SIGNING_MASTER_KEYS="));
  const versionLine = output.find((line) =>
    line.startsWith("ACTIVITY_SIGNING_ACTIVE_KEY_VERSION="),
  );
  if (!keysLine || !versionLine) {
    console.error("scripts/keys-gen.ts did not emit the expected env lines; aborting first-run.");
    process.exit(1);
  }
  envContent = setEnvValueIfBlank(
    envContent,
    "ACTIVITY_SIGNING_MASTER_KEYS",
    keysLine.slice("ACTIVITY_SIGNING_MASTER_KEYS=".length),
  ).content;
  envContent = setEnvValueIfBlank(
    envContent,
    "ACTIVITY_SIGNING_ACTIVE_KEY_VERSION",
    versionLine.slice("ACTIVITY_SIGNING_ACTIVE_KEY_VERSION=".length),
  ).content;
  writeEnv(envContent);
  console.warn(
    "Wrote a new ACTIVITY_SIGNING_MASTER_KEYS keyring to .env. This base64 secret is not stored " +
      "anywhere else — back it up before you lose .env, and never commit it.",
  );
} else {
  console.log("ACTIVITY_SIGNING_MASTER_KEYS already set — skipping key generation.");
}

// 3. Force local infra wiring (idempotent — never overwrites a real value)
{
  const relay = setEnvValueIfBlank(envContent, "ACTIVITY_RELAY_URL", "ws://127.0.0.1:7447");
  const redis = setEnvValueIfBlank(relay.content, "ACTIVITY_REDIS_URL", "redis://localhost:6379");
  envContent = redis.content;
  if (relay.changed || redis.changed) {
    writeEnv(envContent);
    console.log(
      "Wired ACTIVITY_RELAY_URL / ACTIVITY_REDIS_URL to the local docker-compose services.",
    );
  }
}

// 4. Start local infra and wait for both healthchecks
console.log("Starting local infra (activity relay on :7447, redis on :6379)...");
const infra = Bun.spawn(["bun", "run", "dev:activity-infra"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
let timeoutHandle: Timer | undefined;
const timedOut = await Promise.race([
  infra.exited.then(() => false),
  new Promise<boolean>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(true), infraTimeoutMs);
  }),
]);
clearTimeout(timeoutHandle);
if (timedOut) {
  infra.kill();
  console.error(`Local infra did not report healthy within ${infraTimeoutMs / 1000}s.`);
  logContainerLogs();
  process.exit(1);
}
if (infra.exitCode !== 0) {
  console.error(`dev:activity-infra exited with code ${infra.exitCode}.`);
  logContainerLogs();
  process.exit(1);
}

// 5. Delegate to setup:check, then hand off
const check = Bun.spawnSync(["bun", "run", "setup:check"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
if (check.exitCode !== 0) {
  process.exit(check.exitCode ?? 1);
}

console.log("Local relay and Redis are wired in and healthy.");
console.log("bun run dev");
