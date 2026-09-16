import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { type Event, getEventHash, validateEvent, verifyEvent } from "nostr-tools/pure";
import {
  ACTIVITY_EVENT_KIND,
  type ActivityQuery,
  type ActivityRelay,
} from "../activity/activity-relay";
import {
  ACTIVITY_EVENT_TYPE_NAME_REGEX,
  ACTIVITY_SOURCE_ID_REGEX,
  type ActivityFeedEvent,
  NEAR_ACCOUNT_ID_REGEX,
} from "../contract";
import type { Database } from "../db";
import {
  activityGithubIntegrations as githubIntegrationsTable,
  activitySigningIdentities as identitiesTable,
  activitySources as sourcesTable,
  activityEventSubmissions as submissionsTable,
} from "../db/schema";
import { ACTIVITY_EVENT_PAYLOAD_MAX_BYTES, parseStoredActivityEvent } from "./activity-ingestion";

export type BoundActivityIdentity = {
  sourceId: string;
  sourceDisplayName?: string;
  integration?: "github" | null;
  trustStatus?: "standard" | "trusted";
  scoreMultiplier?: number;
  publicKey: string;
  activeFrom?: string;
  retiredAt?: string | null;
};

export interface ActivityIdentityStore {
  listBound(source?: string): Promise<BoundActivityIdentity[]>;
}

/**
 * Events dated before their Signing Identity was bound are only trusted when this service
 * published them itself, which is how imported history is told apart from a relay record
 * claiming to predate the identity.
 */
export interface ActivityPublishedEventStore {
  findPublishedEventIds(eventIds: readonly string[]): Promise<Set<string>>;
}

const NO_PUBLISHED_EVENTS: ActivityPublishedEventStore = {
  findPublishedEventIds: async () => new Set(),
};

export interface ActivitySuppressionStore {
  findHiddenEventIds(eventIds: readonly string[]): Promise<Set<string>>;
  isHidden(eventId: string): Promise<boolean>;
}

const NO_HIDDEN_EVENTS: ActivitySuppressionStore = {
  findHiddenEventIds: async () => new Set(),
  isHidden: async () => false,
};

export class DatabaseActivityPublishedEventStore implements ActivityPublishedEventStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async findPublishedEventIds(eventIds: readonly string[]): Promise<Set<string>> {
    if (eventIds.length === 0) return new Set();
    const rows = await this.#db
      .select({ eventId: submissionsTable.eventId })
      .from(submissionsTable)
      .where(
        and(
          inArray(submissionsTable.eventId, [...eventIds]),
          isNotNull(submissionsTable.publishedAt),
        ),
      );
    return new Set(rows.flatMap(({ eventId }) => (eventId ? [eventId] : [])));
  }
}

export class DatabaseActivityIdentityStore implements ActivityIdentityStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async listBound(source?: string): Promise<BoundActivityIdentity[]> {
    return this.#db
      .select({
        sourceId: sourcesTable.sourceId,
        sourceDisplayName: sourcesTable.displayName,
        githubIntegrationId: githubIntegrationsTable.id,
        trustStatus: sourcesTable.trustStatus,
        scoreMultiplierBps: sourcesTable.scoreMultiplierBps,
        publicKey: identitiesTable.publicKey,
        activeFrom: identitiesTable.boundAt,
        retiredAt: identitiesTable.retiredAt,
      })
      .from(identitiesTable)
      .innerJoin(sourcesTable, eq(identitiesTable.sourceRecordId, sourcesTable.id))
      .leftJoin(
        githubIntegrationsTable,
        eq(githubIntegrationsTable.sourceRecordId, sourcesTable.id),
      )
      .where(
        source
          ? and(
              eq(identitiesTable.bindingStatus, "bound"),
              isNotNull(identitiesTable.boundAt),
              eq(sourcesTable.sourceId, source),
            )
          : and(eq(identitiesTable.bindingStatus, "bound"), isNotNull(identitiesTable.boundAt)),
      )
      .then((identities) =>
        identities.flatMap(
          ({ scoreMultiplierBps, activeFrom, retiredAt, githubIntegrationId, ...identity }) =>
            activeFrom
              ? [
                  {
                    ...identity,
                    integration: githubIntegrationId ? ("github" as const) : null,
                    scoreMultiplier: scoreMultiplierBps / 10_000,
                    activeFrom: toIso(activeFrom),
                    retiredAt: retiredAt ? toIso(retiredAt) : null,
                  },
                ]
              : [],
        ),
      );
  }
}

