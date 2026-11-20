import { resolve } from "node:path";
import type { Migration } from "virtual:drizzle-migrations.sql";
import { Effect } from "effect";
import {
  detectDrift as detectDriftFramework,
  getMigrationStorage,
  loadMigrations as loadMigrationsFramework,
  runMigrations,
  type MigrationStorage,
} from "everything-dev/db";
import { type Database, DatabaseError } from "./index";

export interface LoadedMigrations {
  migrations: Migration[];
  source: "virtual" | "disk";
}

export interface DriftReport {
  status: "healthy" | "empty" | "untracked-existing-schema" | "drift-safe-repair" | "drift-manual";
  expectedTables: string[];
  missingTables: string[];
  appliedHashes: number;
  localHashes: number;
  storage: MigrationStorage;
}

interface FrameworkErrorShape {
  stage: "driver" | "migration" | "load" | "close";
  migrationTag?: string;
  statementIndex?: number;
  cause: unknown;
}

function toLocalError(frameworkError: FrameworkErrorShape): DatabaseError {
  return new DatabaseError({
    stage: frameworkError.stage,
    migrationTag: frameworkError.migrationTag,
    statementIndex: frameworkError.statementIndex,
    cause: frameworkError.cause,
  });
}

const MIGRATIONS_DIR = resolve(import.meta.dirname, "migrations");

const DROP_PREFIX = /^DROP\s+(TABLE|INDEX|TYPE|VIEW)\s+(?!IF\s+EXISTS)/i;
const ALTER_DROP = /^(ALTER\s+TABLE\s+.+?\s+DROP\s+(?:CONSTRAINT|COLUMN)\s+)(?!IF\s+EXISTS)/i;

/**
 * Removal DDL is not idempotent: a schema pushed ahead of the journal has
 * already applied its drops, so replaying `DROP CONSTRAINT/Index/COLUMN`
 * fails with "does not exist" (SQLSTATE 42704), which the framework runner
 * deliberately does not tolerate (it would mask typos in forward runs).
 * Rewriting drops to `IF EXISTS` gives the same skip semantics without
 * broadening duplicate-DDL tolerance to statements that must fail loudly.
 */
function makeDropsIdempotent(statement: string): string {
  return statement.replace(DROP_PREFIX, "$&IF EXISTS ").replace(ALTER_DROP, "$1IF EXISTS ");
}

/**
 * Thin adapter over the framework's migration runner (`everything-dev/db`).
 *
 * The framework runner executes every statement under a SAVEPOINT and
 * tolerates duplicate-DDL errors (SQLSTATE 42710/42701/42P07 and the
 * concurrent-DDL 23505 catalog collision), so a database whose schema is
 * ahead of the journal (pushed before the journal existed) heals on boot:
 * already-applied statements roll back their savepoint and are skipped,
 * genuinely-missing statements still execute, and the journal converges.
 */
export function loadMigrations(): Effect.Effect<LoadedMigrations, DatabaseError> {
  return Effect.mapError(
    loadMigrationsFramework({
      virtual: () =>
        import("virtual:drizzle-migrations.sql") as Promise<{ default?: Migration[] }>,
      fromDir: MIGRATIONS_DIR,
    }),
    toLocalError,
  );
}

export function migrate(
  db: Database,
  migrations: Migration[],
  storage?: MigrationStorage,
): Effect.Effect<number, DatabaseError> {
  const healable = migrations.map((migration) => ({
    ...migration,
    sql: migration.sql.map(makeDropsIdempotent),
  }));
  return Effect.mapError(
    Effect.map(
      runMigrations(db, healable, { journal: storage ?? getMigrationStorage() }),
      (report) => report.applied,
    ),
    toLocalError,
  );
}

export function detectDrift(
  db: Database,
  migrations: Migration[],
  storage?: MigrationStorage,
): Effect.Effect<DriftReport, DatabaseError> {
  return Effect.mapError(
    detectDriftFramework(db, migrations, storage ?? getMigrationStorage()),
    toLocalError,
  );
}
