import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  applySourceUpdates,
  applyTenantUpdates,
  executePlan,
  loadAuthSnapshot,
  loadSourceRefs,
  loadTenantRefs,
} from "../../scripts/shared-auth/db";
import { planRemap } from "../../scripts/shared-auth/plan";
import { checkAuthSchema } from "../../scripts/shared-auth/schema-check";

// Copied verbatim from NEARBuilders/everything-dev plugins/auth/src/db/migrations at 2.0.0-rc.39.
const AUTH_MIGRATIONS_DIR = join(import.meta.dirname, "../fixtures/auth-migrations");
const API_MIGRATIONS_DIR = join(import.meta.dirname, "../../src/db/migrations");

async function applySqlFile(db: PGlite, path: string) {
  const sql = readFileSync(path, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await db.exec(statement);
  }
}

function authMigrations(from?: string, through?: string): string[] {
  return readdirSync(AUTH_MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (!from || f > from) && (!through || f <= `${through}.sql`))
    .sort();
}

async function authDb(through?: string) {
  const db = new PGlite();
  for (const file of authMigrations(undefined, through)) {
    await applySqlFile(db, join(AUTH_MIGRATIONS_DIR, file));
  }
  return db;
}

async function apiDb() {
  const db = new PGlite();
  const files = readdirSync(API_MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) await applySqlFile(db, join(API_MIGRATIONS_DIR, file));
  return db;
}

async function addUser(db: PGlite, id: string, nearAccountId: string) {
  await db.query(`INSERT INTO "user" (id, name, email) VALUES ($1, $1, $2)`, [
    id,
    `${id}@example.com`,
  ]);
  await db.query(
    `INSERT INTO near_account (id, user_id, account_id, network, public_key, is_primary, created_at)
     VALUES ($1, $2, $3, 'mainnet', 'ed25519:x', true, now())`,
    [`na_${id}`, id, nearAccountId],
  );
}

async function addOrg(db: PGlite, id: string, slug: string) {
  await db.query(
    `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $2, now())`,
    [id, slug],
  );
}

async function addMember(db: PGlite, id: string, orgId: string, userId: string, role: string) {
  await db.query(
    `INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())`,
    [id, orgId, userId, role],
  );
}

/**
 * Activity's auth DB: acme (also on nearbuilders) with alice and bob, carol's solo org only
 * exists here. One API key and one live session, both dropped by the cutover.
 */
async function seedActivityAuth() {
  const db = await authDb();
  await addUser(db, "fb_alice", "alice.near");
  await addUser(db, "fb_bob", "bob.near");
  await addUser(db, "fb_carol", "carol.near");
  await addOrg(db, "fb_acme", "acme");
  await addOrg(db, "fb_solo", "solo");
  await addMember(db, "fm_alice", "fb_acme", "fb_alice", "owner");
  await addMember(db, "fm_bob", "fb_acme", "fb_bob", "member");
  await addMember(db, "fm_carol", "fb_solo", "fb_carol", "owner");
  await db.query(
    `INSERT INTO apikey (id, name, reference_id, key, created_at, updated_at)
     VALUES ('key_ci', 'ci', 'fb_carol', 'hashed', now(), now())`,
  );
  await db.query(
    `INSERT INTO session (id, expires_at, token, user_id) VALUES ('s1', now() + interval '1 day', 't1', 'fb_alice')`,
  );
  return db;
}

/** nearbuilders.org's auth DB: same alice and bob under other ids, acme with an owner member. */
async function seedSharedAuth(db: PGlite) {
  await addUser(db, "nb_alice", "alice.near");
  await addUser(db, "nb_bob", "bob.near");
  await addOrg(db, "nb_acme", "acme");
  await addMember(db, "nm_alice", "nb_acme", "nb_alice", "owner");
}

async function sharedAuthAtLatest() {
  const db = await authDb("0000_sturdy_lady_vermin");
  await seedSharedAuth(db);
  for (const file of authMigrations("0000_sturdy_lady_vermin.sql")) {
    await applySqlFile(db, join(AUTH_MIGRATIONS_DIR, file));
  }
  return db;
}

