import { afterAll, describe, expect, it } from "vitest";
import { adminContext, getPluginBaseUrl, getPluginClient, teardown } from "../setup";
import { provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

describe("Activity event retraction by source", () => {
  it("lets a source hide only its own events, idempotently, with a source-attributed audit", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "retraction-source",
      ownerId: "retraction-owner",
      organizationId: "org-retraction",
      eventType: "claim.approved",
    });
    const { secret: otherSecret } = await provisionIngestionSource({
      sourceId: "retraction-other",
      ownerId: "retraction-other-owner",
      organizationId: "org-retraction-other",
      eventType: "claim.approved",
    });
    const gateway = await getPluginClient(undefined, { authorization: `Bearer ${secret}` });
    const otherGateway = await getPluginClient(undefined, {
      authorization: `Bearer ${otherSecret}`,
    });
    const retracted = await gateway.submitActivityEvent({
      eventType: "claim.approved",
      actor: "alice.near",
      idempotencyKey: "claim:1",
      payload: { claim: 1 },
    });
    const kept = await gateway.submitActivityEvent({
      eventType: "claim.approved",
      actor: "bob.near",
      idempotencyKey: "claim:2",
      payload: { claim: 2 },
    });
    const publicClient = await getPluginClient();

    await expect(
      publicClient.retractActivityEvent({
        eventId: retracted.eventId,
        reason: "no key",
        idempotencyKey: "retract:none",
      }),
    ).rejects.toThrow("Source API Key required");
    await expect(
      otherGateway.retractActivityEvent({
        eventId: retracted.eventId,
        reason: "another source's event",
        idempotencyKey: "retract:foreign",
      }),
    ).rejects.toThrow("A source can only retract its own Activity events");

    const first = await gateway.retractActivityEvent({
      eventId: retracted.eventId,
      reason: "Claim compensation",
      idempotencyKey: "retract:claim:1",
    });
    expect(first.requestReplayed).toBe(false);
    expect(first.projection).toMatchObject({ operation: "exclude", applied: true });
    expect(first.hiddenEvent.hiddenBy).toBe("source:retraction-source");

    const replay = await gateway.retractActivityEvent({
      eventId: retracted.eventId,
      reason: "Claim compensation",
      idempotencyKey: "retract:claim:1",
    });
    expect(replay.requestReplayed).toBe(true);
    await expect(
      gateway.retractActivityEvent({
        eventId: retracted.eventId,
        reason: "A different reason under the same key",
        idempotencyKey: "retract:claim:1",
      }),
    ).rejects.toThrow("Moderation idempotency key was already used for another request");

    await expect(
      gateway.submitActivityEvent({
        eventType: "claim.approved",
        actor: "alice.near",
        idempotencyKey: "claim:1",
        payload: { claim: 1 },
      }),
    ).resolves.toEqual({ eventId: retracted.eventId });

    const feed = await publicClient.listActivityEvents({ source: "retraction-source", limit: 20 });
    expect(feed.data.map(({ id }) => id)).toEqual([kept.eventId]);
    const leaderboard = await publicClient.getActivityLeaderboard({
      period: "all-time",
      source: "retraction-source",
      limit: 10,
    });
    expect(leaderboard.data.map(({ actor }) => actor)).toEqual(["bob.near"]);

    const administrator = await getPluginClient(adminContext());
    const hidden = await administrator.listHiddenActivityEvents();
    expect(hidden.find(({ event }) => event.id === retracted.eventId)).toMatchObject({
      hiddenBy: "source:retraction-source",
      reason: "Claim compensation",
    });
  });

  it("rejects an unknown or revoked key over public HTTP", async () => {
    const response = await fetch(
      `${await getPluginBaseUrl()}/v1/events/${"a".repeat(64)}/retract`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer act_not_a_real_key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "probe", idempotencyKey: "retract:probe" }),
      },
    );
    expect(response.status).toBe(401);
  });
});
