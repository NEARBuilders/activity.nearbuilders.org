// Run with: node --test infra/relay/write-policy.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPolicy, createSigningKeyCache, parseKinds } from "./write-policy.mjs";

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const KEY_RETIRED = "c3".repeat(32);
const KEY_UNKNOWN = "d4".repeat(32);
const UNKNOWN_MSG = "blocked: pubkey is not a registered Activity signing identity";
const UNAVAILABLE_MSG = "error: Activity signing keys are unavailable, retry later";

function request(
  kind,
  { id = "a".repeat(64), pubkey = KEY_A, sourceType = "IP4", sourceInfo = "203.0.113.7" } = {},
) {
  return { type: "new", event: { id, kind, pubkey }, receivedAt: 0, sourceType, sourceInfo };
}

function keyList(...keys) {
  return { data: keys.map((publicKey, index) => ({ sourceId: `source-${index}`, publicKey })) };
}

// A fake Activity API: `respond` returns the next Response; `calls` counts fetches.
function fakeApi(respond) {
  const api = {
    calls: 0,
    respond,
    fetch: async () => {
      api.calls += 1;
      return api.respond();
    },
  };
  return api;
}

function serving(body, status = 200) {
  return () => new Response(JSON.stringify(body), { status });
}

function failing() {
  throw new TypeError("fetch failed");
}

function setup(respond, { missRefreshMs = 5_000 } = {}) {
  const clock = { now: 0 };
  const api = fakeApi(respond);
  const signingKeys = createSigningKeyCache({
    url: "http://activity.test/api/v1/signing-keys",
    fetch: api.fetch,
    now: () => clock.now,
    missRefreshMs,
  });
  const decide = createPolicy({ now: () => clock.now, signingKeys });
  return { api, clock, decide, signingKeys };
}

test("accepts the kinds NEAR Builders apps publish and rejects others", async () => {
  const decide = createPolicy();
  for (const kind of [0, 1, 1111, 1701]) {
    assert.equal((await decide(request(kind))).action, "accept", `kind ${kind}`);
  }
  assert.deepEqual(await decide(request(4)), {
    id: "a".repeat(64),
    action: "reject",
    msg: "blocked: kind 4 is not accepted here",
  });
});

test("rate-limits each client address separately and refills over time", async () => {
  let clock = 0;
  const decide = createPolicy({ ratePerSecond: 2, burst: 3, now: () => clock });

  for (let index = 0; index < 3; index += 1) {
    assert.equal((await decide(request(1701))).action, "accept");
  }
  assert.equal((await decide(request(1701))).msg, "rate-limited: slow down");
  assert.equal((await decide(request(1701, { sourceInfo: "198.51.100.9" }))).action, "accept");

  clock += 500; // one token refilled at two per second
  assert.equal((await decide(request(1701))).action, "accept");
  assert.equal((await decide(request(1701))).action, "reject");
});

test("does not rate-limit operator imports, syncs, or streams", async () => {
  const decide = createPolicy({ ratePerSecond: 1, burst: 1, now: () => 0 });
  for (const sourceType of ["Import", "Sync", "Stream", "Import"]) {
    assert.equal((await decide(request(1701, { sourceType }))).action, "accept", sourceType);
  }
});

test("still enforces kinds on operator imports", async () => {
  assert.equal((await createPolicy()(request(30023, { sourceType: "Import" }))).action, "reject");
});

test("echoes the event id and rejects malformed requests", async () => {
  const decide = createPolicy();
  assert.equal((await decide(request(1, { id: "b".repeat(64) }))).id, "b".repeat(64));
  const malformed = await decide({ type: "other", event: { id: "c".repeat(64), kind: 1 } });
  assert.equal(malformed.action, "reject");
});

test("parses the kind allow list and rejects invalid entries", () => {
  assert.deepEqual([...parseKinds(" 1, 1701 ,,0")], [1, 1701, 0]);
  assert.throws(() => parseKinds("1,abc"), /Invalid kind/);
});

test("reports the blocked address to the operator log", async () => {
  const messages = [];
  const log = (message) => messages.push(message);
  const decide = createPolicy({ ratePerSecond: 1, burst: 1, now: () => 0 });
  await decide(request(4, { sourceInfo: "203.0.113.5" }), log);
  await decide(request(1701, { sourceInfo: "203.0.113.5" }), log);
  await decide(request(1701, { sourceInfo: "203.0.113.5" }), log);

  assert.deepEqual(messages, ["rejected kind 4 from IP4 203.0.113.5", "rate-limited 203.0.113.5"]);
});

test("accepts kind 1701 from a registered pubkey and rejects an unknown one", async () => {
  const { decide } = setup(serving(keyList(KEY_A)));
  const messages = [];

  assert.equal((await decide(request(1701))).action, "accept");
  assert.deepEqual(
    await decide(request(1701, { pubkey: KEY_UNKNOWN }), (message) => messages.push(message)),
    { id: "a".repeat(64), action: "reject", msg: UNKNOWN_MSG },
  );
  assert.deepEqual(messages, [
    `rejected unregistered pubkey ${"d4".repeat(8)} from IP4 203.0.113.7`,
  ]);
});

test("never checks the pubkey of kinds 0, 1, and 1111, even while keys are unavailable", async () => {
  const { api, decide } = setup(failing);
  for (const kind of [0, 1, 1111]) {
    assert.equal((await decide(request(kind, { pubkey: KEY_UNKNOWN }))).action, "accept");
  }
  assert.equal(api.calls, 0);
  assert.equal((await decide(request(1701))).msg, UNAVAILABLE_MSG);
});

