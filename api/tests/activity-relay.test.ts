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

function newestFirst(left: Event, right: Event): number {
  return right.created_at - left.created_at || right.id.localeCompare(left.id);
}

/**
 * Behaves like a real relay: newest first, honouring `until` and a hard result cap. Ties within a
 * second come back in the opposite ID order to Activity's, so a partial second is a real subset.
 */
function limitedRelay(events: Event[], options: { maxQueryLimit: number }) {
  const requestedLimits: number[] = [];
  const adapter: ActivityRelayAdapter = {
    maxQueryLimit: options.maxQueryLimit,
    publish: async () => "",
    query: async (filter: Filter) => {
      requestedLimits.push(filter.limit ?? Number.POSITIVE_INFINITY);
      return events
        .filter((event) => filter.until === undefined || event.created_at <= filter.until)
        .sort(
          (left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id),
        )
        .slice(0, Math.min(filter.limit ?? options.maxQueryLimit, options.maxQueryLimit));
    },
    subscribe: () => ({ close: () => {} }),
    close: () => {},
  };
  return { adapter, requestedLimits };
}

async function readAll(relay: ActivityRelay, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await relay.query({ limit, cursor });
    ids.push(...page.events.map(({ id }) => id));
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
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

  it("fails loudly when a single second fills the scan", async () => {
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

  it("pages through history far larger than the scan limit without omission", async () => {
    // 1,250 events, five per second, so every full scan ends inside a partial second.
    const events = Array.from({ length: 1_250 }, (_, index) =>
      eventWithId(index.toString(16).padStart(64, "0"), 1_788_300_000 + Math.floor(index / 5)),
    );
    const { adapter, requestedLimits } = limitedRelay(events, { maxQueryLimit: 102 });
    const relay = new ActivityRelay(adapter, { scanLimit: 1_000 });

    const receivedIds = await readAll(relay, 100);

    expect(requestedLimits.every((limit) => limit === 102)).toBe(true);
    expect(receivedIds).toEqual([...events].sort(newestFirst).map(({ id }) => id));
  });

  it("continues past a scan whose complete events are all invalid", async () => {
    const valid = eventWithId("a".repeat(64), 1_788_300_000);
    const invalid = Array.from({ length: 12 }, (_, index) =>
      eventWithId(index.toString(16).padStart(64, "0"), 1_788_300_010 + index),
    );
    const { adapter } = limitedRelay([valid, ...invalid], { maxQueryLimit: 5 });
    const relay = new ActivityRelay(adapter, { scanLimit: 1_000 });
    const isValid = (event: Event) => event.id === valid.id;

    const first = await relay.query({ limit: 10 }, isValid);
    expect(first.events).toEqual([]);
    expect(first.nextCursor).not.toBeNull();

    const received: string[] = [];
    let cursor: string | null = first.nextCursor;
    while (cursor) {
      const page = await relay.query({ limit: 10, cursor }, isValid);
      received.push(...page.events.map(({ id }) => id));
      cursor = page.nextCursor;
    }
    expect(received).toEqual([valid.id]);
  });

  it("fails loudly only on reaching a second that alone fills the scan", async () => {
    const crowded = Array.from({ length: 6 }, (_, index) =>
      eventWithId(`c${index}`.padEnd(64, "0"), 1_788_300_000),
    );
    const newer = Array.from({ length: 8 }, (_, index) =>
      eventWithId(`d${index}`.padEnd(64, "0"), 1_788_300_001 + index),
    );
    const { adapter } = limitedRelay([...crowded, ...newer], { maxQueryLimit: 5 });
    const relay = new ActivityRelay(adapter, { scanLimit: 1_000 });

    const first = await relay.query({ limit: 100 });
    expect(first.events).toHaveLength(4);
    const second = await relay.query({ limit: 100, cursor: first.nextCursor });
    expect(second.events).toHaveLength(4);
    await expect(relay.query({ limit: 100, cursor: second.nextCursor })).rejects.toThrow(
      "Activity relay query reached its scan limit",
    );
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
