#!/usr/bin/env -S pnpm exec tsx
// `pnpm run backfill:endorsement-owners [--apply]` — one-off backfill for #103. Keys every
// activity endorsement on its endorser's canonical owner id (primary NEAR account, or user
// id for a user without one) and merges rows that collapse onto one owner. Dry run unless
// --apply is passed. Run it before the shared auth DB (C3) flip.
//
// This is the one sanctioned read of the auth schema: the auth plugin has no admin lookup
// from user id to NEAR accounts, so the mapping comes straight from its NEAR account table.
//
//   API_DATABASE_URL=postgres://... AUTH_DATABASE_URL=postgres://... \
//     pnpm run backfill:endorsement-owners [--apply]
import { Client } from "pg";
import { type NearLink, planEndorsementBackfill } from "./lib/endorsement-backfill";

const apply = process.argv.includes("--apply");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/** Finds the NEAR account link table and its columns, whichever naming the auth DB uses. */
async function readNearLinks(auth: Client): Promise<NearLink[]> {
  const { rows: columns } = await auth.query<{ schema: string; table: string; column: string }>(
    `SELECT table_schema AS schema, table_name AS table, column_name AS column
       FROM information_schema.columns
      WHERE table_name ~* '^near_?accounts?$'`,
  );
  const table = columns[0];
  if (!table) throw new Error("No NEAR account table found in AUTH_DATABASE_URL");
  const own = columns.filter((c) => c.schema === table.schema && c.table === table.table);
  const pick = (pattern: RegExp) => {
    const match = own.find((c) => pattern.test(c.column));
    if (!match) throw new Error(`NEAR account table has no column matching ${pattern}`);
    return quote(match.column);
  };
  const { rows } = await auth.query<{ user_id: string; account_id: string; is_primary: boolean }>(
    `SELECT ${pick(/^user_?id$/i)} AS user_id, ${pick(/^account_?id$/i)} AS account_id,
            ${pick(/^is_?primary$/i)} AS is_primary
       FROM ${quote(table.schema)}.${quote(table.table)}`,
  );
  return rows.map((row) => ({
    userId: row.user_id,
    accountId: row.account_id,
    isPrimary: Boolean(row.is_primary),
  }));
}

async function main() {
  const auth = new Client({ connectionString: requireEnv("AUTH_DATABASE_URL") });
  const api = new Client({ connectionString: requireEnv("API_DATABASE_URL") });
  await auth.connect();
  await api.connect();
  try {
    const links = await readNearLinks(auth);
    const { rows } = await api.query<{
      id: string;
      event_id: string;
      user_id: string | null;
      owner_account_id: string | null;
      created_at: Date;
    }>(
      "SELECT id, event_id, user_id, owner_account_id, created_at FROM activity_event_endorsements",
    );
    const plan = planEndorsementBackfill(
      rows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        userId: row.user_id,
        ownerAccountId: row.owner_account_id,
        createdAt: row.created_at,
      })),
      links,
    );
    console.log(
      `${rows.length} endorsements: ${plan.updates.length} to re-key, ${plan.deletes.length} duplicates to merge, ${plan.usersWithoutNear} endorsers without NEAR keep their user id.`,
    );
    if (!apply) {
      console.log("Dry run. Pass --apply to write.");
      return;
    }
    await api.query("BEGIN");
    try {
      if (plan.deletes.length > 0) {
        await api.query("DELETE FROM activity_event_endorsements WHERE id = ANY($1::uuid[])", [
          plan.deletes,
        ]);
      }
      for (const update of plan.updates) {
        await api.query(
          "UPDATE activity_event_endorsements SET owner_account_id = $2 WHERE id = $1",
          [update.id, update.ownerAccountId],
        );
      }
      await api.query("COMMIT");
    } catch (error) {
      await api.query("ROLLBACK");
      throw error;
    }
    console.log("Applied.");
  } finally {
    await Promise.allSettled([auth.end(), api.end()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
