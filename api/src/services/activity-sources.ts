import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { DatabaseTag } from "../db/layer";
import {
  type activitySourceApprovalStatus,
  activityEventTypes as eventTypesTable,
  activitySourceReviews as reviewsTable,
  activitySources as sourcesTable,
} from "../db/schema";

export type ActivitySourceApprovalStatus =
  (typeof activitySourceApprovalStatus)["enumValues"][number];

export interface ActivityEventTypeInput {
  name: string;
  description: string;
  enabled: boolean;
  pointValue: number;
}

export interface ActivitySourceInput {
  sourceId: string;
  displayName: string;
  nearAccountId: string;
  organizationId: string;
  eventTypes: ActivityEventTypeInput[];
}

export interface ActivitySourceRecord {
  sourceId: string;
  displayName: string;
  nearAccountId: string;
  organizationId: string;
  approvalStatus: ActivitySourceApprovalStatus;
  canIngest: boolean;
  eventTypes: ActivityEventTypeInput[];
  reviewHistory: ActivitySourceReviewRecord[];
  reviewedBy: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivitySourceReviewRecord {
  decision: Exclude<ActivitySourceApprovalStatus, "pending">;
  reason: string;
  administratorId: string;
  reviewedAt: string;
}

export interface ActivitySourcesService {
  createSource(input: ActivitySourceInput): Promise<ActivitySourceRecord>;
  getApprovedSourceForIngestion(sourceId: string): Promise<ActivitySourceRecord>;
  listSourcesByOrganization(organizationId: string): Promise<ActivitySourceRecord[]>;
  updateSource(
    organizationId: string,
    sourceId: string,
    input: Partial<Pick<ActivitySourceInput, "displayName" | "nearAccountId" | "eventTypes">>,
  ): Promise<ActivitySourceRecord>;
  listSourcesForReview(
    approvalStatus?: ActivitySourceApprovalStatus,
  ): Promise<ActivitySourceRecord[]>;
  reviewSource(input: {
    sourceId: string;
    decision: Exclude<ActivitySourceApprovalStatus, "pending">;
    reason: string;
    administratorId: string;
  }): Promise<ActivitySourceRecord>;
}

export class ActivitySourcesTag extends Context.Tag("api/ActivitySources")<
  ActivitySourcesService,
  ActivitySourcesService
>() {}

type SourceRow = typeof sourcesTable.$inferSelect;
type EventTypeRow = typeof eventTypesTable.$inferSelect;
type ReviewRow = typeof reviewsTable.$inferSelect;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(
  source: SourceRow,
  eventTypes: EventTypeRow[],
  reviews: ReviewRow[],
): ActivitySourceRecord {
  return {
    sourceId: source.sourceId,
    displayName: source.displayName,
    nearAccountId: source.nearAccountId,
    organizationId: source.organizationId,
    approvalStatus: source.approvalStatus,
    canIngest: source.approvalStatus === "approved",
    eventTypes: eventTypes.map(({ name, description, enabled, pointValue }) => ({
      name,
      description,
      enabled,
      pointValue,
    })),
    reviewHistory: reviews.map(({ decision, reason, administratorId, reviewedAt }) => ({
      decision,
      reason,
      administratorId,
      reviewedAt: iso(reviewedAt),
    })),
    reviewedBy: source.reviewedBy,
    reviewReason: source.reviewReason,
    reviewedAt: source.reviewedAt ? iso(source.reviewedAt) : null,
    createdAt: iso(source.createdAt),
    updatedAt: iso(source.updatedAt),
  };
}

function toOrpcError(error: unknown): ORPCError<string, unknown> {
  return error instanceof ORPCError
    ? error
    : new ORPCError("INTERNAL_SERVER_ERROR", {
        message: error instanceof Error ? error.message : String(error),
      });
}

export const ActivitySourcesLive = Layer.effect(
  ActivitySourcesTag,
  Effect.gen(function* () {
    const db = yield* DatabaseTag;

    const eventTypesFor = async (sourceRecordIds: string[]) => {
      if (sourceRecordIds.length === 0) return [];
      return await db
        .select()
        .from(eventTypesTable)
        .where(inArray(eventTypesTable.sourceRecordId, sourceRecordIds))
        .orderBy(asc(eventTypesTable.name));
    };

    const reviewsFor = async (sourceRecordIds: string[]) => {
      if (sourceRecordIds.length === 0) return [];
      return await db
        .select()
        .from(reviewsTable)
        .where(inArray(reviewsTable.sourceRecordId, sourceRecordIds))
        .orderBy(asc(reviewsTable.reviewedAt));
    };

    const service: ActivitySourcesService = {
      createSource: async (input) => {
        try {
          const source = await db.transaction(async (tx) => {
            const [created] = await tx
              .insert(sourcesTable)
              .values({
                sourceId: input.sourceId,
                displayName: input.displayName,
                nearAccountId: input.nearAccountId,
                organizationId: input.organizationId,
              })
              .onConflictDoNothing()
              .returning();
            if (!created) {
              throw new ORPCError("CONFLICT", {
                message: "An Activity Source already uses this source ID or NEAR account",
              });
            }
            await tx.insert(eventTypesTable).values(
              input.eventTypes.map((eventType) => ({
                sourceRecordId: created.id,
                ...eventType,
              })),
            );
            return created;
          });
          const eventTypes = await eventTypesFor([source.id]);
          return toRecord(source, eventTypes, []);
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      getApprovedSourceForIngestion: async (sourceId) => {
        try {
          const [source] = await db
            .select()
            .from(sourcesTable)
            .where(eq(sourcesTable.sourceId, sourceId))
            .limit(1);
          if (!source) {
            throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
          }
          if (source.approvalStatus !== "approved") {
            throw new ORPCError("FORBIDDEN", {
              message: "Activity Source is not approved for ingestion",
            });
          }
          const eventTypes = await eventTypesFor([source.id]);
          const reviews = await reviewsFor([source.id]);
          return toRecord(source, eventTypes, reviews);
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      listSourcesByOrganization: async (organizationId) => {
        try {
          const sources = await db
            .select()
            .from(sourcesTable)
            .where(eq(sourcesTable.organizationId, organizationId))
            .orderBy(desc(sourcesTable.createdAt));
          const eventTypes = await eventTypesFor(sources.map(({ id }) => id));
          const reviews = await reviewsFor(sources.map(({ id }) => id));
          return sources.map((source) =>
            toRecord(
              source,
              eventTypes.filter(({ sourceRecordId }) => sourceRecordId === source.id),
              reviews.filter(({ sourceRecordId }) => sourceRecordId === source.id),
            ),
          );
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      updateSource: async (organizationId, sourceId, input) => {
        try {
          const source = await db.transaction(async (tx) => {
            const [existing] = await tx
              .select()
              .from(sourcesTable)
              .where(
                and(
                  eq(sourcesTable.sourceId, sourceId),
                  eq(sourcesTable.organizationId, organizationId),
                ),
              )
              .limit(1);
            if (!existing) {
              throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
            }

            const [updated] = await tx
              .update(sourcesTable)
              .set({
                ...(input.displayName !== undefined && { displayName: input.displayName }),
                ...(input.nearAccountId !== undefined && { nearAccountId: input.nearAccountId }),
                approvalStatus: "pending",
                reviewedBy: null,
                reviewReason: null,
                reviewedAt: null,
                updatedAt: new Date(),
              })
              .where(eq(sourcesTable.id, existing.id))
              .returning();
            if (!updated) {
              throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
            }

            if (input.eventTypes) {
              await tx
                .delete(eventTypesTable)
                .where(eq(eventTypesTable.sourceRecordId, existing.id));
              await tx.insert(eventTypesTable).values(
                input.eventTypes.map((eventType) => ({
                  sourceRecordId: existing.id,
                  ...eventType,
                })),
              );
            }
            return updated;
          });
          const eventTypes = await eventTypesFor([source.id]);
          const reviews = await reviewsFor([source.id]);
          return toRecord(source, eventTypes, reviews);
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      listSourcesForReview: async (approvalStatus) => {
        try {
          const query = db.select().from(sourcesTable).$dynamic();
          const sources = await (approvalStatus
            ? query.where(eq(sourcesTable.approvalStatus, approvalStatus))
            : query
          ).orderBy(desc(sourcesTable.createdAt));
          const eventTypes = await eventTypesFor(sources.map(({ id }) => id));
          const reviews = await reviewsFor(sources.map(({ id }) => id));
          return sources.map((source) =>
            toRecord(
              source,
              eventTypes.filter(({ sourceRecordId }) => sourceRecordId === source.id),
              reviews.filter(({ sourceRecordId }) => sourceRecordId === source.id),
            ),
          );
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      reviewSource: async (input) => {
        try {
          const source = await db.transaction(async (tx) => {
            const [existing] = await tx
              .select()
              .from(sourcesTable)
              .where(eq(sourcesTable.sourceId, input.sourceId))
              .limit(1);
            if (!existing) {
              throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
            }
            if (existing.approvalStatus !== "pending") {
              throw new ORPCError("CONFLICT", {
                message: "Only pending Activity Sources can be reviewed",
              });
            }
            const [reviewed] = await tx
              .update(sourcesTable)
              .set({
                approvalStatus: input.decision,
                reviewedBy: input.administratorId,
                reviewReason: input.reason,
                reviewedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(eq(sourcesTable.id, existing.id), eq(sourcesTable.approvalStatus, "pending")),
              )
              .returning();
            if (!reviewed) {
              throw new ORPCError("CONFLICT", {
                message: "Only pending Activity Sources can be reviewed",
              });
            }
            await tx.insert(reviewsTable).values({
              sourceRecordId: reviewed.id,
              decision: input.decision,
              reason: input.reason,
              administratorId: input.administratorId,
            });
            return reviewed;
          });
          const eventTypes = await eventTypesFor([source.id]);
          const reviews = await reviewsFor([source.id]);
          return toRecord(source, eventTypes, reviews);
        } catch (error) {
          throw toOrpcError(error);
        }
      },
    };

    return service;
  }),
);
