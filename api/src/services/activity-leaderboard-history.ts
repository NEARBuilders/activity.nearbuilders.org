import { isNotNull } from "drizzle-orm";
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

export class DatabaseActivityLeaderboardHistory {
  readonly #db: Database;
  readonly #eventVerifier: ActivityEventVerifier;

  constructor(db: Database, eventVerifier: ActivityEventVerifier) {
    this.#db = db;
    this.#eventVerifier = eventVerifier;
  }

  async *list(): AsyncGenerator<ActivityLeaderboardEvent> {
    const submissions = await this.#db
      .select({
        eventId: submissionsTable.eventId,
        eventJson: submissionsTable.eventJson,
        publishedAt: submissionsTable.publishedAt,
      })
      .from(submissionsTable)
      .where(isNotNull(submissionsTable.eventJson));
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
  }
}

function invalidStoredActivityEvent(): Error {
  return new Error("Stored Activity event is invalid");
}
