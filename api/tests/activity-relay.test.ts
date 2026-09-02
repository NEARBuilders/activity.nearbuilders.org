import type { Event, Filter } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { ActivityRelay, type ActivityRelayAdapter } from "@/activity/activity-relay";

function eventWithId(id: string, createdAt: number): Event {
  return {
    id,
    pubkey: "1".repeat(64),
    created_at: createdAt,
    kind: 1701,
    tags: [["s", "cursor-source"]],
    content: "{}",
    sig: "2".repeat(128),
  };
}

describe("ActivityRelay", () => {
  it("paginates more than 500 equal-timestamp events without omission", async () => {
    const createdAt = 1_788_307_200;
    const events = Array.from({ length: 501 }, (_, index) =>
      eventWithId(index.toString(16).padStart(64, "0"), createdAt),
    );
    const adapter: ActivityRelayAdapter = {
      publish: async () => "",
      query: async (_filter: Filter) => events,
      subscribe: () => ({ close: () => {} }),
      close: () => {},
    };
    const relay = new ActivityRelay(adapter, { scanLimit: 1_000 });
    const receivedIds: string[] = [];
    let cursor: string | null = null;

    do {
      const page = await relay.query({ source: "cursor-source", limit: 100, cursor });
      receivedIds.push(...page.events.map(({ id }) => id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(receivedIds).toEqual(
      Array.from({ length: 501 }, (_, index) => (500 - index).toString(16).padStart(64, "0")),
    );
  });

  it("fails loudly when a relay response reaches the configured scan limit", async () => {
    const events = Array.from({ length: 1_000 }, (_, index) =>
      eventWithId(index.toString(16).padStart(64, "0"), 1_788_307_200),
    );
    const adapter: ActivityRelayAdapter = {
      publish: async () => "",
      query: async () => events,
      subscribe: () => ({ close: () => {} }),
      close: () => {},
    };

    await expect(
      new ActivityRelay(adapter, { scanLimit: 1_000 }).query({ source: "cursor-source" }),
    ).rejects.toThrow("Activity relay query reached its scan limit");
  });
});
