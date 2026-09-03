import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import { type Event, validateEvent, verifyEvent } from "nostr-tools/pure";
import { ACTIVITY_EVENT_KIND, type ActivityRelay } from "../activity/activity-relay";
import type { Database } from "../db";
import {
  activitySources as sourcesTable,
  activityEventSubmissions as submissionsTable,
} from "../db/schema";
import type { ActivityCredentialsService } from "./activity-credentials";
import type { ActivitySourcesService } from "./activity-sources";

export interface ActivityEventSubmission {
  eventType: string;
  actor: string;
  idempotencyKey: string;
  payload: unknown;
}

export const ACTIVITY_EVENT_PAYLOAD_MAX_BYTES = 16 * 1_024;

export class ActivityIngestionService {
  readonly #db: Database;
  readonly #credentials: ActivityCredentialsService;
  readonly #sources: ActivitySourcesService;
  readonly #relay: ActivityRelay;

  constructor(
    db: Database,
    credentials: ActivityCredentialsService,
    sources: ActivitySourcesService,
    relay: ActivityRelay,
  ) {
    this.#db = db;
    this.#credentials = credentials;
    this.#sources = sources;
    this.#relay = relay;
  }

  async submit(apiKey: string, input: ActivityEventSubmission): Promise<{ eventId: string }> {
    const payloadJson = JSON.stringify(input.payload);
    if (!payloadJson || Buffer.byteLength(payloadJson, "utf8") > ACTIVITY_EVENT_PAYLOAD_MAX_BYTES) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Activity event payload exceeds 16 KiB",
      });
    }
    const credential = await this.#credentials.authenticateEventWriteKey(apiKey);
    const source = await this.#sources.getApprovedSourceForIngestion(credential.sourceId);
    const eventType = source.eventTypes.find(({ name }) => name === input.eventType);
    if (!eventType?.enabled) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Event Type is not enabled for this Activity Source",
      });
    }

    const [sourceRow] = await this.#db
      .select({ id: sourcesTable.id })
      .from(sourcesTable)
      .where(eq(sourcesTable.sourceId, credential.sourceId))
      .limit(1);
    if (!sourceRow) {
      throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
    }
    const requestHash = hashSubmission(input);
    const [created] = await this.#db
      .insert(submissionsTable)
      .values({
        sourceRecordId: sourceRow.id,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      })
      .onConflictDoNothing()
      .returning();
    const submission =
      created ??
      (
        await this.#db
          .select()
          .from(submissionsTable)
          .where(
            and(
              eq(submissionsTable.sourceRecordId, sourceRow.id),
              eq(submissionsTable.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1)
      )[0];
    if (!submission) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Activity event reservation failed",
      });
    }
    if (submission.requestHash !== requestHash) {
      throw new ORPCError("CONFLICT", {
        message: "Idempotency key was already used for a different Activity event",
      });
    }
    if (submission.publishedAt && submission.eventId) {
      return { eventId: submission.eventId };
    }

    if (!submission.eventJson) {
      const event = await this.#credentials.signActivityEvent(credential, {
        kind: ACTIVITY_EVENT_KIND,
        created_at: Math.floor(submission.createdAt.getTime() / 1_000),
        tags: [
          ["s", credential.sourceId],
          ["t", input.eventType],
          ["n", input.actor],
          ["i", input.idempotencyKey],
        ],
        content: payloadJson,
      });
      await this.#db
        .update(submissionsTable)
        .set({ eventId: event.id, eventJson: JSON.stringify(event) })
        .where(and(eq(submissionsTable.id, submission.id), isNull(submissionsTable.eventJson)));
    }
    return this.#db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submission.id))
        .for("update")
        .limit(1);
      if (!locked) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Activity event reservation was lost",
        });
      }
      if (locked.publishedAt && locked.eventId) {
        return { eventId: locked.eventId };
      }
      if (!locked.eventJson) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Signed Activity event was not stored",
        });
      }
      const eventToPublish = parseStoredActivityEvent(locked.eventJson, locked.eventId);
      try {
        await this.#relay.publish(eventToPublish);
      } catch {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: "Activity relay did not acknowledge the event",
        });
      }
      await tx
        .update(submissionsTable)
        .set({ publishedAt: new Date() })
        .where(eq(submissionsTable.id, submission.id));
      return { eventId: eventToPublish.id };
    });
  }

  close(): void {
    this.#relay.close();
  }
}

function parseStoredActivityEvent(eventJson: string, eventId: string | null): Event {
  let event: unknown;
  try {
    event = JSON.parse(eventJson);
  } catch {
    throw invalidStoredActivityEvent();
  }
  if (
    !hasSignedEventFields(event) ||
    !validateEvent(event) ||
    event.id !== eventId ||
    !verifyEvent(event)
  ) {
    throw invalidStoredActivityEvent();
  }
  return event;
}

function hasSignedEventFields(value: unknown): value is { id: string; sig: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "sig" in value &&
    typeof value.sig === "string"
  );
}

function invalidStoredActivityEvent(): ORPCError<"INTERNAL_SERVER_ERROR", unknown> {
  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "Stored Activity event is invalid",
  });
}

function hashSubmission(input: ActivityEventSubmission): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        actor: input.actor,
        eventType: input.eventType,
        payload: input.payload,
      }),
    )
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
