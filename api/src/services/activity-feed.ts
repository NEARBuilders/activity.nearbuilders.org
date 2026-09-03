import { and, eq } from "drizzle-orm";
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
  activitySigningIdentities as identitiesTable,
  activitySources as sourcesTable,
} from "../db/schema";
import { ACTIVITY_EVENT_PAYLOAD_MAX_BYTES } from "./activity-ingestion";

export type BoundActivityIdentity = {
  sourceId: string;
  publicKey: string;
};

export interface ActivityIdentityStore {
  listBound(source?: string): Promise<BoundActivityIdentity[]>;
}

export class DatabaseActivityIdentityStore implements ActivityIdentityStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async listBound(source?: string): Promise<BoundActivityIdentity[]> {
    return this.#db
      .select({ sourceId: sourcesTable.sourceId, publicKey: identitiesTable.publicKey })
      .from(identitiesTable)
      .innerJoin(sourcesTable, eq(identitiesTable.sourceRecordId, sourcesTable.id))
      .where(
        source
          ? and(eq(identitiesTable.bindingStatus, "bound"), eq(sourcesTable.sourceId, source))
          : eq(identitiesTable.bindingStatus, "bound"),
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

export class ActivityFeedService {
  readonly #relay: ActivityRelay;
  readonly #identities: ActivityIdentityStore;

  constructor(relay: ActivityRelay, identities: ActivityIdentityStore) {
    this.#relay = relay;
    this.#identities = identities;
  }

  async list(input: ActivityQuery): Promise<ActivityFeedResult> {
    const identities = await this.#identities.listBound(input.source);
    const trustedIdentities = new Map<string, Set<string>>();
    for (const { sourceId, publicKey } of identities) {
      const sourceKeys = trustedIdentities.get(sourceId) ?? new Set<string>();
      sourceKeys.add(publicKey);
      trustedIdentities.set(sourceId, sourceKeys);
    }
    const parsedEvents = new Map<string, ActivityFeedEvent>();
    const result = await this.#relay.query(input, (event) => {
      const parsed = parseActivityFeedEvent(event, trustedIdentities, input);
      if (!parsed) return false;
      parsedEvents.set(event.id, parsed);
      return true;
    });

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
}

function parseActivityFeedEvent(
  event: Event,
  trustedIdentities: ReadonlyMap<string, ReadonlySet<string>>,
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
    !trustedIdentities.get(source)?.has(event.pubkey) ||
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
  };
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