async function seedApiDb(db: PGlite) {
  await db.query(
    `INSERT INTO tenants (id, subdomain, account_id, org_id, name) VALUES
       ('00000000-0000-4000-8000-000000000001', 'acme', 'acme.near', 'fb_acme', 'Acme'),
       ('00000000-0000-4000-8000-000000000002', 'solo', 'solo.near', 'fb_solo', 'Solo')`,
  );
  await db.query(
    `INSERT INTO activity_sources (id, source_id, display_name, near_account_id, organization_id) VALUES
       ('00000000-0000-4000-8000-000000000003', 'src-acme', 'Acme Source', 'acme.near', 'fb_acme'),
       ('00000000-0000-4000-8000-000000000004', 'src-solo', 'Solo Source', 'solo.near', 'fb_solo')`,
  );
}

async function setup() {
  const source = await seedActivityAuth();
  const shared = await sharedAuthAtLatest();
  const api = await apiDb();
  await seedApiDb(api);
  const plan = planRemap(await loadAuthSnapshot(source), await loadAuthSnapshot(shared), {
    tenants: await loadTenantRefs(api),
    sources: await loadSourceRefs(api),
  });
  return { source, shared, api, plan };
}

async function orgIdOf(db: PGlite, sql: string, label: string) {
  const { rows } = await db.query<{ org: string }>(sql);
  return rows[0]?.org ?? `missing: ${label}`;
}

describe("shared auth schema check", () => {
  it("reports a 0000 database as behind and lists what each migration still adds", async () => {
    const report = await checkAuthSchema(await authDb("0000_sturdy_lady_vermin"));
    expect(report.upToDate).toBe(false);
    expect(report.appliedThrough).toBe("0000_sturdy_lady_vermin");
    expect(report.pending.map((m) => m.tag)).toEqual([
      "0002_third_captain_stacy",
      "0003_teams_workspaces",
      "0004_futuristic_mandrill",
      "0005_blushing_george_stacy",
      "0006_device_link_claim",
      "0007_onboarding_code_event",
      "0008_pale_exiles",
      "0009_org-approval",
      "0010_preserve-approved-organizations",
      "0011_team-member-role",
      "0012_gifted_nicolaos",
      "0013_sleepy_komodo",
      "0014_deep_toad",
      "0015_careful_jasper_sitwell",
      "0016_ordinary_baron_zemo",
      "0017_loving_dorian_gray",
      "0018_icy_thunderbolts",
    ]);
  });

  it("tells 0009 from 0010 by the requested_by foreign key's delete rule", async () => {
    const report = await checkAuthSchema(await authDb("0009_org-approval"));
    expect(report.appliedThrough).toBe("0009_org-approval");
    expect(report.pending.map((m) => m.tag)).toEqual([
      "0010_preserve-approved-organizations",
      "0011_team-member-role",
      "0012_gifted_nicolaos",
      "0013_sleepy_komodo",
      "0014_deep_toad",
      "0015_careful_jasper_sitwell",
      "0016_ordinary_baron_zemo",
      "0017_loving_dorian_gray",
      "0018_icy_thunderbolts",
    ]);
    expect(report.pending[0]!.missing).toEqual([
      "constraint organization_requested_by_user_id_fk ON DELETE set null",
    ]);
  });

  it("migrates a populated 0000 database forward to 0018 without losing rows", async () => {
    const db = await authDb("0000_sturdy_lady_vermin");
    await seedSharedAuth(db);
    const count = async (table: string) =>
      Number((await db.query<{ n: number }>(`SELECT count(*) AS n FROM "${table}"`)).rows[0]!.n);
    const before = {
      user: await count("user"),
      near_account: await count("near_account"),
      organization: await count("organization"),
      member: await count("member"),
    };

    for (const file of authMigrations("0000_sturdy_lady_vermin.sql")) {
      await applySqlFile(db, join(AUTH_MIGRATIONS_DIR, file));
    }

    expect((await checkAuthSchema(db)).upToDate).toBe(true);
    for (const [table, n] of Object.entries(before)) expect(await count(table)).toBe(n);
    const { rows } = await db.query<{ status: string }>(`SELECT status FROM organization`);
    expect(rows).toEqual([{ status: "active" }]);
  });
});