export type ActivityFeedResult = {
  data: ActivityFeedEvent[];
  meta: {
    hasMore: boolean;
    nextCursor: string | null;
    skippedInvalid: number;
  };
};

export class ActivityResumeError extends Error {
  constructor(message = "Last-Event-ID is invalid or is not available in relay history") {
    super(message);
    this.name = "ActivityResumeError";
  }
}

export class ActivityFeedService {
  readonly #relay: ActivityRelay;
  readonly #identities: ActivityIdentityStore;
  readonly #suppression: ActivitySuppressionStore;
  readonly #published: ActivityPublishedEventStore;

  constructor(
    relay: ActivityRelay,
    identities: ActivityIdentityStore,
    suppression: ActivitySuppressionStore = NO_HIDDEN_EVENTS,
    published: ActivityPublishedEventStore = NO_PUBLISHED_EVENTS,
  ) {
    this.#relay = relay;
    this.#identities = identities;
    this.#suppression = suppression;
    this.#published = published;
  }

  async list(input: ActivityQuery): Promise<ActivityFeedResult> {
    const result = await this.#listRelayEvents(input, true);
    const hidden = await this.#suppression.findHiddenEventIds(result.data.map(({ id }) => id));
    return { ...result, data: result.data.filter(({ id }) => !hidden.has(id)) };
  }

  async findVerifiedEventById(eventId: string): Promise<ActivityFeedEvent | null> {
    const result = await this.#listRelayEvents({ eventId, limit: 1 });
    return result.data[0] ?? null;
  }

  async verifyStoredEvents(
    records: readonly { eventId: string; eventJson: string }[],
  ): Promise<ActivityFeedEvent[]> {
    const registeredIdentities = await this.#registeredIdentities();
    return records.flatMap(({ eventId, eventJson }) => {
      try {
        const event = parseStoredActivityEvent(eventJson, eventId);
        // These records come from the submission ledger, so this service published them.
        const parsed = parseActivityFeedEvent(
          event,
          registeredIdentities,
          {},
          {
            allowBeforeIdentityBinding: true,
          },
        );
        return parsed ? [parsed] : [];
      } catch {
        return [];
      }
    });
  }

