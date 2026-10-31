// Runs write-policy.mjs as strfry does (JSON lines on stdin and stdout) against a local key list.
// Run with: node --test infra/relay/write-policy.integration.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("./write-policy.mjs", import.meta.url));
const MISS_REFRESH_SECONDS = 0.05;
const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const KEY_UNKNOWN = "d4".repeat(32);

const api = { status: 200, keys: [KEY_A], requests: 0 };
let server;
let child;
const pendingReplies = [];

before(async () => {
  server = createServer((_request, response) => {
    api.requests += 1;
    const data = api.keys.map((publicKey) => ({ sourceId: publicKey.slice(0, 4), publicKey }));
    response.writeHead(api.status, { "content-type": "application/json" });
    response.end(JSON.stringify({ data }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  child = spawn(process.execPath, [PLUGIN], {
    env: {
      ...process.env,
      RELAY_SIGNING_KEYS_URL: `http://127.0.0.1:${server.address().port}/api/v1/signing-keys`,
      RELAY_SIGNING_KEYS_MISS_REFRESH_SECONDS: String(MISS_REFRESH_SECONDS),
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    pendingReplies.shift()?.(JSON.parse(line));
  });
});

after(async () => {
  child?.kill();
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
});

let sequence = 0;
function write(kind, pubkey) {
  sequence += 1;
  const id = sequence.toString(16).padStart(64, "0");
  const request = {
    type: "new",
    event: { id, kind, pubkey, created_at: 0, tags: [], content: "", sig: "" },
    receivedAt: 0,
    sourceType: "IP4",
    sourceInfo: "203.0.113.7",
  };
  const reply = new Promise((resolve) => pendingReplies.push(resolve));
  child.stdin.write(`${JSON.stringify(request)}\n`);
  return reply.then((decision) => {
    assert.equal(decision.id, id, "replies stay in request order");
    return decision;
  });
}

const waitPastMissInterval = () => sleep(MISS_REFRESH_SECONDS * 1000 * 2);

test("a restore republishes history from listed keys and rejects unlisted keys", async () => {
  const replies = await Promise.all([
    write(1701, KEY_A),
    write(1701, KEY_B),
    write(0, KEY_B),
    write(1111, KEY_UNKNOWN),
  ]);
  assert.deepEqual(
    replies.map(({ action }) => action),
    ["accept", "reject", "accept", "accept"],
  );
});

test("enforces the signing key list end to end", async () => {
  const [registered, unknown, note] = await Promise.all([
    write(1701, KEY_A),
    write(1701, KEY_UNKNOWN),
    write(1, KEY_UNKNOWN),
  ]);
  assert.equal(registered.action, "accept");
  assert.deepEqual(unknown, {
    id: unknown.id,
    action: "reject",
    msg: "blocked: pubkey is not a registered Activity signing identity",
  });
  assert.equal(note.action, "accept");

  api.keys = [KEY_A, KEY_B];
  await waitPastMissInterval();
  assert.equal((await write(1701, KEY_B)).action, "accept", "rotated key propagates on a miss");

  api.status = 500;
  await waitPastMissInterval();
  const requestsBefore = api.requests;
  assert.equal((await write(1701, KEY_UNKNOWN)).action, "reject");
  assert.equal(api.requests, requestsBefore + 1, "the miss refreshed and the refresh failed");
  assert.equal((await write(1701, KEY_A)).action, "accept", "stale keys keep working");
  assert.equal((await write(1701, KEY_B)).action, "accept");
});
