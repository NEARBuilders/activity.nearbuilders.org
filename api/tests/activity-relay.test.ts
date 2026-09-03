import type { Event, Filter } from "nostr-tools";
import { describe, expect, it } from "vitest";
import {
  ActivityCursorError,
  ActivityRelay,
  type ActivityRelayAdapter,
  ActivityRelayQueryTimeoutError,
  ActivityRelayUnavailableError,
  NostrRelayAdapter,
} from "@/activity/activity-relay";

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
  it("rejects when the relay connection cannot be established", async () => {
    const adapter = new NostrRelayAdapter("ws://127.0.0.1:1");

    await expect(adapter.publish(eventWithId("a".repeat(64), 1_788_307_200))).rejects.toThrow();
    adapter.close();
  });

  it("reports an unavailable relay instead of returning an empty feed", async () => {
    const relay = new ActivityRelay(new NostrRelayAdapter("ws://127.0.0.1:1"), {
      scanLimit: 1_000,
    });

    await expect(relay.query({})).rejects.toBeInstanceOf(ActivityRelayUnavailableError);
    relay.close();
  });

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

  it("rejects malformed cursors before querying the relay", async () => {
    let queried = false;
    const adapter: ActivityRelayAdapter = {
      publish: async () => "",
      query: async () => {
        queried = true;
        return [];
      },
      subscribe: () => ({ close: () => {} }),
      close: () => {},
    };

    await expect(
      new ActivityRelay(adapter, { scanLimit: 1_000 }).query({ cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(ActivityCursorError);
    expect(queried).toBe(false);
  });

  it("omits invalid relay values before creating the next cursor", async () => {
    const newest = eventWithId("f".repeat(64), 1_788_307_202);
    const invalid = eventWithId("e".repeat(64), 1_788_307_201);
    const oldest = eventWithId("d".repeat(64), 1_788_307_200);
    const adapter: ActivityRelayAdapter = {
      publish: async () => "",
      query: async () => [newest, invalid, oldest],
      subscribe: () => ({ close: () => {} }),
      close: () => {},
    };
    const relay = new ActivityRelay(adapter, { scanLimit: 1_000 });

    const result = await relay.query({ limit: 1 }, (event) => event.id !== invalid.id);

    expect(result.events).toEqual([newest]);
    expect(result.skippedInvalid).toBe(1);
    expect(result.nextCursor).not.toBeNull();
    const next = await relay.query(
      { limit: 1, cursor: result.nextCursor },
      (event) => event.id !== invalid.id,
    );
    expect(next.events).toEqual([oldest]);
    expect(next.nextCursor).toBeNull();
  });

  it("bounds relay queries that never settle", async () => {
    const adapter: ActivityRelayAdapter = {
      publish: async () => "",
      query: () => new Promise(() => {}),
      subscribe: () => ({ close: () => {} }),
      close: () => {},
    };

    await expect(
      new ActivityRelay(adapter, { scanLimit: 1_000, queryTimeoutMs: 10 }).query({}),
    ).rejects.toBeInstanceOf(ActivityRelayQueryTimeoutError);
  });
});
