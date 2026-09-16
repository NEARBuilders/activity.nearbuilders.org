import { afterAll, describe, expect, it } from "vitest";
import { getPluginClient, getTestRelayEvents, teardown } from "../setup";
import { provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

const DAY_MS = 24 * 60 * 60 * 1_000;

describe("Activity events with an original timestamp", () => {
  it("signs history at its own time and keeps it out of the current leaderboard period", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "history-source",
      ownerId: "history-owner",
      organizationId: "org-history",
      eventType: "project.approved",
    });
    const gateway = await getPluginClient(undefined, { authorization: `Bearer ${secret}` });
    const occurredAt = new Date(Date.now() - 200 * DAY_MS);

    const imported = await gateway.submitActivityEvent({
      eventType: "project.approved",
      actor: "alice.near",
      idempotencyKey: "legacy:act_1",
      payload: { proposalId: "p1" },
      occurredAt: occurredAt.toISOString(),
    });
    const live = await gateway.submitActivityEvent({
      eventType: "project.approved",
      actor: "alice.near",
      idempotencyKey: "live:1",
      payload: { proposalId: "p2" },
    });

    const relayEvent = getTestRelayEvents().find(({ id }) => id === imported.eventId);
    expect(relayEvent?.created_at).toBe(Math.floor(occurredAt.getTime() / 1_000));

    const publicClient = await getPluginClient();
    const feed = await publicClient.listActivityEvents({ source: "history-source", limit: 10 });
    const importedEntry = feed.data.find(({ id }) => id === imported.eventId);
    expect(importedEntry?.timestamp.slice(0, 10)).toBe(occurredAt.toISOString().slice(0, 10));
    // Newest first: the live event sorts ahead of the imported one.
    expect(feed.data.map(({ id }) => id)).toEqual([live.eventId, imported.eventId]);

    const weekly = await publicClient.getActivityLeaderboard({
      period: "weekly",
      source: "history-source",
      limit: 10,
    });
    const allTime = await publicClient.getActivityLeaderboard({
      period: "all-time",
      source: "history-source",
      limit: 10,
    });
    expect(weekly.data[0]?.breakdown[0]?.eventCount).toBe(1);
    expect(allTime.data[0]?.breakdown[0]?.eventCount).toBe(2);
  });

  it("rejects a future or too-old timestamp before reserving the key", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "history-bounds",
      ownerId: "history-bounds-owner",
      organizationId: "org-history-bounds",
      eventType: "project.approved",
    });
    const gateway = await getPluginClient(undefined, { authorization: `Bearer ${secret}` });

    await expect(
      gateway.submitActivityEvent({
        eventType: "project.approved",
        actor: "alice.near",
        idempotencyKey: "bounds:future",
        payload: {},
        occurredAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      }),
    ).rejects.toThrow("occurredAt cannot be in the future");

    await expect(
      gateway.submitActivityEvent({
        eventType: "project.approved",
        actor: "alice.near",
        idempotencyKey: "bounds:ancient",
        payload: {},
        occurredAt: new Date(Date.now() - 4 * 365 * DAY_MS).toISOString(),
      }),
    ).rejects.toThrow("occurredAt is older than the relay accepts");

    // A rejected submission must not consume its idempotency key.
    const retried = await gateway.submitActivityEvent({
      eventType: "project.approved",
      actor: "alice.near",
      idempotencyKey: "bounds:future",
      payload: {},
    });
    expect(retried.eventId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("treats the same key with a different timestamp as a conflict", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "history-conflict",
      ownerId: "history-conflict-owner",
      organizationId: "org-history-conflict",
      eventType: "project.approved",
    });
    const gateway = await getPluginClient(undefined, { authorization: `Bearer ${secret}` });
    const occurredAt = new Date(Date.now() - 10 * DAY_MS).toISOString();
    const submission = {
      eventType: "project.approved" as const,
      actor: "alice.near",
      idempotencyKey: "conflict:1",
      payload: { proposalId: "p1" },
    };

    const first = await gateway.submitActivityEvent({ ...submission, occurredAt });
    await expect(gateway.submitActivityEvent({ ...submission, occurredAt })).resolves.toEqual(
      first,
    );
    await expect(
      gateway.submitActivityEvent({
        ...submission,
        occurredAt: new Date(Date.now() - 11 * DAY_MS).toISOString(),
      }),
    ).rejects.toThrow("Idempotency key was already used for a different Activity event");
  });
});