  async #listRelayEvents(input: ActivityQuery, excludeHidden = false): Promise<ActivityFeedResult> {
    const registeredIdentities = await this.#registeredIdentities(input.source);
    const parsedEvents = new Map<string, ActivityFeedEvent>();
    // Events dated before their identity's binding are accepted here and confirmed against the
    // submission ledger below, which needs one query rather than one per event.
    const backdated = new Set<string>();
    const result = await this.#relay.query(
      input,
      (event) => {
        const parsed = parseActivityFeedEvent(event, registeredIdentities, input, {
          allowBeforeIdentityBinding: true,
        });
        if (!parsed) return false;
        const identity = registeredIdentities.get(parsed.source)?.get(event.pubkey);
        if (isBeforeIdentityBinding(identity, event.created_at)) backdated.add(event.id);
        parsedEvents.set(event.id, parsed);
        return true;
      },
      async (events) => {
        const candidates = events.filter(({ id }) => backdated.has(id)).map(({ id }) => id);
        const published =
          candidates.length > 0
            ? await this.#published.findPublishedEventIds(candidates)
            : new Set<string>();
        const visible = events.filter(({ id }) => !backdated.has(id) || published.has(id));
        for (const { id } of events) {
          if (backdated.has(id) && !published.has(id)) parsedEvents.delete(id);
        }
        if (!excludeHidden) return visible;
        const hidden = await this.#suppression.findHiddenEventIds(visible.map(({ id }) => id));
        return visible.filter(({ id }) => !hidden.has(id));
      },
    );

    return {
      data: result.events.flatMap((event) => {
        const parsed = parsedEvents.get(event.id);
        return parsed ? [parsed] : [];
      }),
      meta: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor,
        skippedInvalid: result.skippedInvalid,
      },
    };
  }

  async *stream(
    input: ActivityQuery,
    options: { lastEventId?: string; signal?: AbortSignal; onReady?: () => void } = {},
  ): AsyncGenerator<ActivityFeedEvent> {
    if (options.lastEventId !== undefined && !/^[a-f0-9]{64}$/.test(options.lastEventId)) {
      throw new ActivityResumeError();
    }
    const queued: Event[] = [];
    let streamFailure: Error | undefined;
    const deliveredIds = new Set(options.lastEventId ? [options.lastEventId] : []);
    let wake: (() => void) | undefined;
    const wakeStream = () => {
      wake?.();
      wake = undefined;
    };
    const subscription = await this.#relay.subscribe(
      input,
      (event) => {
        if (!validateEvent(event) || deliveredIds.has(event.id)) return;
        queued.push(event);
        wakeStream();
      },
      {
        since: Math.floor(Date.now() / 1_000),
        onError: (error) => {
          streamFailure = error;
          wakeStream();
        },
      },
    );
    options.signal?.addEventListener("abort", wakeStream, { once: true });
    options.onReady?.();

    try {
      const replay = options.lastEventId
        ? await this.#eventsAfter(input, options.lastEventId)
        : { events: [], baseline: undefined };
      for (const event of replay.events) {
        if (deliveredIds.has(event.id)) continue;
        if (await this.#suppression.isHidden(event.id)) continue;
        deliveredIds.add(event.id);
        yield event;
      }

      while (!options.signal?.aborted) {
        if (streamFailure) throw streamFailure;
        const queuedEvent = queued.shift();
        if (queuedEvent) {
          if (deliveredIds.has(queuedEvent.id)) continue;
          const source = singleTagValue(queuedEvent, "s");
          if (!source) continue;
          const identities = await this.#registeredIdentities(input.source ?? source);
          const event = parseActivityFeedEvent(queuedEvent, identities, input);
          if (!event) continue;
          if (replay.baseline !== undefined && !isAfter(event, replay.baseline)) {
            continue;
          }
          if (await this.#suppression.isHidden(event.id)) continue;
          if (options.signal?.aborted) break;
          deliveredIds.add(event.id);
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          if (options.signal?.aborted || queued.length > 0) wakeStream();
        });
      }
    } finally {
      options.signal?.removeEventListener("abort", wakeStream);
      subscription.close();
    }
  }

  async #eventsAfter(
    input: ActivityQuery,
    lastEventId: string,
  ): Promise<{ events: ActivityFeedEvent[]; baseline: ActivityFeedEvent }> {
    const newerEvents: ActivityFeedEvent[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.#listRelayEvents({ ...input, limit: 100, cursor });
      const hidden = await this.#suppression.findHiddenEventIds(page.data.map(({ id }) => id));
      for (const event of page.data) {
        if (event.id === lastEventId) {
          return { events: newerEvents.reverse(), baseline: event };
        }
        if (!hidden.has(event.id)) newerEvents.push(event);
      }
      cursor = page.meta.nextCursor ?? undefined;
    } while (cursor);
    throw new ActivityResumeError();
  }

  async #registeredIdentities(
    source?: string,
  ): Promise<Map<string, Map<string, BoundActivityIdentity>>> {
    const identities = await this.#identities.listBound(source);
    const registeredIdentities = new Map<string, Map<string, BoundActivityIdentity>>();
    for (const identity of identities) {
      const sourceKeys = registeredIdentities.get(identity.sourceId) ?? new Map();
      sourceKeys.set(identity.publicKey, identity);
      registeredIdentities.set(identity.sourceId, sourceKeys);
    }
    return registeredIdentities;
  }
}

function isAfter(event: ActivityFeedEvent, baseline: ActivityFeedEvent): boolean {
  return (
    event.timestamp > baseline.timestamp ||
    (event.timestamp === baseline.timestamp && event.id.localeCompare(baseline.id) > 0)
  );
}

