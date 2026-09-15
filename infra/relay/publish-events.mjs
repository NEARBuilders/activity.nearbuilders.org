#!/usr/bin/env node
// Replays JSONL events (from export-relay.mjs) into a relay over a normal client connection, so a
// restore needs no shell access to the relay host. Events pass the relay's write policy like any
// client write, and are paced below its per-address rate limit.
//
//   node infra/relay/publish-events.mjs wss://relay.nearbuilders.org [--rate=15] < events.jsonl
//
// Needs Node 22+ (global WebSocket). Exits non-zero if any event is rejected.

import { createInterface } from "node:readline";

const ACK_TIMEOUT_MS = 15_000;

function option(name, fallback) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

async function main() {
  const url = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!url) {
    console.error("Usage: node publish-events.mjs <relay-url> [--rate=15] < events.jsonl");
    process.exit(2);
  }
  const rate = Number(option("rate", "15"));
  if (!(rate > 0)) throw new Error("--rate must be a positive number");

  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`Could not connect to ${url}`)), {
      once: true,
    });
  });
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const [type, id, accepted, message] = JSON.parse(String(data));
    if (type === "OK") pending.get(id)?.({ accepted, message });
  });

  const counts = { stored: 0, duplicate: 0, rejected: 0 };
  const rejections = new Map();
  const lines = createInterface({ input: process.stdin, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    const startedAt = Date.now();
    const result = await new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ accepted: false, message: "error: no OK before timeout" }),
        ACK_TIMEOUT_MS,
      );
      pending.set(event.id, (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      });
      socket.send(JSON.stringify(["EVENT", event]));
    });
    pending.delete(event.id);
    if (result.accepted) {
      counts[String(result.message).startsWith("duplicate:") ? "duplicate" : "stored"] += 1;
    } else {
      counts.rejected += 1;
      rejections.set(result.message, (rejections.get(result.message) ?? 0) + 1);
    }
    const wait = 1000 / rate - (Date.now() - startedAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  socket.close();

  console.error(JSON.stringify({ ...counts, rejections: Object.fromEntries(rejections) }));
  if (counts.rejected > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