test("a newly bound or rotated key is writable on its first write after the miss interval", async () => {
  const { api, clock, decide } = setup(serving(keyList(KEY_A)));
  assert.equal((await decide(request(1701))).action, "accept");
  assert.equal(api.calls, 1);

  api.respond = serving(keyList(KEY_A, KEY_B));
  clock.now = 1_000;
  assert.equal((await decide(request(1701, { pubkey: KEY_B }))).msg, UNKNOWN_MSG);
  assert.equal(api.calls, 1, "not refetched within the miss interval");

  clock.now = 5_000;
  assert.equal((await decide(request(1701, { pubkey: KEY_B }))).action, "accept");
  assert.equal(api.calls, 2);
  assert.equal((await decide(request(1701, { pubkey: KEY_B }))).action, "accept");
  assert.equal(api.calls, 2);
});

test("throttles refreshes caused by unknown pubkeys", async () => {
  const { api, clock, decide } = setup(serving(keyList(KEY_A)));
  for (let index = 0; index < 50; index += 1) {
    clock.now = index * 50;
    assert.equal((await decide(request(1701, { pubkey: KEY_UNKNOWN }))).msg, UNKNOWN_MSG);
  }
  assert.equal(api.calls, 1);
});

test("concurrent misses share one in-flight fetch", async () => {
  const { api, signingKeys } = setup(serving(keyList(KEY_A, KEY_B)));
  const results = await Promise.all([
    signingKeys.allows(KEY_A),
    signingKeys.allows(KEY_B),
    signingKeys.allows(KEY_UNKNOWN),
  ]);
  assert.deepEqual(results, ["allowed", "allowed", "unknown"]);
  assert.equal(api.calls, 1);
});

test("keeps stale keys while fetches fail and does not wait on fetches for misses", async () => {
  const { api, clock, decide, signingKeys } = setup(serving(keyList(KEY_A)));
  assert.equal((await decide(request(1701))).action, "accept");

  api.respond = failing;
  await signingKeys.refresh();
  assert.equal(api.calls, 2);

  clock.now = 60_000;
  assert.equal((await decide(request(1701))).action, "accept");
  assert.equal((await decide(request(1701, { pubkey: KEY_UNKNOWN }))).msg, UNKNOWN_MSG);
  assert.equal(api.calls, 2, "a miss does not fetch while the API is failing");

  api.respond = serving(keyList(KEY_A, KEY_B));
  await signingKeys.refresh();
  clock.now = 61_000;
  assert.equal((await decide(request(1701, { pubkey: KEY_B }))).action, "accept");
});

test("fails closed for kind 1701 until the first successful load, retrying on throttled misses", async () => {
  const { api, clock, signingKeys } = setup(failing);
  assert.equal(await signingKeys.allows(KEY_A), "unavailable");
  assert.equal(await signingKeys.allows(KEY_A), "unavailable");
  assert.equal(api.calls, 1, "misses inside the miss interval do not refetch");

  api.respond = serving(keyList(KEY_A));
  clock.now += 5_000;
  assert.equal(await signingKeys.allows(KEY_A), "allowed", "recovers without the periodic refresh");
  assert.equal(api.calls, 2);
});

test("treats malformed bodies and non-2xx responses as failures", async () => {
  for (const respond of [
    serving({ data: "x" }),
    serving({}),
    serving(keyList(KEY_A), 500),
    () => new Response("not json"),
  ]) {
    const { signingKeys } = setup(respond);
    assert.equal(await signingKeys.allows(KEY_A), "unavailable");
  }
});

test("ignores invalid entries in the key list", async () => {
  const body = {
    data: [
      { sourceId: "upper", publicKey: KEY_B.toUpperCase() },
      { sourceId: "short", publicKey: "ab" },
      { sourceId: "missing" },
      null,
      { sourceId: "good", publicKey: KEY_A },
    ],
  };
  const { signingKeys } = setup(serving(body));
  assert.equal(await signingKeys.allows(KEY_A), "allowed");
  assert.equal(await signingKeys.allows(KEY_B), "unknown");
});

test("a restore accepts events signed by retired keys and rejects keys of deleted sources", async () => {
  const { decide } = setup(serving(keyList(KEY_A, KEY_RETIRED)));
  for (const sourceType of ["IP4", "Import"]) {
    assert.equal(
      (await decide(request(1701, { pubkey: KEY_RETIRED, sourceType }))).action,
      "accept",
    );
    assert.equal(
      (await decide(request(1701, { pubkey: KEY_UNKNOWN, sourceType }))).msg,
      UNKNOWN_MSG,
      sourceType,
    );
  }
});

test("rate-limits before checking the pubkey, so floods trigger no fetches", async () => {
  const api = fakeApi(serving(keyList(KEY_A)));
  const signingKeys = createSigningKeyCache({ url: "http://activity.test", fetch: api.fetch });
  const decide = createPolicy({ ratePerSecond: 1, burst: 1, now: () => 0, signingKeys });

  assert.equal((await decide(request(1701))).action, "accept");
  assert.equal(api.calls, 1);
  assert.equal(
    (await decide(request(1701, { pubkey: KEY_UNKNOWN }))).msg,
    "rate-limited: slow down",
  );
  assert.equal(api.calls, 1);
});
