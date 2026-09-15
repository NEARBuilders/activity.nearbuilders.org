import type { Event } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { ActivityRelayScanLimitError } from "@/activity/activity-relay";
import {
  type SharedNostrClient,
  type SharedNostrFilter,
  SharedNostrRelayAdapter,
} from "@/activity/shared-nostr-relay";

const RELAY = "wss://relay.example";

function events(count: number): Event[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index.toString(16).padStart(64, "0"),
    pubkey: "1".repeat(64),
    created_at: 1_788_300_000 + index,
    kind: 1701,
    tags: [],
    content: "{}",
    sig: "2".repeat(128),
  }));
}

function sharedClient(result: { events: Event[]; limited: boolean }) {
  const filters: SharedNostrFilter[] = [];
  const client: SharedNostrClient = {
    publishEvent: async () => ({ eventId: "", statuses: [] }),
    queryEvents: async ({ filter }) => {
      filters.push(filter);
      return { events: result.events, meta: { limited: result.limited } };
    },
    subscribeEvents: async () => (async function* () {})(),
  };
  return { client, filters };
}

describe("SharedNostrRelayAdapter", () => {
  it("advertises its query cap and never requests more than it", async () => {
    const { client, filters } = sharedClient({ events: events(3), limited: false });
    const adapter = new SharedNostrRelayAdapter(client, RELAY);

    await adapter.query({ kinds: [1701], limit: 1_000 });

    expect(adapter.maxQueryLimit).toBe(500);
    expect(filters[0]?.limit).toBe(500);
  });

  it("returns a full page marked limited so the caller can page past it", async () => {
    const { client } = sharedClient({ events: events(500), limited: true });

    await expect(
      new SharedNostrRelayAdapter(client, RELAY).query({ kinds: [1701], limit: 500 }),
    ).resolves.toHaveLength(500);
  });

  it("fails loudly when a limited page is shorter than requested", async () => {
    const { client } = sharedClient({ events: events(300), limited: true });

    await expect(
      new SharedNostrRelayAdapter(client, RELAY).query({ kinds: [1701], limit: 500 }),
    ).rejects.toBeInstanceOf(ActivityRelayScanLimitError);
  });
});
