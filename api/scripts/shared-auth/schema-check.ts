import type { Queryable } from "./db";

/**
 * The auth plugin's migrations (NEARBuilders/everything-dev `plugins/auth/src/db/migrations`,
 * as of 2.0.0-rc.39), each identified by what it leaves behind in the schema. Checking the
 * schema rather than the migration journal also catches a journal that claims a migration
 * whose DDL never ran.
 */
type Marker =
  | { table: string }
  | { table: string; column: string }
  | { constraint: string; onDelete: "set null" | "cascade" };

export const AUTH_MIGRATIONS: { tag: string; markers: Marker[] }[] = [
  {
    tag: "0000_sturdy_lady_vermin",
    markers: [
      { table: "user" },
      { table: "session" },
      { table: "account" },
      { table: "verification" },
      { table: "near_account" },
      { table: "organization" },
      { table: "member" },
      { table: "invitation" },
      { table: "apikey" },
    ],
  },
  {
    tag: "0002_third_captain_stacy",
    markers: [
      { table: "team" },
      { table: "team_member" },
      { table: "invitation", column: "team_id" },
    ],
  },
  {
    tag: "0003_teams_workspaces",
    markers: [
      { table: "invitation", column: "near_account_id" },
      { table: "session", column: "active_team_id" },
      { table: "team", column: "metadata" },
    ],
  },
  { tag: "0004_futuristic_mandrill", markers: [{ table: "device_code" }] },
  {
    tag: "0005_blushing_george_stacy",
    markers: [{ table: "onboarding_code" }, { table: "onboarding_redemption" }],
  },
  { tag: "0006_device_link_claim", markers: [{ table: "device_link_claim" }] },
  {
    tag: "0007_onboarding_code_event",
    markers: [
      { table: "onboarding_code", column: "event_id" },
      { table: "onboarding_code", column: "encrypted_code" },
    ],
  },
  { tag: "0008_pale_exiles", markers: [{ table: "user", column: "locale" }] },
  {
    tag: "0009_org-approval",
    markers: [
      { table: "organization", column: "status" },
      { table: "organization", column: "requested_by" },
      { table: "organization", column: "rejection_reason" },
    ],
  },
  {
    tag: "0010_preserve-approved-organizations",
    markers: [{ constraint: "organization_requested_by_user_id_fk", onDelete: "set null" }],
  },
  { tag: "0011_team-member-role", markers: [{ table: "team_member", column: "role" }] },
  {
    tag: "0012_gifted_nicolaos",
    markers: [
      { table: "team", column: "member_count" },
      { table: "team_member", column: "membership_key" },
    ],
  },
  { tag: "0013_sleepy_komodo", markers: [{ table: "funded_gas_key" }] },
  { tag: "0014_deep_toad", markers: [{ table: "custody_wallet" }] },
  { tag: "0015_careful_jasper_sitwell", markers: [{ table: "referral_code" }] },
  {
    tag: "0016_ordinary_baron_zemo",
    markers: [{ table: "user", column: "last_active_organization_id" }],
  },
  {
    tag: "0017_loving_dorian_gray",
    markers: [{ table: "team", column: "event_id" }],
  },
  { tag: "0018_icy_thunderbolts", markers: [{ table: "rate_limit" }] },
];

export const LATEST_AUTH_MIGRATION = AUTH_MIGRATIONS[AUTH_MIGRATIONS.length - 1]!.tag;

export interface AuthSchemaReport {
  /** Last migration whose effects, and those of every earlier one, are present. */
  appliedThrough: string | null;
  /** Migrations with at least one missing marker, in order. */
  pending: { tag: string; missing: string[] }[];
  upToDate: boolean;
}

function describe(marker: Marker): string {
  if ("constraint" in marker) return `constraint ${marker.constraint} ON DELETE ${marker.onDelete}`;
  if ("column" in marker) return `column ${marker.table}.${marker.column}`;
  return `table ${marker.table}`;
}

const DELETE_RULES: Record<string, string> = { n: "set null", c: "cascade" };

export async function checkAuthSchema(db: Queryable): Promise<AuthSchemaReport> {
  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const columns = await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const constraints = await db.query<{ conname: string; confdeltype: string }>(
    `SELECT c.conname, c.confdeltype::text AS confdeltype
     FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'public' AND c.contype = 'f'`,
  );
  const tableSet = new Set(tables.rows.map((r) => r.table_name));
  const columnSet = new Set(columns.rows.map((r) => `${r.table_name}.${r.column_name}`));
  const constraintRules = new Map(
    constraints.rows.map((r) => [r.conname, DELETE_RULES[r.confdeltype] ?? r.confdeltype]),
  );

  const present = (marker: Marker): boolean => {
    if ("constraint" in marker) return constraintRules.get(marker.constraint) === marker.onDelete;
    if ("column" in marker) return columnSet.has(`${marker.table}.${marker.column}`);
    return tableSet.has(marker.table);
  };

  let appliedThrough: string | null = null;
  const pending: AuthSchemaReport["pending"] = [];
  for (const migration of AUTH_MIGRATIONS) {
    const missing = migration.markers.filter((m) => !present(m)).map(describe);
    if (missing.length > 0) pending.push({ tag: migration.tag, missing });
    else if (pending.length === 0) appliedThrough = migration.tag;
  }
  return { appliedThrough, pending, upToDate: pending.length === 0 };
}

export function formatSchemaReport(label: string, report: AuthSchemaReport): string {
  const lines = [
    `${label}: applied through ${report.appliedThrough ?? "(nothing)"}; latest is ${LATEST_AUTH_MIGRATION}`,
  ];
  for (const migration of report.pending) {
    lines.push(`  pending ${migration.tag}: missing ${migration.missing.join(", ")}`);
  }
  return lines.join("\n");
}
