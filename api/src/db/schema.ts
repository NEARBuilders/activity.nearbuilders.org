import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const tenantStatus = pgEnum("tenant_status", [
  "active",
  "pending",
  "suspended",
  "pending_deletion",
]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subdomain: text("subdomain").notNull().unique(),
    accountId: text("account_id").notNull().unique(),
    orgId: text("org_id").notNull().unique(),
    name: text("name").notNull(),
    status: tenantStatus("status").default("active").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  },
  (table) => ({
    subdomainIdx: uniqueIndex("tenants_subdomain_idx").on(table.subdomain),
    accountIdIdx: uniqueIndex("tenants_account_id_idx").on(table.accountId),
  }),
);

export const activitySourceApprovalStatus = pgEnum("activity_source_approval_status", [
  "pending",
  "approved",
  "rejected",
]);

export const activitySourceReviewDecision = pgEnum("activity_source_review_decision", [
  "approved",
  "rejected",
]);

export const activitySourceTrustStatus = pgEnum("activity_source_trust_status", [
  "standard",
  "trusted",
]);

export const activitySigningIdentityBindingStatus = pgEnum(
  "activity_signing_identity_binding_status",
  ["pending", "bound"],
);

export const activitySources = pgTable(
  "activity_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: text("source_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    nearAccountId: text("near_account_id").notNull().unique(),
    organizationId: text("organization_id").notNull(),
    approvalStatus: activitySourceApprovalStatus("approval_status").default("pending").notNull(),
    trustStatus: activitySourceTrustStatus("trust_status").default("standard").notNull(),
    scoreMultiplierBps: integer("score_multiplier_bps").default(10_000).notNull(),
    reviewedBy: text("reviewed_by"),
    reviewReason: text("review_reason"),
    reviewedAt: timestamp("reviewed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    organizationIdIdx: index("activity_sources_organization_id_idx").on(table.organizationId),
    approvalStatusIdx: index("activity_sources_approval_status_idx").on(table.approvalStatus),
  }),
);

export const activityEventTypes = pgTable(
  "activity_event_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => activitySources.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    pointValue: integer("point_value").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceNameIdx: uniqueIndex("activity_event_types_source_name_idx").on(
      table.sourceRecordId,
      table.name,
    ),
  }),
);

export const activitySourceReviews = pgTable(
  "activity_source_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => activitySources.id, { onDelete: "cascade" }),
    decision: activitySourceReviewDecision("decision").notNull(),
    reason: text("reason").notNull(),
    administratorId: text("administrator_id").notNull(),
    reviewedAt: timestamp("reviewed_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    sourceReviewedAtIdx: index("activity_source_reviews_source_reviewed_at_idx").on(
      table.sourceRecordId,
      table.reviewedAt,
    ),
  }),
);

export const activitySourceTrustChanges = pgTable(
  "activity_source_trust_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => activitySources.id, { onDelete: "cascade" }),
    trustStatus: activitySourceTrustStatus("trust_status").notNull(),
    scoreMultiplierBps: integer("score_multiplier_bps").notNull(),
    reason: text("reason").notNull(),
    administratorId: text("administrator_id").notNull(),
    changedAt: timestamp("changed_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceChangedAtIdx: index("activity_source_trust_changes_source_changed_at_idx").on(
      table.sourceRecordId,
      table.changedAt,
    ),
  }),
);

export const activitySigningIdentities = pgTable(
  "activity_signing_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => activitySources.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull().unique(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    encryptionIv: text("encryption_iv").notNull(),
    encryptionAuthTag: text("encryption_auth_tag").notNull(),
    encryptionKeyVersion: text("encryption_key_version").notNull(),
    createdBy: text("created_by"),
    bindingStatus: activitySigningIdentityBindingStatus("binding_status")
      .default("pending")
      .notNull(),
    boundNearAccountId: text("bound_near_account_id"),
    boundAt: timestamp("bound_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    retiredBy: text("retired_by"),
    retirementReason: text("retirement_reason"),
    retiredAt: timestamp("retired_at", { mode: "date", withTimezone: true }),
  },
  (table) => ({
    activeSourceIdentityIdx: uniqueIndex("activity_signing_identities_active_source_idx")
      .on(table.sourceRecordId)
      .where(sql`${table.retiredAt} is null`),
  }),
);

