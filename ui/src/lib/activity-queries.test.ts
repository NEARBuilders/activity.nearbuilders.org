import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { activityFeedOptions, activityLeaderboardOptions } from "@/lib/activity-queries";

it("reuses the SSR feed on hydration and isolates filter and cursor pages", async () => {
  const api = {
    listActivityEvents: vi
      .fn()
      .mockResolvedValue({ data: [], meta: { hasMore: false, skippedInvalid: 0 } }),
  };
  const server = new QueryClient();
  await server.prefetchQuery(activityFeedOptions(api, { source: "builders" }));
  const client = new QueryClient();
  hydrate(client, dehydrate(server));
  await client.fetchQuery(activityFeedOptions(api, { source: "builders" }));
  expect(api.listActivityEvents).toHaveBeenCalledTimes(1);
  await client.fetchQuery(activityFeedOptions(api, { source: "other" }));
  await client.fetchQuery(activityFeedOptions(api, { source: "builders" }, "page-2"));
  expect(api.listActivityEvents).toHaveBeenCalledTimes(3);
  server.clear();
  client.clear();
});

it("reuses the SSR leaderboard and fetches each selected period separately", async () => {
  const api = { getActivityLeaderboard: vi.fn().mockResolvedValue({ data: [] }) };
  const server = new QueryClient();
  await server.prefetchQuery(activityLeaderboardOptions(api, {}, "weekly"));
  const client = new QueryClient();
  hydrate(client, dehydrate(server));
  await client.fetchQuery(activityLeaderboardOptions(api, {}, "weekly"));
  expect(api.getActivityLeaderboard).toHaveBeenCalledTimes(1);
  await client.fetchQuery(activityLeaderboardOptions(api, {}, "monthly"));
  expect(api.getActivityLeaderboard).toHaveBeenCalledTimes(2);
  server.clear();
  client.clear();
});
