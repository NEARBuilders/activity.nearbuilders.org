#!/usr/bin/env bun
// `bun run setup:check` — asserts the local .env carries everything first-run
// (scripts/first-run.ts) would otherwise write. Used standalone by CI and by
// anyone recovering a stale environment, and internally by first-run itself.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findMissingLocalEnvKey } from "./lib/activity-setup";

const envPath = join(import.meta.dir, "..", ".env");

if (!existsSync(envPath)) {
  console.error("setup:check failed — .env is missing. Run `bun run first-run` first.");
  process.exit(1);
}

const envContent = readFileSync(envPath, "utf8");
const missingKey = findMissingLocalEnvKey(envContent);

if (missingKey) {
  console.error(`setup:check failed — ${missingKey} is missing or blank in .env.`);
  console.error("Run `bun run first-run` to fill it in, or set it yourself and re-run.");
  process.exit(1);
}

console.log("setup:check passed — .env has everything first-run manages.");
