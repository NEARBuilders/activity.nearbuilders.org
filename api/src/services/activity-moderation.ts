import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import {
  type ActivityFeedEvent,
  ActivityFeedEventSchema,
  type HiddenActivityEvent,
  type HideActivityEventResult,
} from "../contract";
import type { Database } from "../db";
import {
  activityHiddenEvents as hiddenEventsTable,
  activityEventModerationRequests as requestsTable,
} from "../db/schema";
import type { ActivitySuppressionStore } from "./activity-feed";
import type { ActivityLeaderboard } from "./activity-leaderboard";

type HiddenRow = typeof hiddenEventsTable.$inferSelect;
type RequestRow = typeof requestsTable.$inferSelect;

export interface ActivityEventModerationLookup {
  findTrustedEventByIdForModeration(eventId: string): Promise<ActivityFeedEvent | null>;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function requestHash(eventId: string, reason: string): string {
  return createHash("sha256").update(JSON.stringify({ eventId, reason })).digest("hex");
}

function toHiddenRecord(hidden: HiddenRow, history: RequestRow[]): HiddenActivityEvent {
  return {
    event: ActivityFeedEventSchema.parse(JSON.parse(hidden.eventJson)),
    hiddenBy: hidden.administratorId,
    reason: hidden.reason,
    hiddenAt: iso(hidden.hiddenAt),
    moderationHistory: history.map((request) => ({
      id: request.id,
      administratorId: request.administratorId,
      idempotencyKey: request.idempotencyKey,
      reason: request.reason,
      applied: request.applied,
      requestedAt: iso(request.requestedAt),
    })),
  };
}

export class DatabaseActivityModerationStore implements ActivitySuppressionStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async findHiddenEventIds(eventIds: readonly string[]): Promise<Set<string>> {
    if (eventIds.length === 0) return new Set();
    const rows = await this.#db
      .select({ eventId: hiddenEventsTable.eventId })
      .from(hiddenEventsTable)
      .where(inArray(hiddenEventsTable.eventId, [...eventIds]));
    return new Set(rows.map(({ eventId }) => eventId));
  }

  async isHidden(eventId: string): Promise<boolean> {
    return (await this.findHiddenEventIds([eventId])).has(eventId);
  }

