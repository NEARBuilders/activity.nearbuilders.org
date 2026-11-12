import { and, asc, eq, gt, isNotNull, lte, or } from "drizzle-orm";
import type { ActivityFeedEvent } from "../contract";
import type { Database } from "../db";
import { activityEventSubmissions as submissionsTable } from "../db/schema";
import type { ActivityLeaderboardEvent } from "./activity-leaderboard";

type ActivityEventVerifier = {
  findVerifiedEventById(eventId: string): Promise<ActivityFeedEvent | null>;
  verifyStoredEvents(
    records: readonly { eventId: string; eventJson: string }[],
  ): Promise<ActivityFeedEvent[]>;
};

const HISTORY_BATCH_SIZE = 250;

export class DatabaseActivityLeaderboardHistory {
  readonly #db: Database;
  readonly #eventVerifier: ActivityEventVerifier;

  constructor(db: Database, eventVerifier: ActivityEventVerifier) {
    this.#db = db;
    this.#eventVerifier = eventVerifier;
  }

  async *list(): AsyncGenerator<ActivityLeaderboardEvent> {
    const historyUpperBound = new Date();
    let cursor: { createdAt: Date; id: string } | undefined;

    while (true) {
      const submissions = await this.#db
        .select({
          id: submissionsTable.id,
          eventId: submissionsTable.eventId,
          eventJson: submissionsTable.eventJson,
          publishedAt: submissionsTable.publishedAt,
          createdAt: submissionsTable.createdAt,
        })
        .from(submissionsTable)
        .where(
          and(
            isNotNull(submissionsTable.eventJson),
            lte(submissionsTable.createdAt, historyUpperBound),
            cursor
              ? or(
                  gt(submissionsTable.createdAt, cursor.createdAt),
                  and(
                    eq(submissionsTable.createdAt, cursor.createdAt),
                    gt(submissionsTable.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(submissionsTable.createdAt), asc(submissionsTable.id))
        .limit(HISTORY_BATCH_SIZE);
      if (submissions.length === 0) return;

      const publishedRecords = submissions.flatMap(({ eventId, eventJson, publishedAt }) =>
        publishedAt && eventId && eventJson ? [{ eventId, eventJson }] : [],
      );
      const verifiedPublished = new Map(
        (await this.#eventVerifier.verifyStoredEvents(publishedRecords)).map((event) => [
          event.id,
          event,
        ]),
      );

      for (const submission of submissions) {
        if (!submission.eventId || !submission.eventJson) throw invalidStoredActivityEvent();
        if (!submission.publishedAt) {
          const confirmed = await this.#eventVerifier.findVerifiedEventById(submission.eventId);
          if (confirmed) yield confirmed;
          continue;
        }
        const verified = verifiedPublished.get(submission.eventId);
        if (verified) yield verified;
      }

      const last = submissions.at(-1)!;
      cursor = { createdAt: last.createdAt, id: last.id };
    }
  }
}

function invalidStoredActivityEvent(): Error {
  return new Error("Stored Activity event is invalid");
}
