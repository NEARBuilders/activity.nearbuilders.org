import { and, count, eq, inArray } from "drizzle-orm";
import { MemoryPublisher } from "every-plugin/orpc";
import type { ActivityEventEndorsement } from "../contract";
import type { Database } from "../db";
import { activityEventEndorsements as endorsementsTable } from "../db/schema";

export type ActivityEndorsementUpdate = {
  operation: "endorsed" | "unendorsed";
  eventId: string;
  userId: string;
  timestamp: string;
  totalCount: number;
};

type ActivityEndorsementEvents = {
  endorsement: ActivityEndorsementUpdate;
};

export class ActivityEndorsementsService {
  readonly publisher = new MemoryPublisher<ActivityEndorsementEvents>({
    resumeRetentionSeconds: 120,
  });
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async endorse(eventId: string, userId: string): Promise<ActivityEventEndorsement> {
    const [created] = await this.#db
      .insert(endorsementsTable)
      .values({ eventId, userId })
      .onConflictDoNothing({ target: [endorsementsTable.eventId, endorsementsTable.userId] })
      .returning({ id: endorsementsTable.id });
    const result = await this.#state(eventId, userId);
    if (created) await this.#publish("endorsed", result, userId);
    return result;
  }

  async unendorse(eventId: string, userId: string): Promise<ActivityEventEndorsement> {
    const deleted = await this.#db
      .delete(endorsementsTable)
      .where(and(eq(endorsementsTable.eventId, eventId), eq(endorsementsTable.userId, userId)))
      .returning({ id: endorsementsTable.id });
    const result = await this.#state(eventId, userId);
    if (deleted.length > 0) await this.#publish("unendorsed", result, userId);
    return result;
  }

  async getStates(
    eventIds: readonly string[],
    userId?: string,
  ): Promise<Record<string, ActivityEventEndorsement>> {
    const uniqueEventIds = [...new Set(eventIds)];
    if (uniqueEventIds.length === 0) return {};
    const counts = await this.#db
      .select({ eventId: endorsementsTable.eventId, count: count() })
      .from(endorsementsTable)
      .where(inArray(endorsementsTable.eventId, uniqueEventIds))
      .groupBy(endorsementsTable.eventId);
    const endorsed = userId
      ? await this.#db
          .select({ eventId: endorsementsTable.eventId })
          .from(endorsementsTable)
          .where(
            and(
              inArray(endorsementsTable.eventId, uniqueEventIds),
              eq(endorsementsTable.userId, userId),
            ),
          )
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

  async #state(eventId: string, userId: string): Promise<ActivityEventEndorsement> {
    const states = await this.getStates([eventId], userId);
    const state = states[eventId];
    if (!state) throw new Error("Activity endorsement state was not returned");
    return state;
  }

  async #publish(
    operation: ActivityEndorsementUpdate["operation"],
    state: ActivityEventEndorsement,
    userId: string,
  ): Promise<void> {
    await this.publisher.publish("endorsement", {
      operation,
      eventId: state.eventId,
      userId,
      timestamp: new Date().toISOString(),
      totalCount: state.totalCount,
    });
  }
}
