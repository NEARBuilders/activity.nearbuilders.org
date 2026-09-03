import type { Filter } from "nostr-tools";
import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import { type Event, verifyEvent } from "nostr-tools/pure";
import WebSocket from "ws";

useWebSocketImplementation(WebSocket);

export const ACTIVITY_EVENT_KIND = 1701;

export type ActivityQuery = {
  source?: string;
  eventType?: string;
  actor?: string;
  idempotencyKey?: string;
  limit?: number;
  cursor?: string | null;
};

export type ActivityQueryResult = {
  events: Event[];
  nextCursor: string | null;
};

export interface ActivityRelayAdapter {
  publish(event: Event): Promise<string>;
  query(filter: Filter): Promise<Event[]>;
  subscribe(filter: Filter, onEvent: (event: Event) => void): { close: () => void };
  close(): void;
}

type ActivityCursor = {
  createdAt: number;
  id: string;
};

function encodeCursor(event: Event): string {
  return Buffer.from(JSON.stringify({ createdAt: event.created_at, id: event.id })).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): ActivityCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as ActivityCursor;
    if (!Number.isInteger(value.createdAt) || !/^[0-9a-f]{64}$/.test(value.id)) throw new Error();
    return value;
  } catch {
    throw new Error("Activity cursor is invalid");
  }
}

function compareEvents(left: Event, right: Event): number {
  return right.created_at - left.created_at || right.id.localeCompare(left.id);
}

function activityFilter(input: ActivityQuery): Filter {
  const filter: Filter = { kinds: [ACTIVITY_EVENT_KIND] };
  if (input.source) filter["#s"] = [input.source];
  if (input.eventType) filter["#t"] = [input.eventType];
  if (input.actor) filter["#n"] = [input.actor];
  if (input.idempotencyKey) filter["#i"] = [input.idempotencyKey];
  return filter;
}

export class NostrRelayAdapter implements ActivityRelayAdapter {
  readonly #relayUrl: string;
  readonly #pool = new SimplePool({ enablePing: true, enableReconnect: true });

  constructor(relayUrl: string) {
    this.#relayUrl = relayUrl;
  }

  async publish(event: Event): Promise<string> {
    const relay = await this.#pool.ensureRelay(this.#relayUrl, { connectionTimeout: 5_000 });
    return relay.publish(event);
  }

  query(filter: Filter): Promise<Event[]> {
    return this.#pool.querySync([this.#relayUrl], filter, { maxWait: 5_000 });
  }

  subscribe(filter: Filter, onEvent: (event: Event) => void): { close: () => void } {
    return this.#pool.subscribeMany([this.#relayUrl], filter, {
      onevent: onEvent,
      maxWait: 5_000,
    });
  }

  close(): void {
    this.#pool.destroy();
  }
}

export class ActivityRelay {
  readonly #adapter: ActivityRelayAdapter;
  readonly #scanLimit: number;

  constructor(adapter: ActivityRelayAdapter, options: { scanLimit: number }) {
    this.#adapter = adapter;
    this.#scanLimit = options.scanLimit;
  }

  async publish(event: Event): Promise<{ accepted: true; message: string }> {
    if (event.kind !== ACTIVITY_EVENT_KIND || !verifyEvent(event)) {
      throw new Error("Activity event must use the configured kind and have a valid signature");
    }
    return { accepted: true, message: await this.#adapter.publish(event) };
  }

  async query(input: ActivityQuery): Promise<ActivityQueryResult> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const filter = activityFilter(input);
    filter.limit = this.#scanLimit;
    if (cursor) filter.until = cursor.createdAt;

    const events = await this.#adapter.query(filter);
    if (events.length >= this.#scanLimit) {
      throw new Error("Activity relay query reached its scan limit");
    }
    const pageCandidates = events.sort(compareEvents).filter((event) => {
      if (!cursor) return true;
      return (
        event.created_at < cursor.createdAt ||
        (event.created_at === cursor.createdAt && event.id.localeCompare(cursor.id) < 0)
      );
    });
    const page = pageCandidates.slice(0, limit);
    const lastEvent = page.at(-1);
    return {
      events: page,
      nextCursor: pageCandidates.length > limit && lastEvent ? encodeCursor(lastEvent) : null,
    };
  }

  subscribe(input: ActivityQuery, onEvent: (event: Event) => void): { close: () => void } {
    return this.#adapter.subscribe(activityFilter(input), onEvent);
  }

  close(): void {
    this.#adapter.close();
  }
}
