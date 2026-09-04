import { and, eq, isNotNull } from "drizzle-orm";
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

export interface ActivitySuppressionStore {
  findHiddenEventIds(eventIds: readonly string[]): Promise<Set<string>>;
  isHidden(eventId: string): Promise<boolean>;
}

const NO_HIDDEN_EVENTS: ActivitySuppressionStore = {
  findHiddenEventIds: async () => new Set(),
  isHidden: async () => false,
};

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

  constructor(
    relay: ActivityRelay,
    identities: ActivityIdentityStore,
    suppression: ActivitySuppressionStore = NO_HIDDEN_EVENTS,
  ) {
    this.#relay = relay;
    this.#identities = identities;
    this.#suppression = suppression;
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
        const parsed = parseActivityFeedEvent(event, registeredIdentities, {});
        return parsed ? [parsed] : [];
      } catch {
        return [];
      }
    });
  }

  async #listRelayEvents(input: ActivityQuery, excludeHidden = false): Promise<ActivityFeedResult> {
    const registeredIdentities = await this.#registeredIdentities(input.source);
    const parsedEvents = new Map<string, ActivityFeedEvent>();
    const result = await this.#relay.query(
      input,
      (event) => {
        const parsed = parseActivityFeedEvent(event, registeredIdentities, input);
        if (!parsed) return false;
        parsedEvents.set(event.id, parsed);
        return true;
      },
      excludeHidden
        ? async (events) => {
            const hidden = await this.#suppression.findHiddenEventIds(events.map(({ id }) => id));
            return events.filter(({ id }) => !hidden.has(id));
          }
        : undefined,
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
    options: { lastEventId?: string; signal?: AbortSignal } = {},
  ): AsyncGenerator<ActivityFeedEvent> {
    if (options.lastEventId !== undefined && !/^[a-f0-9]{64}$/.test(options.lastEventId)) {
      throw new ActivityResumeError();
    }
    const registeredIdentities = await this.#registeredIdentities(input.source);
    const queued: ActivityFeedEvent[] = [];
    const deliveredIds = new Set(options.lastEventId ? [options.lastEventId] : []);
    let wake: (() => void) | undefined;
    const wakeStream = () => {
      wake?.();
      wake = undefined;
    };
    const subscription = this.#relay.subscribe(
      input,
      (event) => {
        const parsed = parseActivityFeedEvent(event, registeredIdentities, input);
        if (!parsed) return;
        if (deliveredIds.has(parsed.id)) return;
        queued.push(parsed);
        wakeStream();
      },
      { since: Math.floor(Date.now() / 1_000) },
    );
    options.signal?.addEventListener("abort", wakeStream, { once: true });

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
        const event = queued.shift();
        if (event) {
          if (
            deliveredIds.has(event.id) ||
            (replay.baseline !== undefined && !isAfter(event, replay.baseline))
          ) {
            continue;
          }
          if (await this.#suppression.isHidden(event.id)) continue;
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
    !isIdentityActiveAt(identity, event.created_at) ||
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

function isIdentityActiveAt(identity: BoundActivityIdentity, createdAt: number): boolean {
  const activeFrom = identity.activeFrom ? Date.parse(identity.activeFrom) / 1_000 : 0;
  const retiredAt = identity.retiredAt ? Date.parse(identity.retiredAt) / 1_000 : null;
  return (
    Number.isFinite(activeFrom) &&
    createdAt >= Math.floor(activeFrom) &&
    (retiredAt === null || (Number.isFinite(retiredAt) && createdAt < retiredAt))
  );
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
