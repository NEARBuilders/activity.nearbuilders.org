/**
 * Moves activity's org references onto the shared nearbuilders.org auth database (#118).
 *
 *   pnpm run auth:cutover [--apply] [--overrides overrides.json] [--report plan.json]
 *
 * Environment:
 *   ACTIVITY_AUTH_DATABASE_URL  activity's current auth DB (read only)
 *   SHARED_AUTH_DATABASE_URL    the nearbuilders.org auth DB activity moves onto
 *   API_DATABASE_URL            activity's API DB (holds `tenants` and `activity_sources`)
 *
 * Without `--apply` this is a dry run: every write is executed inside transactions, verified,
 * and rolled back. See README.md next to this file for the full runbook.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { connect, requireEnv } from "./connect";
import { executePlan, loadAuthSnapshot, loadSourceRefs, loadTenantRefs } from "./db";
import { planRemap, type RemapOverrides, summarizePlan } from "./plan";
import { checkAuthSchema, formatSchemaReport } from "./schema-check";

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const apply = process.argv.includes("--apply");
const overridesPath = flagValue("--overrides");
const reportPath = flagValue("--report");
const overrides: RemapOverrides = overridesPath
  ? JSON.parse(readFileSync(overridesPath, "utf8"))
  : {};

const source = await connect(requireEnv("ACTIVITY_AUTH_DATABASE_URL"));
const shared = await connect(requireEnv("SHARED_AUTH_DATABASE_URL"));
const api = await connect(requireEnv("API_DATABASE_URL"));

let exitCode = 0;
try {
  const sharedSchema = await checkAuthSchema(shared);
  console.log(formatSchemaReport("Shared auth DB", sharedSchema));
  if (!sharedSchema.upToDate) {
    throw new Error(
      "The shared auth DB is behind the auth plugin; migrate it first (runbook step 2)",
    );
  }
  const sourceSchema = await checkAuthSchema(source);
  console.log(formatSchemaReport("Activity auth DB", sourceSchema));
  if (!sourceSchema.appliedThrough) {
    throw new Error("The activity auth DB has no auth schema; it is not the DB activity runs on");
  }

  const [sourceSnapshot, sharedSnapshot, tenants, sources] = await Promise.all([
    loadAuthSnapshot(source),
    loadAuthSnapshot(shared),
    loadTenantRefs(api),
    loadSourceRefs(api),
  ]);
  const plan = planRemap(sourceSnapshot, sharedSnapshot, { tenants, sources }, overrides);
  console.log(`\n${summarizePlan(plan)}\n`);
  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify(plan, null, 2));
    console.log(`Plan written to ${reportPath}`);
  }
  if (plan.conflicts.length > 0) {
    throw new Error("Resolve the conflicts above (overrides file or manual fixes) and re-run");
  }

  await executePlan(shared, api, plan, { apply });
  console.log(
    apply
      ? "Cutover applied and verified."
      : "Dry run passed: all writes succeeded and verified, then rolled back.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  await Promise.all([source.end(), shared.end(), api.end()]);
}
process.exit(exitCode);