export const activitySourceApiKeys = pgTable(
  "activity_source_api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => activitySources.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretHash: text("secret_hash").notNull().unique(),
    permission: text("permission").default("event:write").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { mode: "date", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  },
  (table) => ({
    sourceApiKeysIdx: index("activity_source_api_keys_source_idx").on(table.sourceRecordId),
  }),
);

export const activityEventSubmissions = pgTable(
  "activity_event_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => activitySources.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    eventId: text("event_id"),
    eventJson: text("event_json"),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceIdempotencyIdx: uniqueIndex("activity_event_submissions_source_idempotency_idx").on(
      table.sourceRecordId,
      table.idempotencyKey,
    ),
  }),
);

export const activityEventEndorsements = pgTable(
  "activity_event_endorsements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: text("event_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventUserIdx: uniqueIndex("activity_event_endorsements_event_user_idx").on(
      table.eventId,
      table.userId,
    ),
    eventIdx: index("activity_event_endorsements_event_idx").on(table.eventId),
  }),
);

export const activityGithubIntegrations = pgTable(
  "activity_github_integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => activitySources.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(true).notNull(),
    mergedPullRequestsEnabled: boolean("merged_pull_requests_enabled").default(true).notNull(),
    closedIssuesEnabled: boolean("closed_issues_enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceIdx: uniqueIndex("activity_github_integrations_source_idx").on(table.sourceRecordId),
  }),
);

export const activityGithubRepositories = pgTable(
  "activity_github_repositories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => activityGithubIntegrations.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    repository: text("repository").notNull(),
    etag: text("etag"),
    pollIntervalSeconds: integer("poll_interval_seconds").default(60).notNull(),
    nextPollAt: timestamp("next_poll_at", { mode: "date", withTimezone: true }),
    lastPolledAt: timestamp("last_polled_at", { mode: "date", withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    integrationRepositoryIdx: uniqueIndex(
      "activity_github_repositories_integration_repository_idx",
    ).on(table.integrationId, table.owner, table.repository),
    nextPollIdx: index("activity_github_repositories_next_poll_idx").on(table.nextPollAt),
  }),
);

export const activityGithubActorMappings = pgTable(
  "activity_github_actor_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => activityGithubIntegrations.id, { onDelete: "cascade" }),
    githubLogin: text("github_login").notNull(),
    nearAccountId: text("near_account_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    integrationLoginIdx: uniqueIndex("activity_github_actor_mappings_integration_login_idx").on(
      table.integrationId,
      table.githubLogin,
    ),
  }),
);

export const activityGithubQuarantine = pgTable(
  "activity_github_quarantine",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => activityGithubIntegrations.id, { onDelete: "cascade" }),
    githubEventId: text("github_event_id").notNull(),
    repository: text("repository").notNull(),
    githubLogin: text("github_login").notNull(),
    eventType: text("event_type").notNull(),
    reason: text("reason").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    integrationEventIdx: uniqueIndex("activity_github_quarantine_integration_event_idx").on(
      table.integrationId,
      table.githubEventId,
    ),
  }),
);

export const activityHiddenEvents = pgTable(
  "activity_hidden_events",
  {
    eventId: text("event_id").primaryKey(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    actor: text("actor").notNull(),
    eventIdempotencyKey: text("event_idempotency_key").notNull(),
    eventCreatedAt: timestamp("event_created_at", { mode: "date", withTimezone: true }).notNull(),
    eventJson: text("event_json").notNull(),
    administratorId: text("administrator_id").notNull(),
    reason: text("reason").notNull(),
    hiddenAt: timestamp("hidden_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    hiddenAtIdx: index("activity_hidden_events_hidden_at_idx").on(table.hiddenAt, table.eventId),
    actorIdx: index("activity_hidden_events_actor_idx").on(table.actor),
    sourceIdx: index("activity_hidden_events_source_idx").on(table.source),
  }),
);

export const activityEventModerationRequests = pgTable(
  "activity_event_moderation_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => activityHiddenEvents.eventId),
    administratorId: text("administrator_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    reason: text("reason").notNull(),
    applied: boolean("applied").default(false).notNull(),
    requestedAt: timestamp("requested_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    administratorIdempotencyIdx: uniqueIndex(
      "activity_event_moderation_requests_administrator_idempotency_idx",
    ).on(table.administratorId, table.idempotencyKey),
    eventRequestedAtIdx: index("activity_event_moderation_requests_event_requested_at_idx").on(
      table.eventId,
      table.requestedAt,
    ),
  }),
);
