#!/usr/bin/env node
// strfry write-policy plugin for relay.nearbuilders.org.
// Protocol: https://github.com/hoytech/strfry/blob/master/docs/plugins.md
//
// - Accepts only the event kinds NEAR Builders apps publish (RELAY_ALLOWED_KINDS).
// - Rate-limits network writes per client address with a token bucket (RELAY_WRITE_RATE per
//   second, bursts up to RELAY_WRITE_BURST). The Activity gateway publishes every source's events
//   from one server, so the burst must absorb a GitHub backfill.
// - Events arriving by import, sync, or stream are operator actions and skip the rate limit.

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const DEFAULT_ALLOWED_KINDS = "0,1,1111,1701";

export function parseKinds(value) {
  const kinds = new Set();
  for (const part of String(value).split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const kind = Number(trimmed);
    if (!Number.isInteger(kind) || kind < 0) throw new Error(`Invalid kind in allow list: ${part}`);
    kinds.add(kind);
  }
  return kinds;
}

export function createPolicy({
  allowedKinds = parseKinds(DEFAULT_ALLOWED_KINDS),
  ratePerSecond = 20,
  burst = 300,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map();
  let lastPrune = now();

  function takeToken(address) {
    const at = now();
    const bucket = buckets.get(address) ?? { tokens: burst, updatedAt: at };
    bucket.tokens = Math.min(
      burst,
      bucket.tokens + ((at - bucket.updatedAt) / 1000) * ratePerSecond,
    );
    bucket.updatedAt = at;
    buckets.set(address, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  function pruneFullBuckets() {
    const at = now();
    if (at - lastPrune < 60_000) return;
    lastPrune = at;
    const refillMs = (burst / ratePerSecond) * 1000;
    for (const [address, bucket] of buckets) {
      if (at - bucket.updatedAt > refillMs) buckets.delete(address);
    }
  }

  return function decide(request) {
    const id = request?.event?.id;
    if (request?.type !== "new" || typeof id !== "string") {
      return { id: id ?? "", action: "reject", msg: "error: unexpected write-policy request" };
    }
    if (!allowedKinds.has(request.event.kind)) {
      return {
        id,
        action: "reject",
        msg: `blocked: kind ${request.event.kind} is not accepted here`,
      };
    }
    if (request.sourceType === "IP4" || request.sourceType === "IP6") {
      pruneFullBuckets();
      if (!takeToken(String(request.sourceInfo ?? "unknown"))) {
        return { id, action: "reject", msg: "rate-limited: slow down" };
      }
    }
    return { id, action: "accept" };
  };
}

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const decide = createPolicy({
    allowedKinds: parseKinds(process.env.RELAY_ALLOWED_KINDS ?? DEFAULT_ALLOWED_KINDS),
    ratePerSecond: numberFromEnv("RELAY_WRITE_RATE", 20),
    burst: numberFromEnv("RELAY_WRITE_BURST", 300),
  });
  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      console.error("write-policy: could not parse request"); // appears in strfry logs
      return;
    }
    process.stdout.write(`${JSON.stringify(decide(request))}\n`);
  });
}
