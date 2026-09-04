import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import type { ActivityFeedEvent } from "@/contract";
import type { Database } from "@/db";
import { DatabaseActivityLeaderboardHistory } from "@/services/activity-leaderboard-history";

describe("DatabaseActivityLeaderboardHistory", () => {
  it("reads more than the relay scan limit from the durable submission ledger", async () => {
    const secretKey = generateSecretKey();
    const rows = Array.from({ length: 1_001 }, (_, index) => {
      const event = finalizeEvent(
        {
          kind: 1701,
          created_at: 1_788_307_200 + index,
          tags: [
            ["s", "history-source"],
            ["t", "history.scored"],
            ["n", `actor-${index}.near`],
            ["i", `history:${index}`],
          ],
          content: "{}",
        },
        secretKey,
      );
      return {
        eventId: event.id,
        eventJson: JSON.stringify(event),
        publishedAt: new Date("2026-09-03T12:00:00.000Z"),
        verified: {
          id: event.id,
          source: "history-source",
          type: "history.scored",
          actor: `actor-${index}.near`,
          idempotencyKey: `history:${index}`,
          timestamp: new Date(event.created_at * 1_000).toISOString(),
          payload: {},
          provenance: {
            signatureVerified: true as const,
            publicKey: getPublicKey(secretKey),
            signingIdentityStatus: "active" as const,
            sourceDisplayName: "History Source",
            integration: null,
            trustStatus: "standard" as const,
            scoreMultiplier: 1,
            payloadClaimsVerified: false as const,
          },
        },
      };
    });
    const database = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
    } as unknown as Database;
    const findVerifiedEventById = vi.fn();
    const verifyStoredEvents = vi.fn(
      async (records: readonly { eventId: string; eventJson: string }[]) =>
        records.flatMap(({ eventId }) => {
          const row = rows.find((candidate) => candidate.eventId === eventId);
          return row ? [row.verified] : [];
        }),
    );
    const history = new DatabaseActivityLeaderboardHistory(database, {
      findVerifiedEventById,
      verifyStoredEvents,
    });
    const replayed = [];

    for await (const event of history.list()) replayed.push(event);

    expect(replayed).toHaveLength(1_001);
    expect(replayed[0]).toMatchObject({
      source: "history-source",
      type: "history.scored",
      actor: "actor-0.near",
    });
    expect(findVerifiedEventById).not.toHaveBeenCalled();
    expect(verifyStoredEvents).toHaveBeenCalledOnce();
  });

  it("includes an uncommitted submission only when the relay confirms its exact event", async () => {
    const rows = [
      { eventId: "a".repeat(64), eventJson: "{}", publishedAt: null },
      { eventId: "b".repeat(64), eventJson: "{}", publishedAt: null },
    ];
    const database = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
    } as unknown as Database;
    const confirmed: ActivityFeedEvent = {
      id: rows[0]!.eventId,
      source: "history-source",
      type: "history.scored",
      actor: "alice.near",
      idempotencyKey: "history:confirmed",
      timestamp: "2026-09-03T12:00:00.000Z",
      payload: {},
      provenance: {
        signatureVerified: true,
        publicKey: "c".repeat(64),
        signingIdentityStatus: "active",
        sourceDisplayName: "History Source",
        integration: null,
        trustStatus: "standard",
        scoreMultiplier: 1,
        payloadClaimsVerified: false,
      },
    };
    const history = new DatabaseActivityLeaderboardHistory(database, {
      findVerifiedEventById: vi.fn(async (eventId) =>
        eventId === confirmed.id ? confirmed : null,
      ),
      verifyStoredEvents: vi.fn(async () => []),
    });
    const replayed = [];

    for await (const event of history.list()) replayed.push(event);

    expect(replayed).toEqual([confirmed]);
  });

  it("never replays a published event rejected by registered-source validation", async () => {
    const wrongSourceEvent = finalizeEvent(
      {
        kind: 1701,
        created_at: 1_788_307_200,
        tags: [
          ["s", "history-source"],
          ["t", "history.scored"],
          ["n", "mallory.near"],
          ["i", "history:mismatched-key"],
        ],
        content: "{}",
      },
      generateSecretKey(),
    );
    const rows = [
      {
        eventId: wrongSourceEvent.id,
        eventJson: JSON.stringify(wrongSourceEvent),
        publishedAt: new Date("2026-09-03T12:00:00.000Z"),
      },
    ];
    const database = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
    } as unknown as Database;
    const history = new DatabaseActivityLeaderboardHistory(database, {
      findVerifiedEventById: vi.fn(),
      verifyStoredEvents: vi.fn(async () => []),
    });
    const replayed = [];

    for await (const event of history.list()) replayed.push(event);

    expect(replayed).toEqual([]);
  });
});
