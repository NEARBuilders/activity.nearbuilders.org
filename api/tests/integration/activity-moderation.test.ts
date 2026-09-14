import { afterAll, describe, expect, it } from "vitest";
import {
  adminContext,
  getPluginBaseUrl,
  getPluginClient,
  getTestRelayEvents,
  getTestRelaySubscriptionCount,
  redeliverTestRelayEvent,
  resetTestRelayEvents,
  teardown,
} from "../setup";
import { readSseEventFrame, withTestTimeout } from "./activity-stream-test-helpers";
import { provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

describe("Activity event moderation", () => {
  it("keeps hidden relay events out of feeds and replay with an idempotent audit trail", async () => {
    const { owner, secret } = await provisionIngestionSource({
      sourceId: "moderation-source",
      ownerId: "moderation-owner",
      organizationId: "org-moderation",
      eventType: "feedback.submitted",
    });
    const gateway = await getPluginClient(undefined, {
      authorization: `Bearer ${secret}`,
    });
    resetTestRelayEvents();
    const first = await gateway.submitActivityEvent({
      eventType: "feedback.submitted",
      actor: "alice.near",
      idempotencyKey: "moderation:first",
      payload: { sequence: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const hidden = await gateway.submitActivityEvent({
      eventType: "feedback.submitted",
      actor: "bob.near",
      idempotencyKey: "moderation:hidden",
      payload: { sequence: 2 },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const visible = await gateway.submitActivityEvent({
      eventType: "feedback.submitted",
      actor: "carol.near",
      idempotencyKey: "moderation:visible",
      payload: { sequence: 3 },
    });
    const raceCandidate = await gateway.submitActivityEvent({
      eventType: "feedback.submitted",
      actor: "race.near",
      idempotencyKey: "moderation:race",
      payload: { sequence: 4 },
    });
    const futureHidden = await gateway.submitActivityEvent({
      eventType: "feedback.submitted",
      actor: "dave.near",
      idempotencyKey: "moderation:future-hidden",
      payload: { sequence: 5 },
    });
    const relayBeforeModeration = structuredClone(getTestRelayEvents());
    const publicClient = await getPluginClient();

    await expect(
      publicClient.hideActivityEvent({
        eventId: hidden.eventId,
        reason: "Public clients cannot moderate",
        idempotencyKey: "public-hide",
      }),
    ).rejects.toThrow("Authentication required");
    await expect(publicClient.listHiddenActivityEvents()).rejects.toThrow(
      "Authentication required",
    );
    await expect(
      owner.hideActivityEvent({
        eventId: hidden.eventId,
        reason: "Source owners cannot moderate",
        idempotencyKey: "owner-hide",
      }),
    ).rejects.toThrow("Requires role: admin");
    await expect(owner.listHiddenActivityEvents()).rejects.toThrow("Requires role: admin");

    const administrator = await getPluginClient(adminContext("moderator-1"));
    const firstHide = await administrator.hideActivityEvent({
      eventId: hidden.eventId,
      reason: "Contains private feedback",
      idempotencyKey: "hide-hidden-v1",
    });
    const retried = await administrator.hideActivityEvent({
      eventId: hidden.eventId,
      reason: "Contains private feedback",
      idempotencyKey: "hide-hidden-v1",
    });
    await expect(
      administrator.hideActivityEvent({
        eventId: hidden.eventId,
        reason: "A conflicting retry",
        idempotencyKey: "hide-hidden-v1",
      }),
    ).rejects.toThrow("Moderation idempotency key was already used for another request");

    const secondAdministrator = await getPluginClient(adminContext("moderator-2"));
    const repeated = await secondAdministrator.hideActivityEvent({
      eventId: hidden.eventId,
      reason: "Independent review confirmed suppression",
      idempotencyKey: "hide-hidden-v2",
    });
    const concurrentAnchorHides = await Promise.all([
      secondAdministrator.hideActivityEvent({
        eventId: first.eventId,
        reason: "Hide the resume anchor",
        idempotencyKey: "hide-anchor-v1",
      }),
      secondAdministrator.hideActivityEvent({
        eventId: first.eventId,
        reason: "Hide the resume anchor",
        idempotencyKey: "hide-anchor-v1",
      }),
    ]);
    const concurrentDistinctHides = await Promise.all([
      administrator.hideActivityEvent({
        eventId: raceCandidate.eventId,
        reason: "First concurrent review",
        idempotencyKey: "hide-race-v1",
      }),
      secondAdministrator.hideActivityEvent({
        eventId: raceCandidate.eventId,
        reason: "Second concurrent review",
        idempotencyKey: "hide-race-v2",
      }),
    ]);
    await administrator.hideActivityEvent({
      eventId: futureHidden.eventId,
      reason: "Must stay hidden after relay redelivery",
      idempotencyKey: "hide-future-live-v1",
    });

    expect(firstHide).toMatchObject({
      hiddenEvent: {
        event: {
          id: hidden.eventId,
          source: "moderation-source",
          type: "feedback.submitted",
          actor: "bob.near",
          idempotencyKey: "moderation:hidden",
          payload: { sequence: 2 },
        },
        hiddenBy: "moderator-1",
        reason: "Contains private feedback",
        hiddenAt: expect.any(String),
        moderationHistory: [
          expect.objectContaining({
            administratorId: "moderator-1",
            idempotencyKey: "hide-hidden-v1",
            applied: true,
          }),
        ],
      },
      projection: {
        updateId: `activity-hide:${hidden.eventId}`,
        operation: "exclude",
        eventId: hidden.eventId,
        source: "moderation-source",
        type: "feedback.submitted",
        actor: "bob.near",
        idempotencyKey: "moderation:hidden",
        eventTimestamp: expect.any(String),
        hiddenAt: expect.any(String),
        applied: true,
      },
      requestReplayed: false,
    });
    expect(retried.requestReplayed).toBe(true);
    expect(retried.projection.applied).toBe(false);
    expect(retried.hiddenEvent.moderationHistory).toHaveLength(1);
    expect(repeated).toMatchObject({
      hiddenEvent: {
        hiddenBy: "moderator-1",
        reason: "Contains private feedback",
        moderationHistory: [
          expect.objectContaining({ administratorId: "moderator-1", applied: true }),
          expect.objectContaining({ administratorId: "moderator-2", applied: false }),
        ],
      },
      projection: { applied: false },
      requestReplayed: false,
    });
    expect(concurrentAnchorHides.map(({ requestReplayed }) => requestReplayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(concurrentAnchorHides.map(({ projection }) => projection.applied).sort()).toEqual([
      false,
      true,
    ]);
    expect(concurrentDistinctHides.map(({ projection }) => projection.applied).sort()).toEqual([
      false,
      true,
    ]);
    expect(concurrentDistinctHides.map(({ projection }) => projection.updateId)).toEqual([
      `activity-hide:${raceCandidate.eventId}`,
      `activity-hide:${raceCandidate.eventId}`,
    ]);

    const adminInspection = await secondAdministrator.listHiddenActivityEvents();
    expect(adminInspection).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ id: hidden.eventId, actor: "bob.near" }),
          moderationHistory: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String),
              administratorId: "moderator-1",
              reason: "Contains private feedback",
              requestedAt: expect.any(String),
              applied: true,
            }),
            expect.objectContaining({
              id: expect.any(String),
              administratorId: "moderator-2",
              reason: "Independent review confirmed suppression",
              requestedAt: expect.any(String),
              applied: false,
            }),
          ]),
        }),
      ]),
    );
    expect(getTestRelayEvents()).toEqual(relayBeforeModeration);

    const feed = await publicClient.listActivityEvents({
      source: "moderation-source",
      limit: 1,
    });
    expect(feed.data.map(({ id }) => id)).toEqual([visible.eventId]);
    expect(feed.meta).toMatchObject({ hasMore: false, nextCursor: null, skippedInvalid: 0 });

    const resumedClient = await getPluginClient(undefined, {
      "last-event-id": first.eventId,
    });
    const typedStream = await resumedClient.streamActivityEvents({
      source: "moderation-source",
    });
    try {
      await expect(withTestTimeout(typedStream.next())).resolves.toEqual({
        done: false,
        value: expect.objectContaining({ id: visible.eventId, payload: { sequence: 3 } }),
      });
    } finally {
      await typedStream.return?.();
    }

    const response = await withTestTimeout(
      fetch(`${await getPluginBaseUrl()}/v1/events/stream?source=moderation-source`, {
        headers: { "last-event-id": first.eventId },
      }),
    );
    const reader = response.body?.getReader();
    expect(response.status).toBe(200);
    expect(reader).toBeDefined();
    try {
      const frame = await readSseEventFrame(reader!);
      expect(frame).toMatch(new RegExp(`^id:\\s*${visible.eventId}$`, "m"));
      expect(frame).not.toContain(hidden.eventId);
    } finally {
      await reader?.cancel();
    }

    const liveStream = await publicClient.streamActivityEvents({
      source: "moderation-source",
      actor: "dave.near",
    });
    try {
      const nextVisible = liveStream.next();
      await expect.poll(() => getTestRelaySubscriptionCount()).toBeGreaterThan(0);
      redeliverTestRelayEvent(futureHidden.eventId);
      const sentinel = await gateway.submitActivityEvent({
        eventType: "feedback.submitted",
        actor: "dave.near",
        idempotencyKey: "moderation:future-visible",
        payload: { sequence: 6 },
      });
      await expect(withTestTimeout(nextVisible)).resolves.toEqual({
        done: false,
        value: expect.objectContaining({ id: sentinel.eventId, payload: { sequence: 6 } }),
      });
    } finally {
      await liveStream.return?.();
    }
  });

  it("rejects an unknown trusted-format event ID", async () => {
    const administrator = await getPluginClient(adminContext("moderator-unknown"));

    await expect(
      administrator.hideActivityEvent({
        eventId: "f".repeat(64),
        reason: "No such event",
        idempotencyKey: "unknown-event-v1",
      }),
    ).rejects.toThrow("Activity event not found");
  });
});
