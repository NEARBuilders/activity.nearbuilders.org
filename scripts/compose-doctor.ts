#!/usr/bin/env bun
// `bun run compose:doctor` — fails loudly, before the gateway starts, if two
// compose files bind the same host port. Exists because docker-compose.yml
// is regenerated from the upstream everything-dev template on every
// `bos sync`/`bos upgrade` and can silently reintroduce a collision with
// compose.activity.yml (see issue #29 — the redis-on-6379 collision this
// guards against, and why it can't just be fixed in docker-compose.yml).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractHostPorts } from "./lib/compose-ports";

interface Binding {
  file: string;
  service: string;
  hostPort: number;
}

const root = join(import.meta.dir, "..");
const composeFiles = readdirSync(root)
  .filter((name) => /^(docker-)?compose.*\.ya?ml$/.test(name))
  .sort();

if (composeFiles.length === 0) {
  console.log(
    "compose:doctor — no compose*.yml or docker-compose*.yml files found. Nothing to check.",
  );
  process.exit(0);
}

const bindings: Binding[] = [];
for (const file of composeFiles) {
  const parsed = Bun.YAML.parse(readFileSync(join(root, file), "utf8")) as {
    services?: Record<string, { ports?: unknown }>;
  };
  for (const [service, definition] of Object.entries(parsed.services ?? {})) {
    for (const { hostPort } of extractHostPorts(service, definition?.ports)) {
      bindings.push({ file, service, hostPort });
      console.log(`${file}: ${service} binds host port ${hostPort}`);
    }
  }
}

const byPort = new Map<number, Binding[]>();
for (const binding of bindings) {
  const list = byPort.get(binding.hostPort) ?? [];
  list.push(binding);
  byPort.set(binding.hostPort, list);
}
const collisions = Array.from(byPort.entries()).filter(([, list]) => list.length > 1);

if (collisions.length > 0) {
  console.error("");
  console.error("compose:doctor found port collisions:");
  for (const [port, list] of collisions) {
    console.error(`  port ${port}:`);
    for (const binding of list) {
      console.error(`    - ${binding.file} / ${binding.service}`);
    }
  }
  console.error("");
  console.error(
    "docker-compose.yml is bos-template-owned, gitignored, and regenerated on every `bos sync` — " +
      "it cannot be hand-edited to clear this. See the header of compose.activity.yml and issue #29.",
  );
  process.exit(1);
}

console.log("compose:doctor — no port collisions.");
