import type { Filter } from "nostr-tools";
import { type Event, finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import { ActivityRelay, type ActivityRelayAdapter } from "@/activity/activity-relay";
import {
  ActivityFeedService,
  type ActivityIdentityStore,
  type ActivitySuppressionStore,
} from "@/services/activity-feed";

function signedActivityEvent(
  secretKey: Uint8Array,
  input: {
    source: string;
    eventType: string;
    actor: string;
    idempotencyKey: string;
    payload: unknown;
    createdAt: number;
  },
): Event {
  return finalizeEvent(
    {
      kind: 1701,
      created_at: input.createdAt,
      tags: [
        ["s", input.source],
        ["t", input.eventType],
        ["n", input.actor],
        ["i", input.idempotencyKey],
      ],
      content: JSON.stringify(input.payload),
    },
    secretKey,
  );
}

describe("ActivityFeedService", () => {
  it("returns only well-formed events signed by the registered Activity Source", async () => {
    const trustedKey = generateSecretKey();
    const untrustedKey = generateSecretKey();
    const valid = signedActivityEvent(trustedKey, {
      source: "feedback-rounds",
      eventType: "feedback.submitted",
      actor: "alice.near",
      idempotencyKey: "feedback:round-1:alice",
      payload: { rating: 5 },
      createdAt: 1_788_400_000,
    });
    const untrusted = signedActivityEvent(untrustedKey, {
      source: "feedback-rounds",
      eventType: "feedback.submitted",
      actor: "mallory.near",
      idempotencyKey: "feedback:forged",
      payload: { rating: 1 },
      createdAt: 1_788_400_001,
    });
    const malformed = { ...valid, id: "broken" } as Event;
    const forgedSignature = { ...valid, sig: "0".repeat(128) } as Event;
    const adapter: ActivityRelayAdapter = {
      publish: async () => "",
      query: async (_filter: Filter) =>
        [untrusted, null, malformed, forgedSignature, valid] as unknown as Event[],
      subscribe: () => ({ close: () => {} }),
      close: () => {},
    };
    const identities: ActivityIdentityStore = {
      listBound: async () => [{ sourceId: "feedback-rounds", publicKey: getPublicKey(trustedKey) }],
    };
    const service = new ActivityFeedService(
      new ActivityRelay(adapter, { scanLimit: 100 }),
      identities,
    );

    const result = await service.list({ source: "feedback-rounds", limit: 10 });

    expect(result).toEqual({
      data: [
        {
          id: valid.id,
          source: "feedback-rounds",
          type: "feedback.submitted",
          actor: "alice.near",
          idempotencyKey: "feedback:round-1:alice",
          timestamp: "2026-09-03T01:46:40.000Z",
          payload: { rating: 5 },
        },
      ],
      meta: { hasMore: false, nextCursor: null, skippedInvalid: 4 },
    });
  });

  it("deduplicates live relay delivery, ignores malformed events, and closes on cancellation", async () => {
    const trustedKey = generateSecretKey();
    const first = signedActivityEvent(trustedKey, {
      source: "live-source",
      eventType: "feedback.submitted",
      actor: "alice.near",
      idempotencyKey: "live:first",
      payload: { sequence: 1 },
      createdAt: 1_788_400_000,
    });
    const second = signedActivityEvent(trustedKey, {
      source: "live-source",
      eventType: "feedback.submitted",
      actor: "alice.near",
      idempotencyKey: "live:second",
      payload: { sequence: 2 },
      createdAt: 1_788_400_001,
    });
    let emit: ((event: Event) => void) | undefined;
    let subscribedFilter: Filter | undefined;
    const close = vi.fn();
    const adapter: ActivityRelayAdapter = {
      publish: async () => "",
      query: async () => [],
      subscribe: (filter, onEvent) => {
        subscribedFilter = filter;
        emit = onEvent;
        return { close };
      },
      close: () => {},
    };
    const identities: ActivityIdentityStore = {
      listBound: async () => [{ sourceId: "live-source", publicKey: getPublicKey(trustedKey) }],
    };
    const service = new ActivityFeedService(
      new ActivityRelay(adapter, { scanLimit: 100 }),
      identities,
    );
    const stream = service.stream({
      source: "live-source",
      eventType: "feedback.submitted",
      actor: "alice.near",
    });

    const firstResult = stream.next();
    await vi.waitFor(() => expect(emit).toEqual(expect.any(Function)));
    emit?.({ ...first, content: "not-json" });
    emit?.(first);
    await expect(firstResult).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ id: first.id, payload: { sequence: 1 } }),
    });

    const secondResult = stream.next();
    emit?.(first);
    emit?.(second);
    await expect(secondResult).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ id: second.id, payload: { sequence: 2 } }),
    });
    await stream.return(undefined);

    expect(subscribedFilter).toMatchObject({
      kinds: [1701],
      "#s": ["live-source"],
      "#t": ["feedback.submitted"],
      "#n": ["alice.near"],
      since: expect.any(Number),
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("rechecks suppression before yielding an event that was already queued", async () => {
    const trustedKey = generateSecretKey();
    const events = [1, 2, 3].map((sequence) =>
      signedActivityEvent(trustedKey, {
        source: "moderated-live-source",
        eventType: "feedback.submitted",
        actor: "alice.near",
        idempotencyKey: `moderated-live:${sequence}`,
        payload: { sequence },
        createdAt: 1_788_400_000 + sequence,
      }),
    );
    let emit: ((event: Event) => void) | undefined;
    const adapter: ActivityRelayAdapter = {
      publish: async () => "",
      query: async () => [],
      subscribe: (_filter, onEvent) => {
        emit = onEvent;
        return { close: () => {} };
      },
      close: () => {},
    };
    const identities: ActivityIdentityStore = {
      listBound: async () => [
        { sourceId: "moderated-live-source", publicKey: getPublicKey(trustedKey) },
      ],
    };
    const hidden = new Set<string>();
    const suppression: ActivitySuppressionStore = {
      findHiddenEventIds: async (eventIds) =>
        new Set(eventIds.filter((eventId) => hidden.has(eventId))),
      isHidden: async (eventId) => hidden.has(eventId),
    };
    const service = new ActivityFeedService(
      new ActivityRelay(adapter, { scanLimit: 100 }),
      identities,
      suppression,
    );
    const stream = service.stream({ source: "moderated-live-source" });

    const firstResult = stream.next();
    await vi.waitFor(() => expect(emit).toEqual(expect.any(Function)));
    emit?.(events[0]!);
    await expect(firstResult).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ id: events[0]?.id }),
    });

    emit?.(events[1]!);
    hidden.add(events[1]!.id);
    emit?.(events[2]!);
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ id: events[2]?.id }),
    });
    await stream.return(undefined);
  });

  it("does not trust a relay to honor an exact event ID moderation lookup", async () => {
    const trustedKey = generateSecretKey();
    const returned = signedActivityEvent(trustedKey, {
      source: "moderation-lookup-source",
      eventType: "feedback.submitted",
      actor: "alice.near",
      idempotencyKey: "moderation-lookup:returned",
      payload: { sequence: 1 },
      createdAt: 1_788_400_000,
    });
    const adapter: ActivityRelayAdapter = {
      publish: async () => "",
      query: async () => [returned],
      subscribe: () => ({ close: () => {} }),
      close: () => {},
    };
    const identities: ActivityIdentityStore = {
      listBound: async () => [
        { sourceId: "moderation-lookup-source", publicKey: getPublicKey(trustedKey) },
      ],
    };
    const service = new ActivityFeedService(
      new ActivityRelay(adapter, { scanLimit: 100 }),
      identities,
    );

    await expect(service.findTrustedEventByIdForModeration("f".repeat(64))).resolves.toBeNull();
  });
});
