import { afterAll, describe, expect, it } from "vitest";
import {
  adminContext,
  getActivityLeaderboardService,
  getPluginBaseUrl,
  getPluginClient,
  teardown,
} from "../setup";
import { provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

describe("Activity leaderboard", () => {
  it("ranks ingested events with current weights and removes hidden events", async () => {
    const { owner, secret } = await provisionIngestionSource({
      sourceId: "leaderboard-source",
      ownerId: "leaderboard-owner",
      organizationId: "leaderboard-organization",
      eventType: "leaderboard.scored",
    });
    const gateway = await getPluginClient(undefined, { authorization: `Bearer ${secret}` });
    const first = await gateway.submitActivityEvent({
      eventType: "leaderboard.scored",
      actor: "alice.near",
      idempotencyKey: "leaderboard:alice:1",
      payload: { sequence: 1 },
    });
    await expect(
      gateway.submitActivityEvent({
        eventType: "leaderboard.scored",
        actor: "alice.near",
        idempotencyKey: "leaderboard:alice:1",
        payload: { sequence: 1 },
      }),
    ).resolves.toEqual(first);
    await gateway.submitActivityEvent({
      eventType: "leaderboard.scored",
      actor: "alice.near",
      idempotencyKey: "leaderboard:alice:2",
      payload: { sequence: 2 },
    });
    await gateway.submitActivityEvent({
      eventType: "leaderboard.scored",
      actor: "bob.near",
      idempotencyKey: "leaderboard:bob:1",
      payload: { sequence: 1 },
    });
    const publicClient = await getPluginClient();

    await expect(publicClient.getActivityLeaderboardStatus()).resolves.toMatchObject({
      state: "ready",
    });
    const statusResponse = await fetch(`${await getPluginBaseUrl()}/v1/leaderboard/status`);
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({ state: "ready" });

    const initial = await publicClient.getActivityLeaderboard({
      period: "all-time",
      source: "leaderboard-source",
      limit: 10,
    });
    expect(initial.data).toMatchObject([
      { rank: 1, actor: "alice.near", score: 10, eventCount: 2 },
      { rank: 2, actor: "bob.near", score: 5, eventCount: 1 },
    ]);
    const openApiResponse = await fetch(
      `${await getPluginBaseUrl()}/v1/leaderboard?period=all-time&source=leaderboard-source&limit=10`,
    );
    expect(openApiResponse.status).toBe(200);
    await expect(openApiResponse.json()).resolves.toMatchObject({
      period: "all-time",
      data: [
        { rank: 1, actor: "alice.near", score: 10, eventCount: 2 },
        { rank: 2, actor: "bob.near", score: 5, eventCount: 1 },
      ],
    });

    await owner.updateActivitySource({
      sourceId: "leaderboard-source",
      eventTypes: [
        {
          name: "leaderboard.scored",
          description: "Reweighted leaderboard events",
          enabled: true,
          pointValue: 12,
        },
      ],
    });
    const reweighted = await publicClient.getActivityLeaderboard({
      period: "all-time",
      source: "leaderboard-source",
      limit: 10,
    });
    expect(reweighted.data).toMatchObject([
      { rank: 1, actor: "alice.near", score: 24, eventCount: 2 },
      { rank: 2, actor: "bob.near", score: 12, eventCount: 1 },
    ]);

    const administrator = await getPluginClient(adminContext("leaderboard-moderator"));
    await administrator.updateActivitySourceTrust({
      sourceId: "leaderboard-source",
      trustStatus: "trusted",
      scoreMultiplier: 1.5,
      reason: "Established source with reviewed operating history",
    });
    const trustWeighted = await publicClient.getActivityLeaderboard({
      period: "all-time",
      source: "leaderboard-source",
      limit: 10,
    });
    expect(trustWeighted.data).toMatchObject([
      {
        rank: 1,
        actor: "alice.near",
        score: 36,
        eventCount: 2,
        breakdown: [
          {
            source: "leaderboard-source",
            sourceDisplayName: "leaderboard-source Source",
            type: "leaderboard.scored",
            pointValue: 12,
            trustStatus: "trusted",
            scoreMultiplier: 1.5,
            eventCount: 2,
            score: 36,
          },
        ],
      },
      { rank: 2, actor: "bob.near", score: 18, eventCount: 1 },
    ]);

    await administrator.hideActivityEvent({
      eventId: first.eventId,
      reason: "Exclude from leaderboard",
      idempotencyKey: "leaderboard-hide-1",
    });
    const afterHide = await publicClient.getActivityLeaderboard({
      period: "all-time",
      source: "leaderboard-source",
      limit: 10,
    });
    expect(afterHide.data).toMatchObject([
      { rank: 1, actor: "alice.near", score: 18, eventCount: 1 },
      { rank: 2, actor: "bob.near", score: 18, eventCount: 1 },
    ]);

    const hiddenEvents = (await administrator.listHiddenActivityEvents()).filter(
      ({ event }) => event.source === "leaderboard-source",
    );
    const replay = await publicClient.listActivityEvents({
      source: "leaderboard-source",
      limit: 100,
    });
    const leaderboard = await getActivityLeaderboardService();
    await expect(
      leaderboard.rebuild({
        events: replay.data,
        hiddenEvents: hiddenEvents.map(({ event }) => event),
      }),
    ).resolves.toEqual({ seen: 2, applied: 2, hidden: 1 });
    await expect(
      leaderboard.apply({ operation: "include", event: hiddenEvents[0]!.event }),
    ).resolves.toBe(false);
    await expect(
      publicClient.getActivityLeaderboard({
        period: "all-time",
        source: "leaderboard-source",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      projection: { state: "ready", seen: 2, applied: 2, hidden: 1 },
      data: [
        { rank: 1, actor: "alice.near", score: 18, eventCount: 1 },
        { rank: 2, actor: "bob.near", score: 18, eventCount: 1 },
      ],
    });
  });
});
