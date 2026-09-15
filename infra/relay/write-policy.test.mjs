// Run with: node --test infra/relay/write-policy.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPolicy, parseKinds } from "./write-policy.mjs";

function request(
  kind,
  { id = "a".repeat(64), sourceType = "IP4", sourceInfo = "203.0.113.7" } = {},
) {
  return { type: "new", event: { id, kind }, receivedAt: 0, sourceType, sourceInfo };
}

test("accepts the kinds NEAR Builders apps publish and rejects others", () => {
  const decide = createPolicy();
  for (const kind of [0, 1, 1111, 1701]) {
    assert.equal(decide(request(kind)).action, "accept", `kind ${kind}`);
  }
  assert.deepEqual(decide(request(4)), {
    id: "a".repeat(64),
    action: "reject",
    msg: "blocked: kind 4 is not accepted here",
  });
});

test("rate-limits each client address separately and refills over time", () => {
  let clock = 0;
  const decide = createPolicy({ ratePerSecond: 2, burst: 3, now: () => clock });

  for (let index = 0; index < 3; index += 1) {
    assert.equal(decide(request(1701)).action, "accept");
  }
  assert.equal(decide(request(1701)).msg, "rate-limited: slow down");
  assert.equal(decide(request(1701, { sourceInfo: "198.51.100.9" })).action, "accept");

  clock += 500; // one token refilled at two per second
  assert.equal(decide(request(1701)).action, "accept");
  assert.equal(decide(request(1701)).action, "reject");
});

test("does not rate-limit operator imports, syncs, or streams", () => {
  const decide = createPolicy({ ratePerSecond: 1, burst: 1, now: () => 0 });
  for (const sourceType of ["Import", "Sync", "Stream", "Import"]) {
    assert.equal(decide(request(1701, { sourceType })).action, "accept", sourceType);
  }
});

test("still enforces kinds on operator imports", () => {
  assert.equal(createPolicy()(request(30023, { sourceType: "Import" })).action, "reject");
});

test("echoes the event id and rejects malformed requests", () => {
  const decide = createPolicy();
  assert.equal(decide(request(1, { id: "b".repeat(64) })).id, "b".repeat(64));
  assert.equal(decide({ type: "other", event: { id: "c".repeat(64), kind: 1 } }).action, "reject");
});

test("parses the kind allow list and rejects invalid entries", () => {
  assert.deepEqual([...parseKinds(" 1, 1701 ,,0")], [1, 1701, 0]);
  assert.throws(() => parseKinds("1,abc"), /Invalid kind/);
});