function parseActivityFeedEvent(
  event: Event,
  registeredIdentities: ReadonlyMap<string, ReadonlyMap<string, BoundActivityIdentity>>,
  query: ActivityQuery,
  options: { allowBeforeIdentityBinding?: boolean } = {},
): ActivityFeedEvent | null {
  if (
    !validateEvent(event) ||
    !/^[a-f0-9]{64}$/.test(event.id) ||
    !/^[a-f0-9]{64}$/.test(event.pubkey) ||
    !/^[a-f0-9]{128}$/.test(event.sig) ||
    getEventHash(event) !== event.id ||
    event.kind !== ACTIVITY_EVENT_KIND ||
    !verifyUncached(event) ||
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 0 ||
    Buffer.byteLength(event.content, "utf8") > ACTIVITY_EVENT_PAYLOAD_MAX_BYTES
  ) {
    return null;
  }
  const source = singleTagValue(event, "s");
  const type = singleTagValue(event, "t");
  const actor = singleTagValue(event, "n");
  const idempotencyKey = singleTagValue(event, "i");
  const identity = source ? registeredIdentities.get(source)?.get(event.pubkey) : undefined;
  if (
    !source ||
    source.length < 2 ||
    source.length > 100 ||
    !ACTIVITY_SOURCE_ID_REGEX.test(source) ||
    !type ||
    type.length > 100 ||
    !ACTIVITY_EVENT_TYPE_NAME_REGEX.test(type) ||
    !actor ||
    !NEAR_ACCOUNT_ID_REGEX.test(actor) ||
    !idempotencyKey ||
    idempotencyKey.length > 200 ||
    !identity ||
    !isIdentityActiveAt(identity, event.created_at, options.allowBeforeIdentityBinding) ||
    (query.eventId !== undefined && event.id !== query.eventId) ||
    (query.source !== undefined && source !== query.source) ||
    (query.eventType !== undefined && type !== query.eventType) ||
    (query.actor !== undefined && actor !== query.actor) ||
    (query.idempotencyKey !== undefined && idempotencyKey !== query.idempotencyKey)
  ) {
    return null;
  }
  let payload: ActivityFeedEvent["payload"];
  try {
    payload = JSON.parse(event.content) as ActivityFeedEvent["payload"];
  } catch {
    return null;
  }
  const timestamp = new Date(event.created_at * 1_000);
  if (Number.isNaN(timestamp.getTime())) return null;
  return {
    id: event.id,
    source,
    type,
    actor,
    idempotencyKey,
    timestamp: timestamp.toISOString(),
    payload,
    provenance: {
      signatureVerified: true,
      publicKey: identity.publicKey,
      signingIdentityStatus: identity.retiredAt ? "retired" : "active",
      sourceDisplayName: identity.sourceDisplayName ?? source,
      integration: identity.integration ?? null,
      trustStatus: identity.trustStatus ?? "standard",
      scoreMultiplier: identity.scoreMultiplier ?? 1,
      payloadClaimsVerified: false,
    },
  };
}

function isIdentityActiveAt(
  identity: BoundActivityIdentity,
  createdAt: number,
  allowBeforeBinding = false,
): boolean {
  const activeFrom = identity.activeFrom ? Date.parse(identity.activeFrom) / 1_000 : 0;
  const retiredAt = identity.retiredAt ? Date.parse(identity.retiredAt) / 1_000 : null;
  return (
    Number.isFinite(activeFrom) &&
    (allowBeforeBinding || createdAt >= Math.floor(activeFrom)) &&
    (retiredAt === null || (Number.isFinite(retiredAt) && createdAt < retiredAt))
  );
}

function isBeforeIdentityBinding(
  identity: BoundActivityIdentity | undefined,
  createdAt: number,
): boolean {
  if (!identity?.activeFrom) return false;
  const activeFrom = Date.parse(identity.activeFrom) / 1_000;
  return Number.isFinite(activeFrom) && createdAt < Math.floor(activeFrom);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function verifyUncached(event: Event): boolean {
  return verifyEvent({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  });
}

function singleTagValue(event: Event, name: string): string | null {
  const matches = event.tags.filter((tag) => tag[0] === name);
  if (matches.length !== 1 || matches[0]?.length !== 2) return null;
  return matches[0][1] ?? null;
}
