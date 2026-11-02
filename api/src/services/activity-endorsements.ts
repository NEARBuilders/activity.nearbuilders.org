import { MemoryPublisher } from "@orpc/publisher/memory";
import { and, count, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { ActivityEventEndorsement } from "../contract";
import type { Database } from "../db";
import { activityEventEndorsements as endorsementsTable } from "../db/schema";
import type { CallerIdentity } from "./caller-identity";

export type ActivityEndorsementUpdate = {
  operation: "endorsed" | "unendorsed";
  eventId: string;
  /** Every id the endorser is known by, so listeners can tell their own changes apart. */
  endorserIds: string[];
  timestamp: string;
  totalCount: number;
};

type ActivityEndorsementEvents = {
  endorsement: ActivityEndorsementUpdate;
};

export class ActivityEndorsementsService {
  readonly publisher = new MemoryPublisher<ActivityEndorsementEvents>({
    resume: { enabled: true, seconds: 120 },
  });
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async endorse(eventId: string, caller: CallerIdentity): Promise<ActivityEventEndorsement> {
    await this.#claimLegacyRows(caller);
    const [existing] = await this.#db
      .select({ id: endorsementsTable.id })
      .from(endorsementsTable)
      .where(and(eq(endorsementsTable.eventId, eventId), this.#ownedBy(caller)))
      .limit(1);
    const created = existing
      ? undefined
      : (
          await this.#db
            .insert(endorsementsTable)
            .values({ eventId, ownerAccountId: caller.ownerId, userId: caller.userId })
            .onConflictDoNothing()
            .returning({ id: endorsementsTable.id })
        )[0];
    const result = await this.#state(eventId, caller);
    if (created) await this.#publish("endorsed", result, caller);
    return result;
  }

  async unendorse(eventId: string, caller: CallerIdentity): Promise<ActivityEventEndorsement> {
    await this.#claimLegacyRows(caller);
    const deleted = await this.#db
      .delete(endorsementsTable)
      .where(and(eq(endorsementsTable.eventId, eventId), this.#ownedBy(caller)))
      .returning({ id: endorsementsTable.id });
    const result = await this.#state(eventId, caller);
    if (deleted.length > 0) await this.#publish("unendorsed", result, caller);
    return result;
  }

  async getStates(
    eventIds: readonly string[],
    caller?: CallerIdentity | null,
  ): Promise<Record<string, ActivityEventEndorsement>> {
    const uniqueEventIds = [...new Set(eventIds)];
    if (uniqueEventIds.length === 0) return {};
    const counts = await this.#db
      .select({ eventId: endorsementsTable.eventId, count: count() })
      .from(endorsementsTable)
      .where(inArray(endorsementsTable.eventId, uniqueEventIds))
      .groupBy(endorsementsTable.eventId);
    const endorsed = caller
      ? await this.#db
          .select({ eventId: endorsementsTable.eventId })
          .from(endorsementsTable)
          .where(and(inArray(endorsementsTable.eventId, uniqueEventIds), this.#ownedBy(caller)))
      : [];
    const countByEvent = new Map(counts.map((row) => [row.eventId, Number(row.count)]));
    const endorsedEventIds = new Set(endorsed.map(({ eventId }) => eventId));
    return Object.fromEntries(
      uniqueEventIds.map((eventId) => [
        eventId,
        {
          eventId,
          totalCount: countByEvent.get(eventId) ?? 0,
          endorsedByCurrentUser: endorsedEventIds.has(eventId),
        },
      ]),
    );
  }

  /** Rows written under any of the caller's ids, or legacy rows keyed only on their user id. */
  #ownedBy(caller: CallerIdentity): SQL {
    const byOwner = inArray(endorsementsTable.ownerAccountId, caller.ids);
    if (!caller.userId) return byOwner;
    return or(
      byOwner,
      and(isNull(endorsementsTable.ownerAccountId), eq(endorsementsTable.userId, caller.userId)),
    ) as SQL;
  }

  /**
   * Moves the caller's rows that aren't keyed on their canonical owner id yet onto it: rows
   * written before the column existed, and rows keyed on their user id from before they
   * linked NEAR. Any that duplicate an endorsement already held under the canonical id are
   * dropped. The one-off backfill (`scripts/backfill-endorsement-owners.ts`) covers
   * endorsers who don't come back.
   */
  async #claimLegacyRows(caller: CallerIdentity): Promise<void> {
    const { userId, ownerId } = caller;
    if (!userId) return;
    const owner = endorsementsTable.ownerAccountId;
    const hasNear = ownerId !== userId;
    // Rows from before the column, plus (once NEAR is linked) rows keyed on the user id.
    const legacy = and(
      eq(endorsementsTable.userId, userId),
      hasNear ? or(isNull(owner), eq(owner, userId)) : isNull(owner),
    );
    // Endorsements the caller already holds under a NEAR account (or, without NEAR, their id).
    const heldIds = hasNear ? caller.ids.filter((id) => id !== userId) : [userId];
    const alreadyEndorsed = this.#db
      .select({ eventId: endorsementsTable.eventId })
      .from(endorsementsTable)
      .where(inArray(owner, heldIds));
    await this.#db
      .delete(endorsementsTable)
      .where(and(legacy, inArray(endorsementsTable.eventId, alreadyEndorsed)));
    await this.#db.update(endorsementsTable).set({ ownerAccountId: ownerId }).where(legacy);
  }

  async #state(eventId: string, caller: CallerIdentity): Promise<ActivityEventEndorsement> {
    const states = await this.getStates([eventId], caller);
    const state = states[eventId];
    if (!state) throw new Error("Activity endorsement state was not returned");
    return state;
  }

  async #publish(
    operation: ActivityEndorsementUpdate["operation"],
    state: ActivityEventEndorsement,
    caller: CallerIdentity,
  ): Promise<void> {
    await this.publisher.publish("endorsement", {
      operation,
      eventId: state.eventId,
      endorserIds: caller.ids,
      timestamp: new Date().toISOString(),
      totalCount: state.totalCount,
    });
  }
}
