/**
 * Reports how far an auth database is through the auth plugin's migrations.
 *
 *   pnpm run auth:check-schema SHARED_AUTH_DATABASE_URL [ACTIVITY_AUTH_DATABASE_URL ...]
 *
 * Arguments name environment variables holding connection strings. Exits 1 when any
 * database is behind the latest migration.
 */
import { connect, requireEnv } from "./connect";
import { checkAuthSchema, formatSchemaReport } from "./schema-check";

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error("Usage: check-schema.ts <ENV_VAR_WITH_DATABASE_URL> [...]");
  process.exit(2);
}

let behind = false;
for (const name of names) {
  const client = await connect(requireEnv(name));
  try {
    const report = await checkAuthSchema(client);
    console.log(formatSchemaReport(name, report));
    if (!report.upToDate) behind = true;
  } finally {
    await client.end();
  }
}
process.exit(behind ? 1 : 0);