describe("shared auth cutover", () => {
  it("dry run executes and verifies every write, then leaves both databases untouched", async () => {
    const { shared, api, plan } = await setup();
    expect(plan.conflicts).toEqual([]);
    expect(plan.apiKeysToReissue.map((k) => k.id)).toEqual(["key_ci"]);
    expect(plan.sessionsDropped).toBe(1);

    await executePlan(shared, api, plan, { apply: false });

    expect(
      await orgIdOf(api, `SELECT org_id AS org FROM tenants WHERE subdomain = 'acme'`, "acme"),
    ).toBe("fb_acme");
    const { rows } = await shared.query(`SELECT id FROM organization WHERE id = 'fb_solo'`);
    expect(rows).toHaveLength(0);
  });

  it("rewrites tenants and sources onto shared orgs and keeps copied users' access", async () => {
    const { source, shared, api, plan } = await setup();

    await executePlan(shared, api, plan, { apply: true });

    expect(
      await orgIdOf(api, `SELECT org_id AS org FROM tenants WHERE subdomain = 'acme'`, "acme"),
    ).toBe("nb_acme");
    expect(
      await orgIdOf(api, `SELECT org_id AS org FROM tenants WHERE subdomain = 'solo'`, "solo"),
    ).toBe("fb_solo");
    expect(
      await orgIdOf(
        api,
        `SELECT organization_id AS org FROM activity_sources WHERE source_id = 'src-acme'`,
        "src-acme",
      ),
    ).toBe("nb_acme");
    expect(
      await orgIdOf(
        api,
        `SELECT organization_id AS org FROM activity_sources WHERE source_id = 'src-solo'`,
        "src-solo",
      ),
    ).toBe("fb_solo");

    // bob stays a member of acme under his shared id; carol's org, membership, user and NEAR
    // account were copied with their ids, so her source and tenant keep working.
    const memberRole = async (orgId: string, userId: string) =>
      (
        await shared.query<{ role: string }>(
          `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2`,
          [orgId, userId],
        )
      ).rows[0]?.role;
    expect(await memberRole("nb_acme", "nb_bob")).toBe("member");
    expect(await memberRole("fb_solo", "fb_carol")).toBe("owner");
    const { rows: carolNear } = await shared.query(
      `SELECT user_id FROM near_account WHERE account_id = 'carol.near'`,
    );
    expect(carolNear).toEqual([{ user_id: "fb_carol" }]);

    // Re-running against the cut-over state plans nothing more.
    const again = planRemap(await loadAuthSnapshot(source), await loadAuthSnapshot(shared), {
      tenants: await loadTenantRefs(api),
      sources: await loadSourceRefs(api),
    });
    expect(again.conflicts).toEqual([]);
    expect(again.tenantUpdates).toEqual([]);
    expect(again.sourceUpdates).toEqual([]);
  });

  it("refuses to overwrite a tenant that changed after the plan was made", async () => {
    const { shared, api, plan } = await setup();
    await api.query(`UPDATE tenants SET org_id = 'fb_other' WHERE subdomain = 'acme'`);

    await expect(executePlan(shared, api, plan, { apply: true })).rejects.toThrow(
      "Tenant acme changed since the plan was made",
    );
    const { rows } = await shared.query(`SELECT id FROM organization WHERE id = 'fb_solo'`);
    expect(rows).toHaveLength(0);
  });

  it("refuses to overwrite a source that changed after the plan was made", async () => {
    const { shared, api, plan } = await setup();
    await api.query(
      `UPDATE activity_sources SET organization_id = 'fb_other' WHERE source_id = 'src-acme'`,
    );

    await expect(executePlan(shared, api, plan, { apply: true })).rejects.toThrow(
      "Source src-acme changed since the plan was made",
    );
    const { rows } = await shared.query(`SELECT id FROM organization WHERE id = 'fb_solo'`);
    expect(rows).toHaveLength(0);
  });

  it("guards apply the planned-from ids", async () => {
    const { api, plan } = await setup();
    await expect(applyTenantUpdates(api, plan)).resolves.toBeUndefined();
    await expect(applySourceUpdates(api, plan)).resolves.toBeUndefined();

    await api.query(`UPDATE tenants SET org_id = 'fb_other' WHERE subdomain = 'acme'`);
    await expect(applyTenantUpdates(api, plan)).rejects.toThrow(
      "Tenant acme changed since the plan was made",
    );
  });
});
