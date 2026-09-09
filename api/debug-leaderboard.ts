import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { createRedisActivityLeaderboard } from "@/services/activity-leaderboard";

const redis = createClient({ url: "redis://127.0.0.1:6379" });
await redis.connect();
await redis.flushAll();

const ns = `activity:test:${randomUUID()}`;

let pointValue = 5;
const leaderboard = await createRedisActivityLeaderboard({
  redisUrl: "redis://127.0.0.1:6379",
  namespace: ns,
  listPointValues: async () => [{ source: "feedback", type: "feedback.written", pointValue }],
  now: () => new Date("2026-09-03T12:00:00.000Z"),
});

await leaderboard.rebuild({ events: [], hiddenEvents: [] });

const projectedEvent = {
  id: "1".repeat(64),
  source: "feedback",
  type: "feedback.written",
  actor: "alice.near",
  timestamp: "2026-09-02T12:00:00.000Z",
};

console.log("first apply", await leaderboard.apply({ operation: "include", event: projectedEvent }));
console.log("second apply", await leaderboard.apply({ operation: "include", event: projectedEvent }));

const keys = await redis.keys(`${ns}:*`);
console.log("redis keys:", keys.sort());

for (const key of keys.sort()) {
  const type = await redis.type(key);
  if (type === "hash") {
    const all = await redis.hGetAll(key);
    console.log(`${type} ${key}`, all);
  } else if (type === "zset") {
    const all = await redis.zRangeWithScores(key, 0, -1);
    console.log(`${type} ${key}`, all);
  } else if (type === "set") {
    const all = await redis.sMembers(key);
    console.log(`${type} ${key}`, all);
  } else {
    console.log(`${type} ${key}`);
  }
}

console.log("rank", JSON.stringify(await leaderboard.getLeaderboard({ period: "weekly", limit: 10 }), null, 2));

await leaderboard.close();
await redis.quit();
