import { isNotNull } from "drizzle-orm";
import type { Event } from "nostr-tools/pure";
import { ACTIVITY_EVENT_KIND } from "../activity/activity-relay";
import type { ActivityFeedEvent } from "../contract";
import type { Database } from "../db";
import { activityEventSubmissions as submissionsTable } from "../db/schema";
import { parseStoredActivityEvent } from "./activity-ingestion";
import type { ActivityLeaderboardEvent } from "./activity-leaderboard";

type ActivityRelayConfirmation = {
  findTrustedEventById(eventId: string): Promise<ActivityFeedEvent | null>;
};

export class DatabaseActivityLeaderboardHistory {
  readonly #db: Database;
  readonly #relayConfirmation: ActivityRelayConfirmation;

  constructor(db: Database, relayConfirmation: ActivityRelayConfirmation) {
    this.#db = db;
    this.#relayConfirmation = relayConfirmation;
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

    for (const submission of submissions) {
      if (!submission.eventId || !submission.eventJson) throw invalidStoredActivityEvent();
      if (!submission.publishedAt) {
        const confirmed = await this.#relayConfirmation.findTrustedEventById(submission.eventId);
        if (confirmed) yield confirmed;
        continue;
      }
      yield toLeaderboardEvent(parseStoredActivityEvent(submission.eventJson, submission.eventId));
    }
  }
}

function toLeaderboardEvent(event: Event): ActivityLeaderboardEvent {
  if (
    event.kind !== ACTIVITY_EVENT_KIND ||
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 0
  ) {
    throw invalidStoredActivityEvent();
  }
  const source = singleTagValue(event, "s");
  const type = singleTagValue(event, "t");
  const actor = singleTagValue(event, "n");
  const timestamp = new Date(event.created_at * 1_000);
  if (!source || !type || !actor || Number.isNaN(timestamp.getTime())) {
    throw invalidStoredActivityEvent();
  }
  return { id: event.id, source, type, actor, timestamp: timestamp.toISOString() };
}

function singleTagValue(event: Event, name: string): string | null {
  const matches = event.tags.filter((tag) => tag[0] === name);
  if (matches.length !== 1 || matches[0]?.length !== 2) return null;
  return matches[0][1] ?? null;
}

function invalidStoredActivityEvent(): Error {
  return new Error("Stored Activity event is invalid");
}
