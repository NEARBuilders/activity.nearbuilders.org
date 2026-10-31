#!/usr/bin/env node
// strfry write-policy plugin for relay.nearbuilders.org.
// Protocol: https://github.com/hoytech/strfry/blob/master/docs/plugins.md
//
// - Accepts only the event kinds NEAR Builders apps publish (RELAY_ALLOWED_KINDS).
// - Rate-limits network writes per client address with a token bucket (RELAY_WRITE_RATE per
//   second, bursts up to RELAY_WRITE_BURST). The Activity gateway publishes every source's events
//   from one server, so the burst must absorb a GitHub backfill.
// - Events arriving by import, sync, or stream are operator actions and skip the rate limit.
// - Accepts kind 1701 only from pubkeys the Activity API lists as signing identities
//   (RELAY_SIGNING_KEYS_URL). Keys are cached and refreshed periodically and on a miss.

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

const PUBLIC_KEY = /^[0-9a-f]{64}$/;

async function fetchSigningKeys(url, fetch, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.data)) throw new Error("response has no data array");
  const keys = new Set(
    body.data
      .map((entry) => entry?.publicKey)
      .filter((key) => typeof key === "string" && PUBLIC_KEY.test(key)),
  );
  if (keys.size === 0) throw new Error("key list is empty");
  return keys;
}

export function createSigningKeyCache({
  url,
  fetch = globalThis.fetch,
  now = () => Date.now(),
  refreshMs = 60_000,
  missRefreshMs = 5_000,
  timeoutMs = 2_000,
  log = () => {},
}) {
  let keys = null;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let lastRefreshFailed = false;
  let inFlight = null;

  async function load() {
    lastAttemptAt = now();
    try {
      const loaded = await fetchSigningKeys(url, fetch, timeoutMs);
      if (loaded.size !== keys?.size) log(`signing keys loaded: ${loaded.size}`);
      keys = loaded;
      lastRefreshFailed = false;
    } catch (error) {
      lastRefreshFailed = true;
      log(`signing keys refresh failed: ${error.message}`);
    }
  }

  function refresh() {
    inFlight ??= load().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  // KEEP: once a list is loaded, a miss while fetches fail must not stall the relay on another
  // fetch; the periodic refresh keeps retrying. Before the first load, misses keep retrying
  // (throttled), since waiting for a list is the only way to answer.
  function shouldRefreshOnMiss() {
    const servingStaleList = keys !== null && lastRefreshFailed;
    if (inFlight) return !servingStaleList;
    return !servingStaleList && now() - lastAttemptAt >= missRefreshMs;
  }

  async function allows(pubkey) {
    if (keys?.has(pubkey)) return "allowed";
    if (shouldRefreshOnMiss()) await refresh();
    if (keys === null) return "unavailable";
    return keys.has(pubkey) ? "allowed" : "unknown";
  }

  function start() {
    refresh();
    setInterval(refresh, refreshMs).unref();
  }

  return { allows, refresh, start };
}

const SIGNING_KEY_REJECTIONS = {
  unknown: "blocked: pubkey is not a registered Activity signing identity",
  unavailable: "error: Activity signing keys are unavailable, retry later",
};

export function createPolicy({
  allowedKinds = parseKinds(DEFAULT_ALLOWED_KINDS),
  ratePerSecond = 20,
  burst = 300,
  now = () => Date.now(),
  signingKeys = null,
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

  return async function decide(request, log = () => {}) {
    const id = request?.event?.id;
    if (request?.type !== "new" || typeof id !== "string") {
      return { id: id ?? "", action: "reject", msg: "error: unexpected write-policy request" };
    }
    // The address strfry reports comes from realIpHeader behind a proxy. Logging it shows who is
    // being blocked, and confirms the header is set: a private address means every client shares
    // one rate-limit bucket.
    const address = String(request.sourceInfo ?? "unknown");
    if (!allowedKinds.has(request.event.kind)) {
      log(`rejected kind ${request.event.kind} from ${request.sourceType} ${address}`);
      return {
        id,
        action: "reject",
        msg: `blocked: kind ${request.event.kind} is not accepted here`,
      };
    }
    if (request.sourceType === "IP4" || request.sourceType === "IP6") {
      pruneFullBuckets();
      if (!takeToken(address)) {
        log(`rate-limited ${address}`);
        return { id, action: "reject", msg: "rate-limited: slow down" };
      }
    }
    if (request.event.kind === 1701 && signingKeys) {
      const pubkey = String(request.event.pubkey ?? "");
      const status = await signingKeys.allows(pubkey);
      if (status !== "allowed") {
        if (status === "unknown") {
          log(
            `rejected unregistered pubkey ${pubkey.slice(0, 16)} from ${request.sourceType} ${address}`,
          );
        }
        return { id, action: "reject", msg: SIGNING_KEY_REJECTIONS[status] };
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
  const log = (message) => console.error(`write-policy: ${message}`); // appears in strfry logs
  const signingKeysUrl = process.env.RELAY_SIGNING_KEYS_URL ?? "";
  let signingKeys = null;
  if (signingKeysUrl) {
    signingKeys = createSigningKeyCache({
      url: signingKeysUrl,
      refreshMs: numberFromEnv("RELAY_SIGNING_KEYS_REFRESH_SECONDS", 60) * 1000,
      missRefreshMs: numberFromEnv("RELAY_SIGNING_KEYS_MISS_REFRESH_SECONDS", 5) * 1000,
      log,
    });
    signingKeys.start();
  } else {
    log("RELAY_SIGNING_KEYS_URL is not set; kind-1701 pubkey check is disabled");
  }
  const decide = createPolicy({
    allowedKinds: parseKinds(process.env.RELAY_ALLOWED_KINDS ?? DEFAULT_ALLOWED_KINDS),
    ratePerSecond: numberFromEnv("RELAY_WRITE_RATE", 20),
    burst: numberFromEnv("RELAY_WRITE_BURST", 300),
    signingKeys,
  });

  async function handle(line) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      log("could not parse request");
      return;
    }
    let decision;
    try {
      decision = await decide(request, log);
    } catch (error) {
      log(`failure: ${error.message}`);
      decision = {
        id: request?.event?.id ?? "",
        action: "reject",
        msg: "error: write-policy failure",
      };
    }
    process.stdout.write(`${JSON.stringify(decision)}\n`);
  }

  // KEEP: decide is async; chaining keeps replies in request order.
  let queue = Promise.resolve();
  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    queue = queue.then(() => handle(line)).catch((error) => log(`failure: ${error.message}`));
  });
}
