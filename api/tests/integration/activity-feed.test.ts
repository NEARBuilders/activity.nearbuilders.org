import { getEventMeta } from "every-plugin/orpc";
import { afterAll, describe, expect, it } from "vitest";
import {
  adminContext,
  getPluginBaseUrl,
  getPluginClient,
  getTestRelayEvents,
  getTestRelaySubscriptionCount,
  loseNextTestRelayAcknowledgement,
  resetTestRelayEvents,
  teardown,
} from "../setup";
import { readSseEventFrame, withTestTimeout } from "./activity-stream-test-helpers";
import { provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

describe("Activity event feed", () => {
  it("publicly filters and cursor-paginates trusted Activity events without overlap", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "feed-source",
      ownerId: "feed-owner",
      organizationId: "org-feed",
      eventType: "feedback.submitted",
    });
    const gateway = await getPluginClient(undefined, {
      authorization: `Bearer ${secret}`,
    });
    resetTestRelayEvents();
    const firstSubmitted = await gateway.submitActivityEvent({
      eventType: "feedback.submitted",
      actor: "alice.near",
      idempotencyKey: "feed:alice",
      payload: { rating: 5 },
    });
    const secondSubmitted = await gateway.submitActivityEvent({
      eventType: "feedback.submitted",
      actor: "bob.near",
      idempotencyKey: "feed:bob",
      payload: { rating: 4 },
    });
    const publicClient = await getPluginClient();

    const firstPage = await publicClient.listActivityEvents({
      source: "feed-source",
      type: "feedback.submitted",
      limit: 1,
    });
    const secondPage = await publicClient.listActivityEvents({
      source: "feed-source",
      type: "feedback.submitted",
      limit: 1,
      cursor: firstPage.meta.nextCursor ?? undefined,
    });

    expect(firstPage.meta.hasMore).toBe(true);
    expect(firstPage.meta.nextCursor).toEqual(expect.any(String));
    expect(secondPage.meta).toEqual({
      hasMore: false,
      nextCursor: null,
      skippedInvalid: 0,
    });
    expect([...firstPage.data, ...secondPage.data].map(({ id }) => id).sort()).toEqual(
      [firstSubmitted.eventId, secondSubmitted.eventId].sort(),
    );
    expect(new Set([...firstPage.data, ...secondPage.data].map(({ id }) => id)).size).toBe(2);

    const actorFiltered = await publicClient.listActivityEvents({ actor: "alice.near" });
    expect(actorFiltered.data).toEqual([
      expect.objectContaining({
        id: firstSubmitted.eventId,
        source: "feed-source",
        type: "feedback.submitted",
        actor: "alice.near",
        payload: { rating: 5 },
        provenance: {
          signatureVerified: true,
          publicKey: expect.stringMatching(/^[a-f0-9]{64}$/),
          signingIdentityStatus: "active",
          sourceDisplayName: "feed-source Source",
          integration: null,
          trustStatus: "standard",
          scoreMultiplier: 1,
          payloadClaimsVerified: false,
        },
      }),
    ]);

    const administrator = await getPluginClient(adminContext("feed-trust-admin"));
    await administrator.updateActivitySourceTrust({
      sourceId: "feed-source",
      trustStatus: "trusted",
      scoreMultiplier: 1.25,
      reason: "Public feed source reviewed",
    });
    await expect(publicClient.listActivityEvents({ actor: "alice.near" })).resolves.toMatchObject({
      data: [
        {
          id: firstSubmitted.eventId,
          provenance: { trustStatus: "trusted", scoreMultiplier: 1.25 },
        },
      ],
    });

    const rawResponse = await fetch(
      `${await getPluginBaseUrl()}/v1/events?source=feed-source&limit=1`,
    );
    const rawFeed = (await rawResponse.json()) as { data: unknown[] };
    expect(rawResponse.status).toBe(200);
    expect(rawFeed.data).toHaveLength(1);
  });

  it("rejects a malformed public feed cursor", async () => {
    const publicClient = await getPluginClient();

    await expect(publicClient.listActivityEvents({ cursor: "invalid" })).rejects.toThrow(
      "Activity cursor is invalid",
    );
  });

  it("validates historical events with the database-backed identity active when signed", async () => {
    const { owner, secret } = await provisionIngestionSource({
      sourceId: "rotation-history-source",
      ownerId: "rotation-history-owner",
      organizationId: "org-rotation-history",
      eventType: "rotation.recorded",
    });
    const gateway = await getPluginClient(undefined, {
      authorization: `Bearer ${secret}`,
    });
    const submitted = await gateway.submitActivityEvent({
      eventType: "rotation.recorded",
      actor: "historian.near",
      idempotencyKey: "rotation:before",
      payload: { sequence: 1 },
    });

    await owner.rotateActivitySigningIdentity({
      sourceId: "rotation-history-source",
      reason: "Scheduled production rotation",
    });

    const publicClient = await getPluginClient();
    const feed = await publicClient.listActivityEvents({
      source: "rotation-history-source",
      limit: 10,
    });
    expect(feed.data).toEqual([
      expect.objectContaining({
        id: submitted.eventId,
        provenance: expect.objectContaining({
          signatureVerified: true,
          signingIdentityStatus: "retired",
        }),
      }),
    ]);
  });

  it("streams newly submitted events that match all public feed filters", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "stream-source",
      ownerId: "stream-owner",
      organizationId: "org-stream",
      eventType: "feedback.submitted",
    });
    const gateway = await getPluginClient(undefined, {
      authorization: `Bearer ${secret}`,
    });
    const publicClient = await getPluginClient();
    const stream = await publicClient.streamActivityEvents({
      source: "stream-source",
      type: "feedback.submitted",
      actor: "alice.near",
    });

    try {
      const nextEvent = stream.next();
      await gateway.submitActivityEvent({
        eventType: "feedback.submitted",
        actor: "bob.near",
        idempotencyKey: "stream:bob",
        payload: { rating: 3 },
      });
      const submitted = await gateway.submitActivityEvent({
        eventType: "feedback.submitted",
        actor: "alice.near",
        idempotencyKey: "stream:alice",
        payload: { rating: 5 },
      });

      await expect(withTestTimeout(nextEvent)).resolves.toEqual({
        done: false,
        value: expect.objectContaining({
          id: submitted.eventId,
          source: "stream-source",
          type: "feedback.submitted",
          actor: "alice.near",
          payload: { rating: 5 },
        }),
      });
    } finally {
      await stream.return?.();
    }

    await expect.poll(() => getTestRelaySubscriptionCount()).toBe(0);
  });

  it("applies all filters and cancellation on the public SSE route", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "public-stream-source",
      ownerId: "public-stream-owner",
      organizationId: "org-public-stream",
      eventType: "feedback.submitted",
    });
    const gateway = await getPluginClient(undefined, {
      authorization: `Bearer ${secret}`,
    });
    const response = await withTestTimeout(
      fetch(
        `${await getPluginBaseUrl()}/v1/events/stream?source=public-stream-source&type=feedback.submitted&actor=alice.near`,
      ),
    );
    const reader = response.body?.getReader();
    expect(response.status).toBe(200);
    expect(reader).toBeDefined();

    try {
      await gateway.submitActivityEvent({
        eventType: "feedback.submitted",
        actor: "bob.near",
        idempotencyKey: "public-stream:bob",
        payload: { rating: 3 },
      });
      const submitted = await gateway.submitActivityEvent({
        eventType: "feedback.submitted",
        actor: "alice.near",
        idempotencyKey: "public-stream:alice",
        payload: { rating: 5 },
      });

      const frame = await readSseEventFrame(reader!);
      expect(frame).toMatch(new RegExp(`^id:\\s*${submitted.eventId}$`, "m"));
      expect(frame).toContain('"actor":"alice.near"');
      expect(frame).not.toContain('"actor":"bob.near"');
    } finally {
      await reader?.cancel();
    }

    await expect.poll(() => getTestRelaySubscriptionCount()).toBe(0);
  });

  it("replays events after Last-Event-ID before continuing live with stable SSE IDs", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "resume-source",
      ownerId: "resume-owner",
      organizationId: "org-resume",
      eventType: "session.recorded",
    });
    const gateway = await getPluginClient(undefined, {
      authorization: `Bearer ${secret}`,
    });
    const first = await gateway.submitActivityEvent({
      eventType: "session.recorded",
      actor: "speaker.near",
      idempotencyKey: "resume:first",
      payload: { sequence: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const second = await gateway.submitActivityEvent({
      eventType: "session.recorded",
      actor: "speaker.near",
      idempotencyKey: "resume:second",
      payload: { sequence: 2 },
    });
    const resumedClient = await getPluginClient(undefined, {
      "last-event-id": first.eventId,
    });
    const stream = await resumedClient.streamActivityEvents({ source: "resume-source" });

    try {
      const replayed = await withTestTimeout(stream.next());
      expect(replayed).toEqual({
        done: false,
        value: expect.objectContaining({ id: second.eventId, payload: { sequence: 2 } }),
      });
      expect(replayed.done ? undefined : getEventMeta(replayed.value)?.id).toBe(second.eventId);
    } finally {
      await stream.return?.();
    }

    const response = await withTestTimeout(
      fetch(`${await getPluginBaseUrl()}/v1/events/stream?source=resume-source`, {
        headers: { "last-event-id": first.eventId },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    try {
      const frame = await readSseEventFrame(reader!);
      expect(frame).toMatch(new RegExp(`^id:\\s*${second.eventId}$`, "m"));
      expect(frame).toContain('"sequence":2');
    } finally {
      await reader?.cancel();
    }
  });

  it("replays an event stored during a relay disconnect after reconnecting", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "reconnect-source",
      ownerId: "reconnect-owner",
      organizationId: "org-reconnect",
      eventType: "build.completed",
    });
    const gateway = await getPluginClient(undefined, {
      authorization: `Bearer ${secret}`,
    });
    const publicClient = await getPluginClient();
    const stream = await publicClient.streamActivityEvents({ source: "reconnect-source" });

    try {
      const replayedEvent = stream.next();
      loseNextTestRelayAcknowledgement();
      await expect(
        gateway.submitActivityEvent({
          eventType: "build.completed",
          actor: "builder.near",
          idempotencyKey: "reconnect:stored",
          payload: { result: "success" },
        }),
      ).rejects.toThrow("Activity relay did not acknowledge the event");
      const storedEvent = getTestRelayEvents().at(-1);

      await expect(withTestTimeout(replayedEvent, 5_000)).resolves.toEqual({
        done: false,
        value: expect.objectContaining({
          id: storedEvent?.id,
          source: "reconnect-source",
          payload: { result: "success" },
        }),
      });
    } finally {
      await stream.return?.();
    }
  });

  it("rejects malformed and unavailable Last-Event-ID values", async () => {
    for (const lastEventId of ["not-an-event-id", "f".repeat(64)]) {
      const client = await getPluginClient(undefined, { "last-event-id": lastEventId });
      const stream = await client.streamActivityEvents({ source: "resume-source" });
      await expect(stream.next()).rejects.toThrow(
        "Last-Event-ID is invalid or is not available in relay history",
      );
    }
  });
});
