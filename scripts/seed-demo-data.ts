#!/usr/bin/env bun
// `bun run seed:demo` — populates a local dev environment with a demo Activity
// Source, event types, a bound signing identity, and a handful of published
// events, so the UI has something to show. Uses the real ingestion pipeline
// (POST /v1/events) for the events themselves so relay publish + leaderboard
// scoring happen exactly as they would in production; only the source/identity
// bootstrap (which normally requires a live NEAR wallet binding proof) is
// seeded directly in Postgres.
import { createHash, randomBytes } from "node:crypto";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { Client } from "pg";
import {
  encryptActivitySecret,
  parseActivityMasterKeys,
} from "../api/src/activity/activity-credentials-crypto";

const root = new URL("..", import.meta.url);
const envPath = new URL(".env", root);
const envContent = await Bun.file(envPath).text();

function envValue(key: string): string {
  const line = envContent.split("\n").find((l) => l.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1) ?? "";
  if (!value) throw new Error(`${key} is not set in .env — run \`bun run first-run\` first.`);
  return value;
}

const databaseUrl = envValue("API_DATABASE_URL");
const masterKeys = parseActivityMasterKeys(
  envValue("ACTIVITY_SIGNING_MASTER_KEYS"),
  envValue("ACTIVITY_SIGNING_ACTIVE_KEY_VERSION"),
);
const apiUrl = process.env.SEED_API_URL || "http://localhost:4101/api/v1/events";

const SOURCE_ID = "demo-source";
const NEAR_ACCOUNT_ID = "demo-source.near";
const ORG_ID = "demo-org";
const EVENT_TYPES = [
  { name: "pr.merged", description: "Pull request merged", pointValue: 10 },
  { name: "issue.closed", description: "Issue closed", pointValue: 5 },
  { name: "release.published", description: "Release published", pointValue: 20 },
] as const;
const ACTORS = ["alice.near", "bob.near", "carol.near"] as const;

const client = new Client({ connectionString: databaseUrl });
await client.connect();

async function upsertSource(): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `select id from activity_sources where source_id = $1`,
    [SOURCE_ID],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query<{ id: string }>(
    `insert into activity_sources
       (source_id, display_name, near_account_id, organization_id, approval_status, trust_status)
     values ($1, $2, $3, $4, 'approved', 'standard')
     returning id`,
    [SOURCE_ID, "Demo Source", NEAR_ACCOUNT_ID, ORG_ID],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("Failed to insert demo Activity Source");
  return id;
}

async function upsertEventTypes(sourceRecordId: string): Promise<void> {
  for (const eventType of EVENT_TYPES) {
    await client.query(
      `insert into activity_event_types (source_record_id, name, description, enabled, point_value)
       values ($1, $2, $3, true, $4)
       on conflict (source_record_id, name) do update set enabled = true, point_value = excluded.point_value`,
      [sourceRecordId, eventType.name, eventType.description, eventType.pointValue],
    );
  }
}

async function ensureBoundSigningIdentity(sourceRecordId: string): Promise<void> {
  const existing = await client.query(
    `select id from activity_signing_identities
     where source_record_id = $1 and binding_status = 'bound' and retired_at is null`,
    [sourceRecordId],
  );
  if (existing.rows[0]) return;

  const privateKey = generateSecretKey();
  const publicKey = getPublicKey(privateKey);
  const encrypted = encryptActivitySecret(privateKey, masterKeys);
  privateKey.fill(0);

  await client.query(
    `insert into activity_signing_identities
       (source_record_id, public_key, encrypted_private_key, encryption_iv, encryption_auth_tag,
        encryption_key_version, created_by, binding_status, bound_near_account_id, bound_at)
     values ($1, $2, $3, $4, $5, $6, 'seed-script', 'bound', $7, now())`,
    [
      sourceRecordId,
      publicKey,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      encrypted.keyVersion,
      NEAR_ACCOUNT_ID,
    ],
  );
}

async function ensureApiKey(sourceRecordId: string): Promise<string> {
  const secret = `act_${randomBytes(32).toString("base64url")}`;
  const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");
  await client.query(
    `insert into activity_source_api_keys (source_record_id, name, prefix, secret_hash, permission)
     values ($1, 'seed-script', $2, $3, 'event:write')`,
    [sourceRecordId, secret.slice(0, 12), secretHash],
  );
  return secret;
}

const sourceRecordId = await upsertSource();
await upsertEventTypes(sourceRecordId);
await ensureBoundSigningIdentity(sourceRecordId);
const apiKey = await ensureApiKey(sourceRecordId);
await client.end();

console.log(`Seeded Activity Source "${SOURCE_ID}" (approved, bound signing identity).`);
console.log("Publishing sample events through the real ingestion pipeline...");

let published = 0;
for (let i = 0; i < 12; i++) {
  const eventType = EVENT_TYPES[i % EVENT_TYPES.length];
  const actor = ACTORS[i % ACTORS.length];
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      eventType: eventType.name,
      actor,
      idempotencyKey: `seed:${eventType.name}:${actor}:${i}:${Date.now()}`,
      payload: { seeded: true, index: i },
    }),
  });
  if (response.ok) {
    published += 1;
  } else {
    console.error(`  event ${i} failed: ${response.status} ${await response.text()}`);
  }
}

console.log(`Published ${published}/12 sample events for source "${SOURCE_ID}".`);
console.log("Refresh the Activity feed in the UI to see them.");
