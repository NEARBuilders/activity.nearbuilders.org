import type { Filter } from "nostr-tools";
import { type Event, finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { ActivityRelay, type ActivityRelayAdapter } from "@/activity/activity-relay";
import { ActivityFeedService, type ActivityIdentityStore } from "@/services/activity-feed";

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
});
