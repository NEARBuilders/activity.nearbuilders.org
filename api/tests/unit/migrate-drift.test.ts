import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Database } from "@/db";
import { detectDrift, loadMigrations, migrate } from "@/db/migrate";
import type { MigrationStorage } from "everything-dev/db";

const STORAGE: MigrationStorage = {
  schema: "drizzle",
  table: "__drizzle_migrations_drifttest",
  slug: "drifttest",
};

function makeDb(): Database {
  return drizzle(new PGlite()) as unknown as Database;
}

async function rows(db: Database, query: string): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql.raw(query));
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

async function scalar(db: Database, query: string): Promise<string | null> {
  const r = await rows(db, query);
  const first = r[0];
  if (!first) return null;
  const value = Object.values(first)[0];
  return value === null || value === undefined ? null : String(value);
}

const ENUM_ORDER_QUERY = `
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
  FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'tenant_status'
`;

async function assertFinalSchema(db: Database): Promise<void> {
  expect(await scalar(db, ENUM_ORDER_QUERY)).toBe("active,pending,suspended,pending_deletion");

  expect(
    await scalar(
      db,
      `SELECT count(*) FROM information_schema.columns
       WHERE table_name = 'activity_signing_identities' AND column_name = 'created_by'`,
    ),
  ).toBe("1");

  expect(
    await scalar(
      db,
      `SELECT count(*) FROM information_schema.columns
       WHERE table_name = 'activity_binding_sessions' AND column_name = 'delivery'`,
    ),
  ).toBe("1");

  expect(
    await scalar(
      db,
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'activity_event_endorsements' AND column_name = 'user_id'`,
    ),
  ).toBe("YES");

  const recreatedIndex = await rows(
    db,
    `SELECT i.indisunique::text AS uniq, (i.indpred IS NOT NULL)::text AS partial
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'activity_event_endorsements_event_user_idx'`,
  );
  expect(recreatedIndex).toHaveLength(1);
  expect(recreatedIndex[0]?.uniq).toBe("true");
  expect(recreatedIndex[0]?.partial).toBe("true");

  expect(
    await scalar(
      db,
      `SELECT count(*) FROM information_schema.table_constraints
       WHERE table_name = 'activity_sources'
         AND constraint_name = 'activity_sources_near_account_id_unique'`,
    ),
  ).toBe("0");

  expect(
    await scalar(
      db,
      `SELECT count(*) FROM pg_indexes
       WHERE indexname = 'activity_sources_near_account_id_idx'`,
    ),
  ).toBe("1");
}

async function journalCount(db: Database): Promise<string | null> {
  return scalar(db, `SELECT count(*) FROM "${STORAGE.schema}"."${STORAGE.table}"`);
}

describe("migrate drift healing", () => {
  it("applies the full chain on a fresh database", async () => {
    const { migrations } = await Effect.runPromise(loadMigrations());
    expect(migrations.length).toBeGreaterThan(10);

    const db = makeDb();
    const applied = await Effect.runPromise(migrate(db, migrations, STORAGE));
    expect(applied).toBe(migrations.length);
    expect(await journalCount(db)).toBe(String(migrations.length));
    await assertFinalSchema(db);

    const drift = await Effect.runPromise(detectDrift(db, migrations, STORAGE));
    expect(drift.status).toBe("healthy");
  });

  it("heals a fully-drifted database (schema ahead of empty journal)", async () => {
    const { migrations } = await Effect.runPromise(loadMigrations());
    const db = makeDb();
    await Effect.runPromise(migrate(db, migrations, STORAGE));
    await db.execute(sql.raw(`DELETE FROM "${STORAGE.schema}"."${STORAGE.table}"`));

    const applied = await Effect.runPromise(migrate(db, migrations, STORAGE));
    expect(applied).toBe(migrations.length);
    expect(await journalCount(db)).toBe(String(migrations.length));
    await assertFinalSchema(db);
  });

  it("applies missing statements on a partially-drifted database", async () => {
    const { migrations } = await Effect.runPromise(loadMigrations());
    const db = makeDb();

    const headApplied = await Effect.runPromise(migrate(db, migrations.slice(0, 8), STORAGE));
    expect(headApplied).toBe(8);
    await db.execute(sql.raw(`DELETE FROM "${STORAGE.schema}"."${STORAGE.table}"`));

    const applied = await Effect.runPromise(migrate(db, migrations, STORAGE));
    expect(applied).toBe(migrations.length);
    expect(await journalCount(db)).toBe(String(migrations.length));

    expect(
      await scalar(
        db,
        `SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'activity_signing_identities' AND column_name = 'created_by'`,
      ),
    ).toBe("1");
    await assertFinalSchema(db);
  });
});