  async getHidden(eventId: string): Promise<HiddenActivityEvent | null> {
    const [hidden] = await this.#db
      .select()
      .from(hiddenEventsTable)
      .where(eq(hiddenEventsTable.eventId, eventId))
      .limit(1);
    if (!hidden) return null;
    return toHiddenRecord(hidden, await this.#historyFor([eventId]));
  }

  async listHidden(): Promise<HiddenActivityEvent[]> {
    const hidden = await this.#db
      .select()
      .from(hiddenEventsTable)
      .orderBy(desc(hiddenEventsTable.hiddenAt), desc(hiddenEventsTable.eventId));
    const history = await this.#historyFor(hidden.map(({ eventId }) => eventId));
    const historyByEvent = new Map<string, RequestRow[]>();
    for (const request of history) {
      const requests = historyByEvent.get(request.eventId) ?? [];
      requests.push(request);
      historyByEvent.set(request.eventId, requests);
    }
    return hidden.map((row) => toHiddenRecord(row, historyByEvent.get(row.eventId) ?? []));
  }

  async findRequest(administratorId: string, idempotencyKey: string): Promise<RequestRow | null> {
    const [request] = await this.#db
      .select()
      .from(requestsTable)
      .where(
        and(
          eq(requestsTable.administratorId, administratorId),
          eq(requestsTable.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return request ?? null;
  }

  async recordHide(input: {
    event: ActivityFeedEvent;
    administratorId: string;
    idempotencyKey: string;
    reason: string;
    requestHash: string;
  }): Promise<{ request: RequestRow; requestReplayed: boolean }> {
    return this.#db.transaction(async (tx) => {
      const [createdHidden] = await tx
        .insert(hiddenEventsTable)
        .values({
          eventId: input.event.id,
          source: input.event.source,
          eventType: input.event.type,
          actor: input.event.actor,
          eventIdempotencyKey: input.event.idempotencyKey,
          eventCreatedAt: new Date(input.event.timestamp),
          eventJson: JSON.stringify(input.event),
          administratorId: input.administratorId,
          reason: input.reason,
        })
        .onConflictDoNothing({ target: hiddenEventsTable.eventId })
        .returning();
      const applied = createdHidden !== undefined;
      const [createdRequest] = await tx
        .insert(requestsTable)
        .values({
          eventId: input.event.id,
          administratorId: input.administratorId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          reason: input.reason,
          applied,
        })
        .onConflictDoNothing({
          target: [requestsTable.administratorId, requestsTable.idempotencyKey],
        })
        .returning();

      if (!createdRequest) {
        const [existing] = await tx
          .select()
          .from(requestsTable)
          .where(
            and(
              eq(requestsTable.administratorId, input.administratorId),
              eq(requestsTable.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (!existing || existing.requestHash !== input.requestHash) {
          throw new ORPCError("CONFLICT", {
            message: "Moderation idempotency key was already used for another request",
          });
        }
        return { request: existing, requestReplayed: true };
      }

      return { request: createdRequest, requestReplayed: false };
    });
  }

  async #historyFor(eventIds: string[]): Promise<RequestRow[]> {
    if (eventIds.length === 0) return [];
    return this.#db
      .select()
      .from(requestsTable)
      .where(inArray(requestsTable.eventId, eventIds))
      .orderBy(asc(requestsTable.requestedAt), asc(requestsTable.id));
  }
}

export class ActivityModerationService {
  readonly #store: DatabaseActivityModerationStore;
  readonly #events: ActivityEventModerationLookup;
  readonly #leaderboard: ActivityLeaderboard;

  constructor(
    store: DatabaseActivityModerationStore,
    events: ActivityEventModerationLookup,
    leaderboard: ActivityLeaderboard,
  ) {
    this.#store = store;
    this.#events = events;
    this.#leaderboard = leaderboard;
  }

  async hide(input: {
    eventId: string;
    administratorId: string;
    idempotencyKey: string;
    reason: string;
  }): Promise<HideActivityEventResult> {
    const hash = requestHash(input.eventId, input.reason);
    const existingRequest = await this.#store.findRequest(
      input.administratorId,
      input.idempotencyKey,
    );
    if (existingRequest) {
      if (existingRequest.requestHash !== hash) {
        throw new ORPCError("CONFLICT", {
          message: "Moderation idempotency key was already used for another request",
        });
      }
      return this.#resultWithProjection(existingRequest, true);
    }

    const alreadyHidden = await this.#store.getHidden(input.eventId);
    const event =
      alreadyHidden?.event ?? (await this.#events.findTrustedEventByIdForModeration(input.eventId));
    if (!event) {
      throw new ORPCError("NOT_FOUND", { message: "Activity event not found" });
    }

    const recorded = await this.#store.recordHide({ ...input, event, requestHash: hash });
    return this.#resultWithProjection(recorded.request, recorded.requestReplayed);
  }

  listHidden(): Promise<HiddenActivityEvent[]> {
    return this.#store.listHidden();
  }

  async #result(request: RequestRow, requestReplayed: boolean): Promise<HideActivityEventResult> {
    const hiddenEvent = await this.#store.getHidden(request.eventId);
    if (!hiddenEvent) throw new Error("Hidden Activity event was not persisted");
    return {
      hiddenEvent,
      projection: {
        updateId: `activity-hide:${hiddenEvent.event.id}`,
        operation: "exclude",
        eventId: hiddenEvent.event.id,
        source: hiddenEvent.event.source,
        type: hiddenEvent.event.type,
        actor: hiddenEvent.event.actor,
        idempotencyKey: hiddenEvent.event.idempotencyKey,
        eventTimestamp: hiddenEvent.event.timestamp,
        hiddenAt: hiddenEvent.hiddenAt,
        applied: request.applied && !requestReplayed,
      },
      requestReplayed,
    };
  }

  async #resultWithProjection(
    request: RequestRow,
    requestReplayed: boolean,
  ): Promise<HideActivityEventResult> {
    const result = await this.#result(request, requestReplayed);
    try {
      await this.#leaderboard.apply({ operation: "exclude", event: result.hiddenEvent.event });
    } catch {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "Activity leaderboard projection is unavailable",
      });
    }
    return result;
  }
}
