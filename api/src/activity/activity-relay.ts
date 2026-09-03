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
  skippedInvalid: number;
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

export class ActivityCursorError extends Error {
  constructor() {
    super("Activity cursor is invalid");
    this.name = "ActivityCursorError";
  }
}

export class ActivityRelayQueryTimeoutError extends Error {
  constructor() {
    super("Activity relay query timed out");
    this.name = "ActivityRelayQueryTimeoutError";
  }
}

export class ActivityRelayUnavailableError extends Error {
  constructor() {
    super("Activity relay is unavailable");
    this.name = "ActivityRelayUnavailableError";
  }
}

export class ActivityRelayScanLimitError extends Error {
  constructor() {
    super("Activity relay query reached its scan limit");
    this.name = "ActivityRelayScanLimitError";
  }
}

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
    throw new ActivityCursorError();
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
  readonly #pool = new SimplePool({ enablePing: true, enableReconnect: false });
  readonly #subscriptionClosers = new Set<() => void>();
  #destroyed = false;

  constructor(relayUrl: string) {
    this.#relayUrl = relayUrl;
  }

  async publish(event: Event): Promise<string> {
    const relay = await this.#pool.ensureRelay(this.#relayUrl, { connectionTimeout: 5_000 });
    return relay.publish(event);
  }

  async query(filter: Filter): Promise<Event[]> {
    const relay = await this.#pool
      .ensureRelay(this.#relayUrl, { connectionTimeout: 5_000 })
      .catch(() => {
        throw new ActivityRelayUnavailableError();
      });

    return new Promise<Event[]>((resolve, reject) => {
      const events: Event[] = [];
      let settled = false;
      let subscription: ReturnType<typeof relay.subscribe> | undefined;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        subscription?.close("Activity relay query timed out");
        reject(new ActivityRelayQueryTimeoutError());
      }, 5_000);
      const settle = (result: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        subscription?.close();
        result();
      };

      try {
        subscription = relay.subscribe([filter], {
          onevent: (event) => events.push(event),
          oneose: () => settle(() => resolve(events)),
          onclose: () => settle(() => reject(new ActivityRelayUnavailableError())),
          // The adapter timer above must report a missing EOSE instead of letting
          // nostr-tools turn its own EOSE timeout into a successful empty result.
          eoseTimeout: 6_000,
        });
      } catch {
        settle(() => reject(new ActivityRelayUnavailableError()));
      }
    });
  }

  subscribe(filter: Filter, onEvent: (event: Event) => void): { close: () => void } {
    let closed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { close: (reason?: string) => void } | undefined;
    let lastEventTimestamp = filter.since;
    const reconnectBackoffMs = [250, 500, 1_000, 2_000, 5_000] as const;

    const scheduleReconnect = () => {
      if (closed || this.#destroyed || reconnectTimer) return;
      const delay = reconnectBackoffMs[Math.min(reconnectAttempt, reconnectBackoffMs.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, delay);
    };
    const connect = async () => {
      if (closed || this.#destroyed) return;
      try {
        const relay = await this.#pool.ensureRelay(this.#relayUrl, { connectionTimeout: 5_000 });
        if (closed || this.#destroyed) return;
        subscription = relay.subscribe(
          [
            {
              ...filter,
              ...(lastEventTimestamp === undefined ? {} : { since: lastEventTimestamp }),
            },
          ],
          {
            onevent: (event) => {
              lastEventTimestamp = Math.max(lastEventTimestamp ?? 0, event.created_at);
              reconnectAttempt = 0;
              onEvent(event);
            },
            onclose: scheduleReconnect,
          },
        );
      } catch {
        scheduleReconnect();
      }
    };
    const close = () => {
      if (closed) return;
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      subscription?.close();
      this.#subscriptionClosers.delete(close);
    };
    this.#subscriptionClosers.add(close);
    void connect();
    return { close };
  }

  close(): void {
    this.#destroyed = true;
    for (const close of [...this.#subscriptionClosers]) close();
    this.#pool.destroy();
  }
}

export class ActivityRelay {
  readonly #adapter: ActivityRelayAdapter;
  readonly #scanLimit: number;
  readonly #queryTimeoutMs: number;

  constructor(
    adapter: ActivityRelayAdapter,
    options: { scanLimit: number; queryTimeoutMs?: number },
  ) {
    this.#adapter = adapter;
    this.#scanLimit = options.scanLimit;
    this.#queryTimeoutMs = options.queryTimeoutMs ?? 6_000;
  }

  async publish(event: Event): Promise<{ accepted: true; message: string }> {
    if (event.kind !== ACTIVITY_EVENT_KIND || !verifyEvent(event)) {
      throw new Error("Activity event must use the configured kind and have a valid signature");
    }
    return { accepted: true, message: await this.#adapter.publish(event) };
  }

  async query(
    input: ActivityQuery,
    isValid: (event: Event) => boolean = () => true,
  ): Promise<ActivityQueryResult> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const filter = activityFilter(input);
    filter.limit = this.#scanLimit;
    if (cursor) filter.until = cursor.createdAt;

    const events = await withTimeout(this.#adapter.query(filter), this.#queryTimeoutMs);
    if (events.length >= this.#scanLimit) {
      throw new ActivityRelayScanLimitError();
    }
    const validEvents = events.filter(isValid);
    const pageCandidates = validEvents.sort(compareEvents).filter((event) => {
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
      skippedInvalid: events.length - validEvents.length,
    };
  }

  subscribe(
    input: ActivityQuery,
    onEvent: (event: Event) => void,
    options: { since?: number } = {},
  ): { close: () => void } {
    const filter = activityFilter(input);
    if (options.since !== undefined) filter.since = options.since;
    return this.#adapter.subscribe(filter, onEvent);
  }

  close(): void {
    this.#adapter.close();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new ActivityRelayQueryTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
