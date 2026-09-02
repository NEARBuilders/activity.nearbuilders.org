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
    bindingStatus: activitySigningIdentityBindingStatus("binding_status")
      .default("pending")
      .notNull(),
    boundNearAccountId: text("bound_near_account_id"),
    boundAt: timestamp("bound_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
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
