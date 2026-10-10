import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { MAX_ACTIVITY_SOURCES_PER_NEAR_ACCOUNT } from "../contract";
import type { Database } from "../db";
import { DatabaseTag } from "../db/layer";
import {
  type activitySourceApprovalStatus,
  type activitySourceTrustStatus,
  activityEventTypes as eventTypesTable,
  activitySigningIdentities as identitiesTable,
  activitySourceReviews as reviewsTable,
  activitySources as sourcesTable,
  activitySourceTrustChanges as trustChangesTable,
} from "../db/schema";
import { requireSourceNotRejected } from "./activity-source-access";

export type ActivitySourceApprovalStatus =
  (typeof activitySourceApprovalStatus)["enumValues"][number];
export type ActivitySourceTrustStatus = (typeof activitySourceTrustStatus)["enumValues"][number];

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
  nearbuildersProjectId?: string;
  organizationId: string;
  eventTypes: ActivityEventTypeInput[];
}

export interface ActivitySourceRecord {
  sourceId: string;
  displayName: string;
  nearAccountId: string;
  nearbuildersProjectId: string | null;
  organizationId: string;
  approvalStatus: ActivitySourceApprovalStatus;
  canIngest: boolean;
  trustStatus: ActivitySourceTrustStatus;
  scoreMultiplier: number;
  eventTypes: ActivityEventTypeInput[];
  reviewHistory: ActivitySourceReviewRecord[];
  trustHistory: ActivitySourceTrustChangeRecord[];
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

export interface ActivitySourceTrustChangeRecord {
  trustStatus: ActivitySourceTrustStatus;
  scoreMultiplier: number;
  reason: string;
  administratorId: string;
  changedAt: string;
}

export interface ActivitySourcesService {
  createSource(input: ActivitySourceInput): Promise<ActivitySourceRecord>;
  getSourceForIngestion(sourceId: string): Promise<ActivitySourceRecord>;
  listSourcesByOrganization(organizationId: string): Promise<ActivitySourceRecord[]>;
  getSourceAccount(
    organizationId: string,
    sourceId: string,
  ): Promise<{ nearAccountId: string; nearbuildersProjectId: string | null } | null>;
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
  updateSourceTrust(input: {
    sourceId: string;
    trustStatus: ActivitySourceTrustStatus;
    scoreMultiplier: number;
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
type TrustChangeRow = typeof trustChangesTable.$inferSelect;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(
  source: SourceRow,
  eventTypes: EventTypeRow[],
  reviews: ReviewRow[],
  trustChanges: TrustChangeRow[] = [],
): ActivitySourceRecord {
  return {
    sourceId: source.sourceId,
    displayName: source.displayName,
    nearAccountId: source.nearAccountId,
    nearbuildersProjectId: source.nearbuildersProjectId,
    organizationId: source.organizationId,
    approvalStatus: source.approvalStatus,
    canIngest: source.approvalStatus !== "rejected",
    trustStatus: source.trustStatus,
    scoreMultiplier: source.scoreMultiplierBps / 10_000,
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
    trustHistory: trustChanges.map(
      ({ trustStatus, scoreMultiplierBps, reason, administratorId, changedAt }) => ({
        trustStatus,
        scoreMultiplier: scoreMultiplierBps / 10_000,
        reason,
        administratorId,
        changedAt: iso(changedAt),
      }),
    ),
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

async function requireSourceCapacity(
  tx: Pick<Database, "select" | "execute">,
  nearAccountId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${nearAccountId}))`);
  const [row] = await tx
    .select({ total: count() })
    .from(sourcesTable)
    .where(eq(sourcesTable.nearAccountId, nearAccountId));
  if ((row?.total ?? 0) >= MAX_ACTIVITY_SOURCES_PER_NEAR_ACCOUNT) {
    throw new ORPCError("CONFLICT", {
      message: `The NEAR account ${nearAccountId} already owns the maximum of ${MAX_ACTIVITY_SOURCES_PER_NEAR_ACCOUNT} Activity Sources. Use another NEAR account for this one.`,
      data: { field: "nearAccountId" },
    });
  }
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

    const trustChangesFor = async (sourceRecordIds: string[]) => {
      if (sourceRecordIds.length === 0) return [];
      return await db
        .select()
        .from(trustChangesTable)
        .where(inArray(trustChangesTable.sourceRecordId, sourceRecordIds))
        .orderBy(asc(trustChangesTable.changedAt));
    };

    const service: ActivitySourcesService = {
      createSource: async (input) => {
        try {
          const source = await db.transaction(async (tx) => {
            await requireSourceCapacity(tx, input.nearAccountId);
            const [created] = await tx
              .insert(sourcesTable)
              .values({
                sourceId: input.sourceId,
                displayName: input.displayName,
                nearAccountId: input.nearAccountId,
                nearbuildersProjectId: input.nearbuildersProjectId ?? null,
                organizationId: input.organizationId,
              })
              .onConflictDoNothing()
              .returning();
            if (!created) {
              const [existing] = await tx
                .select({ sourceId: sourcesTable.sourceId })
                .from(sourcesTable)
                .where(eq(sourcesTable.sourceId, input.sourceId))
                .limit(1);
              const [projectSource] = input.nearbuildersProjectId
                ? await tx
                    .select({ sourceId: sourcesTable.sourceId })
                    .from(sourcesTable)
                    .where(eq(sourcesTable.nearbuildersProjectId, input.nearbuildersProjectId))
                    .limit(1)
                : [];
              throw new ORPCError("CONFLICT", {
                ...((existing || projectSource) && {
                  data: { field: existing ? "sourceId" : "project" },
                }),
                message: existing
                  ? `The Source ID ${input.sourceId} is already taken`
                  : projectSource
                    ? `This nearbuilders.org project already has an Activity Source: ${projectSource.sourceId}`
                    : "This Activity Source conflicts with an existing one",
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

      getSourceForIngestion: async (sourceId) => {
        try {
          const [source] = await db
            .select()
            .from(sourcesTable)
            .where(eq(sourcesTable.sourceId, sourceId))
            .limit(1);
          if (!source) {
            throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
          }
          requireSourceNotRejected(source);
          const eventTypes = await eventTypesFor([source.id]);
          const reviews = await reviewsFor([source.id]);
          return toRecord(source, eventTypes, reviews);
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      getSourceAccount: async (organizationId, sourceId) => {
        try {
          const [source] = await db
            .select({
              nearAccountId: sourcesTable.nearAccountId,
              nearbuildersProjectId: sourcesTable.nearbuildersProjectId,
            })
            .from(sourcesTable)
            .where(
              and(
                eq(sourcesTable.sourceId, sourceId),
                eq(sourcesTable.organizationId, organizationId),
              ),
            )
            .limit(1);
          return source ?? null;
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
          const trustChanges = await trustChangesFor(sources.map(({ id }) => id));
          return sources.map((source) =>
            toRecord(
              source,
              eventTypes.filter(({ sourceRecordId }) => sourceRecordId === source.id),
              reviews.filter(({ sourceRecordId }) => sourceRecordId === source.id),
              trustChanges.filter(({ sourceRecordId }) => sourceRecordId === source.id),
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
            const nearAccountChanged =
              input.nearAccountId !== undefined && input.nearAccountId !== existing.nearAccountId;
            if (nearAccountChanged && input.nearAccountId) {
              await requireSourceCapacity(tx, input.nearAccountId);
            }

            const [updated] = await tx
              .update(sourcesTable)
              .set({
                ...(input.displayName !== undefined && { displayName: input.displayName }),
                ...(input.nearAccountId !== undefined && { nearAccountId: input.nearAccountId }),
                ...(existing.approvalStatus !== "rejected" && {
                  approvalStatus: "pending" as const,
                  reviewedBy: null,
                  reviewReason: null,
                  reviewedAt: null,
                }),
                updatedAt: new Date(),
              })
              .where(eq(sourcesTable.id, existing.id))
              .returning();
            if (!updated) {
              throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
            }

            if (nearAccountChanged) {
              await tx
                .update(identitiesTable)
                .set({
                  bindingStatus: "pending",
                  boundNearAccountId: null,
                  boundAt: null,
                })
                .where(
                  and(
                    eq(identitiesTable.sourceRecordId, existing.id),
                    isNull(identitiesTable.retiredAt),
                  ),
                );
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
          const trustChanges = await trustChangesFor([source.id]);
          return toRecord(source, eventTypes, reviews, trustChanges);
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
          const trustChanges = await trustChangesFor(sources.map(({ id }) => id));
          return sources.map((source) =>
            toRecord(
              source,
              eventTypes.filter(({ sourceRecordId }) => sourceRecordId === source.id),
              reviews.filter(({ sourceRecordId }) => sourceRecordId === source.id),
              trustChanges.filter(({ sourceRecordId }) => sourceRecordId === source.id),
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
          const trustChanges = await trustChangesFor([source.id]);
          return toRecord(source, eventTypes, reviews, trustChanges);
        } catch (error) {
          throw toOrpcError(error);
        }
      },

      updateSourceTrust: async (input) => {
        try {
          const scoreMultiplierBps = Math.round(input.scoreMultiplier * 10_000);
          const source = await db.transaction(async (tx) => {
            const [existing] = await tx
              .select()
              .from(sourcesTable)
              .where(eq(sourcesTable.sourceId, input.sourceId))
              .limit(1);
            if (!existing) {
              throw new ORPCError("NOT_FOUND", { message: "Activity Source not found" });
            }
            const [updated] = await tx
              .update(sourcesTable)
              .set({
                trustStatus: input.trustStatus,
                scoreMultiplierBps,
                updatedAt: new Date(),
              })
              .where(eq(sourcesTable.id, existing.id))
              .returning();
            if (!updated) throw new Error("Activity Source trust was not updated");
            await tx.insert(trustChangesTable).values({
              sourceRecordId: updated.id,
              trustStatus: input.trustStatus,
              scoreMultiplierBps,
              reason: input.reason,
              administratorId: input.administratorId,
            });
            return updated;
          });
          const eventTypes = await eventTypesFor([source.id]);
          const reviews = await reviewsFor([source.id]);
          const trustChanges = await trustChangesFor([source.id]);
          return toRecord(source, eventTypes, reviews, trustChanges);
        } catch (error) {
          throw toOrpcError(error);
        }
      },
    };

    return service;
  }),
);
