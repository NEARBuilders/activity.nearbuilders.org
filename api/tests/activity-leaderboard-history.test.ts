import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
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
      };
    });
    const database = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
    } as unknown as Database;
    const findTrustedEventById = vi.fn();
    const history = new DatabaseActivityLeaderboardHistory(database, {
      findTrustedEventById,
    });
    const replayed = [];

    for await (const event of history.list()) replayed.push(event);

    expect(replayed).toHaveLength(1_001);
    expect(replayed[0]).toMatchObject({
      source: "history-source",
      type: "history.scored",
      actor: "actor-0.near",
    });
    expect(findTrustedEventById).not.toHaveBeenCalled();
  });

  it("includes an uncommitted submission only when the relay confirms its exact event", async () => {
    const rows = [
      { eventId: "a".repeat(64), eventJson: "{}", publishedAt: null },
      { eventId: "b".repeat(64), eventJson: "{}", publishedAt: null },
    ];
    const database = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
    } as unknown as Database;
    const confirmed = {
      id: rows[0]!.eventId,
      source: "history-source",
      type: "history.scored",
      actor: "alice.near",
      idempotencyKey: "history:confirmed",
      timestamp: "2026-09-03T12:00:00.000Z",
      payload: {},
    };
    const history = new DatabaseActivityLeaderboardHistory(database, {
      findTrustedEventById: vi.fn(async (eventId) => (eventId === confirmed.id ? confirmed : null)),
    });
    const replayed = [];

    for await (const event of history.list()) replayed.push(event);

    expect(replayed).toEqual([confirmed]);
  });
});
