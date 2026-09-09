import { randomUUID } from "node:crypto";
import { createClient } from "redis";

const redis = createClient({ url: "redis://127.0.0.1:6379" });
await redis.connect();

// Verify EXPIREAT with a past timestamp
const key = `test:expireat:${randomUUID()}`;
await redis.zAdd(key, [{ score: 1, value: "alice" }]);

const pastTimestamp = Math.floor(new Date("2026-09-02T00:00:00.000Z").getTime() / 1000);
const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;

console.log("now", Date.now(), "ts now", Math.floor(Date.now() / 1000));
console.log("past ts", pastTimestamp, "future ts", futureTimestamp);

await redis.expireAt(key, pastTimestamp);
console.log("after past EXPIREAT, zCard", await redis.zCard(key));

await redis.zAdd(key, [{ score: 1, value: "alice" }]);
await redis.expireAt(key, futureTimestamp);
console.log("after future EXPIREAT, zCard", await redis.zCard(key));

await redis.del(key);
await redis.quit();
