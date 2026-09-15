#!/usr/bin/env node
// Copies every event of the accepted kinds from a Nostr relay as JSONL on stdout, for
// `strfry import`. `strfry import` skips the write policy, so kinds are filtered here.
//
//   node infra/relay/export-relay.mjs wss://relay.example [--kinds=0,1,1111,1701] [--cap=500] > events.jsonl
//
// Pages backwards with `until`. A relay returns only the newest `cap` matches, so a full page may
// hold part of its oldest second: that second is dropped and re-read whole by the next page.
// Needs Node 22+ (global WebSocket).

import { DEFAULT_ALLOWED_KINDS, parseKinds } from "./write-policy.mjs";

const QUERY_TIMEOUT_MS = 30_000;

function option(name, fallback) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

function query(url, filter) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const events = [];
    const subscription = "export";
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out querying ${url}`));
    }, QUERY_TIMEOUT_MS);
    socket.addEventListener("open", () =>
      socket.send(JSON.stringify(["REQ", subscription, filter])),
    );
    socket.addEventListener("message", ({ data }) => {
      const [type, id, payload] = JSON.parse(String(data));
      if (id !== subscription) return;
      if (type === "EVENT") events.push(payload);
      if (type === "EOSE" || type === "CLOSED") {
        clearTimeout(timer);
        socket.close();
        if (type === "CLOSED") reject(new Error(`Relay closed the query: ${payload}`));
        else resolve(events);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`Could not connect to ${url}`));
    });
  });
}

async function main() {
  const url = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!url) {
    console.error("Usage: node export-relay.mjs <relay-url> [--kinds=0,1,1111,1701] [--cap=500]");
    process.exit(2);
  }
  const kinds = [...parseKinds(option("kinds", DEFAULT_ALLOWED_KINDS))];
  const cap = Number(option("cap", "500"));
  if (!Number.isInteger(cap) || cap < 2) throw new Error("--cap must be an integer of at least 2");

  const exported = new Set();
  let until;
  for (;;) {
    const page = await query(url, { kinds, limit: cap, ...(until === undefined ? {} : { until }) });
    let complete = page;
    let oldestSecond;
    if (page.length >= cap) {
      oldestSecond = Math.min(...page.map((event) => event.created_at));
      complete = page.filter((event) => event.created_at > oldestSecond);
      if (complete.length === 0) {
        throw new Error(`One second (${oldestSecond}) holds at least ${cap} events; raise --cap`);
      }
    }
    for (const event of complete) {
      if (exported.has(event.id)) continue;
      exported.add(event.id);
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
    if (oldestSecond === undefined) break;
    until = oldestSecond;
  }
  console.error(`Exported ${exported.size} events of kinds ${kinds.join(",")} from ${url}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
