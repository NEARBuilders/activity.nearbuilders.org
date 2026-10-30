import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import type { ActivityFeedEvent } from "@/contract";
import type { Database } from "@/db";
import { DatabaseActivityLeaderboardHistory } from "@/services/activity-leaderboard-history";

type SubmissionRow = {
  id: string;
  eventId: string | null;
  eventJson: string | null;
  publishedAt: Date | null;
  createdAt: Date;
};

function pagedDatabase(pages: readonly SubmissionRow[][], onPage?: () => void): Database {
  let page = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              onPage?.();
              return pages[page++] ?? [];
            },
          }),
        }),
      }),
    }),
  } as unknown as Database;
}

describe("DatabaseActivityLeaderboardHistory", () => {
  it("replays history in bounded batches, including a final partial batch", async () => {
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
        id: `${index}`.padStart(4, "0"),
        eventId: event.id,
        eventJson: JSON.stringify(event),
        publishedAt: new Date("2026-09-03T12:00:00.000Z"),
        createdAt: new Date(1_788_307_200_000 + index),
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
            approvalStatus: "approved" as const,
            scoreMultiplier: 1,
            payloadClaimsVerified: false as const,
          },
        },
      };
    });
    let queryCount = 0;
    const database = pagedDatabase(
      [
        rows.slice(0, 250),
        rows.slice(250, 500),
        rows.slice(500, 750),
        rows.slice(750, 1_000),
        rows.slice(1_000),
      ],
      () => queryCount++,
    );
    const findVerifiedEventById = vi.fn();
    const batchSizes: number[] = [];
    const verifyStoredEvents = vi.fn(
      async (records: readonly { eventId: string; eventJson: string }[]) => {
        batchSizes.push(records.length);
        return records.flatMap(({ eventId }) => {
          const row = rows.find((candidate) => candidate.eventId === eventId);
          return row ? [row.verified] : [];
        });
      },
    );
    const history = new DatabaseActivityLeaderboardHistory(database, {
      findVerifiedEventById,
      verifyStoredEvents,
    });
    const iterator = history.list();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(queryCount).toBe(1);
    expect(batchSizes).toEqual([250]);
    const replayed = first.value ? [first.value] : [];

    for await (const event of iterator) replayed.push(event);

    expect(replayed).toHaveLength(1_001);
    expect(replayed[0]).toMatchObject({
      source: "history-source",
      type: "history.scored",
      actor: "actor-0.near",
    });
    expect(findVerifiedEventById).not.toHaveBeenCalled();
    expect(batchSizes).toEqual([250, 250, 250, 250, 1]);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(250);
  });

  it("includes an uncommitted submission only when the relay confirms its exact event", async () => {
    const rows = [
      {
        id: "a",
        eventId: "a".repeat(64),
        eventJson: "{}",
        publishedAt: null,
        createdAt: new Date("2026-09-03T12:00:00.000Z"),
      },
      {
        id: "b",
        eventId: "b".repeat(64),
        eventJson: "{}",
        publishedAt: null,
        createdAt: new Date("2026-09-03T12:00:01.000Z"),
      },
    ];
    const database = pagedDatabase([rows]);
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
        approvalStatus: "approved",
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
        id: "wrong-source",
        eventId: wrongSourceEvent.id,
        eventJson: JSON.stringify(wrongSourceEvent),
        publishedAt: new Date("2026-09-03T12:00:00.000Z"),
        createdAt: new Date("2026-09-03T12:00:00.000Z"),
      },
    ];
    const database = pagedDatabase([rows]);
    const history = new DatabaseActivityLeaderboardHistory(database, {
      findVerifiedEventById: vi.fn(),
      verifyStoredEvents: vi.fn(async () => []),
    });
    const replayed = [];

    for await (const event of history.list()) replayed.push(event);

    expect(replayed).toEqual([]);
  });
});
