import type { Filter } from "nostr-tools";
import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import { type Event, verifyEvent } from "nostr-tools/pure";
import WebSocket from "ws";

useWebSocketImplementation(WebSocket);

export const ACTIVITY_EVENT_KIND = 1701;
const RELAY_QUERY_TIMEOUT_MS = 5_000;
const NOSTR_CLIENT_EOSE_TIMEOUT_MS = RELAY_QUERY_TIMEOUT_MS + 1_000;

export type ActivityQuery = {
  eventId?: string;
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
  /**
   * Most events one query can return, when the transport caps below the requested limit.
   * `ActivityRelay` scans at most this many so it can tell a full scan from a complete one.
   */
  readonly maxQueryLimit?: number;
  publish(event: Event): Promise<string>;
  query(filter: Filter): Promise<Event[]>;
  subscribe(
    filter: Filter,
    onEvent: (event: Event) => void,
    onError?: (error: Error) => void,
  ): { close: () => void } | Promise<{ close: () => void }>;
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

// Sorts after every real event ID, so a cursor at this ID resumes with the whole second.
const SECOND_START_ID = "f".repeat(64);

function encodeCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/**
 * A relay returns the newest `limit` matches, so a full scan may hold only part of its oldest
 * second. Drop that second: the next page starts from it and reads it whole. Throws only when a
 * single second fills the scan, which no page size can split.
 */
function completeSeconds(
  events: Event[],
  scanLimit: number,
): { events: Event[]; resumeAt: ActivityCursor | null } {
  if (events.length < scanLimit) return { events, resumeAt: null };
  const oldestSecond = Math.min(...events.map((event) => event.created_at));
  const complete = events.filter((event) => event.created_at > oldestSecond);
  if (complete.length === 0) throw new ActivityRelayScanLimitError();
  return { events: complete, resumeAt: { createdAt: oldestSecond, id: SECOND_START_ID } };
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
  if (input.eventId) filter.ids = [input.eventId];
  if (input.source) filter["#s"] = [input.source];
  if (input.eventType) filter["#t"] = [input.eventType];
  if (input.actor) filter["#n"] = [input.actor];
  if (input.idempotencyKey) filter["#i"] = [input.idempotencyKey];
  return filter;
}

// The pinned relay (mattn/nostr-relay) answers at most 500 events per query.
const DIRECT_QUERY_LIMIT = 500;

export class NostrRelayAdapter implements ActivityRelayAdapter {
  readonly maxQueryLimit: number;
  readonly #relayUrl: string;
  readonly #pool = new SimplePool({ enablePing: true, enableReconnect: false });
  readonly #subscriptionClosers = new Set<() => void>();
  #destroyed = false;

  constructor(relayUrl: string, options: { maxQueryLimit?: number } = {}) {
    this.#relayUrl = relayUrl;
    this.maxQueryLimit = options.maxQueryLimit ?? DIRECT_QUERY_LIMIT;
  }

  async publish(event: Event): Promise<string> {
    const relay = await this.#pool.ensureRelay(this.#relayUrl, { connectionTimeout: 5_000 });
    return relay.publish(event);
  }

  async query(filter: Filter): Promise<Event[]> {
    const relay = await this.#pool
      .ensureRelay(this.#relayUrl, { connectionTimeout: 5_000 })
      .catch((cause) => {
        console.error(`Activity relay unavailable at ${this.#relayUrl}:`, cause);
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
      }, RELAY_QUERY_TIMEOUT_MS);
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
          onclose: (reason) => {
            // Settling closes the subscription itself; only an unexpected close is a failure.
            if (settled) return;
            console.error(`Activity relay subscription closed at ${this.#relayUrl}: ${reason}`);
            settle(() => reject(new ActivityRelayUnavailableError()));
          },
          eoseTimeout: NOSTR_CLIENT_EOSE_TIMEOUT_MS,
        });
      } catch (cause) {
        console.error(`Activity relay subscribe threw at ${this.#relayUrl}:`, cause);
        settle(() => reject(new ActivityRelayUnavailableError()));
      }
    });
  }

  async subscribe(filter: Filter, onEvent: (event: Event) => void): Promise<{ close: () => void }> {
    let closed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { close: (reason?: string) => void } | undefined;
    let lastEventTimestamp = filter.since;
    const deliveredEventIds = new Set<string>();
    const reconnectBackoffMs = [250, 500, 1_000, 2_000, 5_000] as const;

    const scheduleReconnect = () => {
      if (closed || this.#destroyed || reconnectTimer) return;
      const delay = reconnectBackoffMs[Math.min(reconnectAttempt, reconnectBackoffMs.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect(true);
      }, delay);
    };
    const connect = async (reconnecting = false) => {
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
              if (deliveredEventIds.has(event.id)) return;
              deliveredEventIds.add(event.id);
              onEvent(event);
            },
            onclose: scheduleReconnect,
          },
        );
      } catch {
        if (!reconnecting) throw new ActivityRelayUnavailableError();
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
    try {
      await connect();
    } catch (error) {
      close();
      throw error;
    }
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
    selectVisible: (events: Event[]) => Promise<Event[]> = async (events) => events,
  ): Promise<ActivityQueryResult> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const scanLimit = Math.min(this.#scanLimit, this.#adapter.maxQueryLimit ?? this.#scanLimit);
    const filter = activityFilter(input);
    filter.limit = scanLimit;
    if (cursor) filter.until = cursor.createdAt;

    const { events, resumeAt } = completeSeconds(
      await withTimeout(this.#adapter.query(filter), this.#queryTimeoutMs),
      scanLimit,
    );
    const validEvents = events.filter(isValid);
    const includedEvents = await selectVisible(validEvents);
    const pageCandidates = includedEvents.sort(compareEvents).filter((event) => {
      if (!cursor) return true;
      return (
        event.created_at < cursor.createdAt ||
        (event.created_at === cursor.createdAt && event.id.localeCompare(cursor.id) < 0)
      );
    });
    const page = pageCandidates.slice(0, limit);
    const lastEvent = page.at(-1);
    let nextCursor: string | null = null;
    if (pageCandidates.length > limit && lastEvent) {
      nextCursor = encodeCursor({ createdAt: lastEvent.created_at, id: lastEvent.id });
    } else if (resumeAt) {
      // Everything newer than the dropped second is consumed; older history remains.
      nextCursor = encodeCursor(resumeAt);
    }
    return {
      events: page,
      nextCursor,
      skippedInvalid: events.length - validEvents.length,
    };
  }

  async subscribe(
    input: ActivityQuery,
    onEvent: (event: Event) => void,
    options: { since?: number; onError?: (error: Error) => void } = {},
  ): Promise<{ close: () => void }> {
    const filter = activityFilter(input);
    if (options.since !== undefined) filter.since = options.since;
    return this.#adapter.subscribe(filter, onEvent, options.onError);
  }

  /** Round-trips a minimal query through the configured transport to prove the relay answers. */
  async ping(): Promise<void> {
    await withTimeout(
      this.#adapter.query({ kinds: [ACTIVITY_EVENT_KIND], limit: 1 }),
      this.#queryTimeoutMs,
    );
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
