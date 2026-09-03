import { performance } from "node:perf_hooks";
import { createRedisActivityLeaderboard } from "@/services/activity-leaderboard";

const ACTOR_COUNT = 10_000;
const EVENT_TYPE_COUNT = 50;
const TOP_COUNT = 100;
const MAX_QUERY_MS = 500;
const source = "benchmark";
const timestamp = "2026-09-03T12:00:00.000Z";
const pointValues = Array.from({ length: EVENT_TYPE_COUNT }, (_, index) => ({
  source,
  type: `activity.${index}`,
  pointValue: index + 1,
}));
const leaderboard = await createRedisActivityLeaderboard({
  redisUrl: process.env.ACTIVITY_REDIS_URL ?? "redis://127.0.0.1:6380",
  namespace: "activity:leaderboard:benchmark",
  listPointValues: async () => pointValues,
  now: () => new Date(timestamp),
});

try {
  await leaderboard.rebuild({ events: [], hiddenEvents: [] });
  for (let start = 0; start < ACTOR_COUNT; start += 500) {
    await Promise.all(
      Array.from({ length: Math.min(500, ACTOR_COUNT - start) }, (_, offset) => {
        const index = start + offset;
        return leaderboard.apply({
          operation: "include",
          event: {
            id: index.toString(16).padStart(64, "0"),
            source,
            type: `activity.${index % EVENT_TYPE_COUNT}`,
            actor: `actor-${index.toString().padStart(5, "0")}.near`,
            timestamp,
          },
        });
      }),
    );
  }

  const startedAt = performance.now();
  const result = await leaderboard.getLeaderboard({ period: "all-time", limit: TOP_COUNT });
  const queryMs = performance.now() - startedAt;
  if (result.data.length !== TOP_COUNT) {
    throw new Error(`Expected ${TOP_COUNT} results, received ${result.data.length}`);
  }
  if (queryMs > MAX_QUERY_MS) {
    throw new Error(`Leaderboard query took ${queryMs.toFixed(2)}ms, over ${MAX_QUERY_MS}ms`);
  }
  console.log(
    JSON.stringify(
      {
        actors: ACTOR_COUNT,
        eventTypes: EVENT_TYPE_COUNT,
        top: TOP_COUNT,
        queryMs: Number(queryMs.toFixed(2)),
        maximumMs: MAX_QUERY_MS,
        fastestScore: result.data[0]?.score,
      },
      null,
      2,
    ),
  );
} finally {
  await leaderboard.rebuild({ events: [], hiddenEvents: [] });
  await leaderboard.close();
}
