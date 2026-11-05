import type {
  AuthAccount,
  AuthApiKey,
  AuthMember,
  AuthNearAccount,
  AuthOrganization,
  AuthSnapshot,
  AuthUser,
  OrgRef,
  RemapPlan,
} from "./plan";

/** The slice of `pg.Client` / `PGlite` the cutover needs. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export async function loadAuthSnapshot(db: Queryable): Promise<AuthSnapshot> {
  const [users, nearAccounts, accounts, organizations, members, apiKeys, sessions] =
    await Promise.all([
      db.query<AuthUser>(
        `SELECT id, name, email, email_verified AS "emailVerified", image,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM "user"`,
      ),
      db.query<AuthNearAccount>(
        `SELECT id, user_id AS "userId", account_id AS "accountId", network,
                public_key AS "publicKey", is_primary AS "isPrimary", created_at AS "createdAt"
         FROM near_account`,
      ),
      db.query<AuthAccount>(
        `SELECT id, account_id AS "accountId", provider_id AS "providerId", user_id AS "userId",
                access_token AS "accessToken", refresh_token AS "refreshToken", id_token AS "idToken",
                access_token_expires_at AS "accessTokenExpiresAt",
                refresh_token_expires_at AS "refreshTokenExpiresAt",
                scope, password, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM account`,
      ),
      db.query<AuthOrganization>(
        `SELECT id, name, slug, logo, metadata, created_at AS "createdAt" FROM organization`,
      ),
      db.query<AuthMember>(
        `SELECT id, organization_id AS "organizationId", user_id AS "userId", role,
                created_at AS "createdAt"
         FROM member`,
      ),
      db.query<AuthApiKey>(`SELECT id, name, reference_id AS "referenceId" FROM apikey`),
      db.query<{ count: number | string }>(
        `SELECT count(*) AS count FROM session WHERE expires_at > now()`,
      ),
    ]);
  return {
    users: users.rows,
    nearAccounts: nearAccounts.rows,
    accounts: accounts.rows,
    organizations: organizations.rows,
    members: members.rows,
    apiKeys: apiKeys.rows,
    sessionCount: Number(sessions.rows[0]?.count ?? 0),
  };
}

export async function loadTenantRefs(db: Queryable): Promise<OrgRef[]> {
  const { rows } = await db.query<OrgRef>(
    `SELECT id, subdomain AS "label", org_id AS "organizationId"
     FROM tenants
     ORDER BY subdomain`,
  );
  return rows;
}

export async function loadSourceRefs(db: Queryable): Promise<OrgRef[]> {
  const { rows } = await db.query<OrgRef>(
    `SELECT id, source_id AS "label", organization_id AS "organizationId"
     FROM activity_sources
     ORDER BY source_id`,
  );
  return rows;
}

async function insertRows<T>(
  db: Queryable,
  table: string,
  columns: string[],
  rows: T[],
  values: (row: T) => unknown[],
): Promise<void> {
  const columnList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  for (const row of rows) {
    await db.query(
      `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
      values(row),
    );
  }
}

/** Inserts the plan's rows into the shared auth DB. Idempotent: existing ids are left alone. */
export async function applyAuthInserts(db: Queryable, plan: RemapPlan): Promise<void> {
  const { inserts } = plan;
  await insertRows(
    db,
    "user",
    ["id", "name", "email", "email_verified", "image", "created_at", "updated_at"],
    inserts.users,
    (u) => [u.id, u.name, u.email, u.emailVerified, u.image, u.createdAt, u.updatedAt],
  );
  await insertRows(
    db,
    "near_account",
    ["id", "user_id", "account_id", "network", "public_key", "is_primary", "created_at"],
    inserts.nearAccounts,
    (a) => [a.id, a.userId, a.accountId, a.network, a.publicKey, a.isPrimary, a.createdAt],
  );
  await insertRows(
    db,
    "account",
    [
      "id",
      "account_id",
      "provider_id",
      "user_id",
      "access_token",
      "refresh_token",
      "id_token",
      "access_token_expires_at",
      "refresh_token_expires_at",
      "scope",
      "password",
      "created_at",
      "updated_at",
    ],
    inserts.accounts,
    (a) => [
      a.id,
      a.accountId,
      a.providerId,
      a.userId,
      a.accessToken,
      a.refreshToken,
      a.idToken,
      a.accessTokenExpiresAt,
      a.refreshTokenExpiresAt,
      a.scope,
      a.password,
      a.createdAt,
      a.updatedAt,
    ],
  );
  await insertRows(
    db,
    "organization",
    ["id", "name", "slug", "logo", "metadata", "created_at", "status"],
    inserts.organizations,
    (o) => [o.id, o.name, o.slug, o.logo, o.metadata, o.createdAt, "active"],
  );
  await insertRows(
    db,
    "member",
    ["id", "organization_id", "user_id", "role", "created_at"],
    inserts.members,
    (m) => [m.id, m.organizationId, m.userId, m.role, m.createdAt],
  );
}

/**
 * Rewrites tenant/source org ids. Each update only applies while the row still holds the id
 * the plan was computed from, so a row edited since the plan was made fails the cutover
 * instead of being silently overwritten.
 */
export async function applyTenantUpdates(db: Queryable, plan: RemapPlan): Promise<void> {
  for (const update of plan.tenantUpdates) {
    const { rows } = await db.query(
      `UPDATE tenants
       SET org_id = $2, updated_at = now()
       WHERE id = $1
         AND org_id IS NOT DISTINCT FROM $3
       RETURNING id`,
      [update.id, update.to, update.from],
    );
    if (rows.length !== 1) {
      throw new Error(`Tenant ${update.label} changed since the plan was made; re-run the cutover`);
    }
  }
}

export async function applySourceUpdates(db: Queryable, plan: RemapPlan): Promise<void> {
  for (const update of plan.sourceUpdates) {
    const { rows } = await db.query(
      `UPDATE activity_sources
       SET organization_id = $2, updated_at = now()
       WHERE id = $1
         AND organization_id IS NOT DISTINCT FROM $3
       RETURNING id`,
      [update.id, update.to, update.from],
    );
    if (rows.length !== 1) {
      throw new Error(`Source ${update.label} changed since the plan was made; re-run the cutover`);
    }
  }
}

/**
 * Runs the plan's writes in one transaction per database and verifies the result. Without
 * `apply` both transactions are rolled back, which makes this the dry run.
 */
export async function executePlan(
  shared: Queryable,
  api: Queryable,
  plan: RemapPlan,
  { apply }: { apply: boolean },
): Promise<void> {
  if (plan.conflicts.length > 0) throw new Error("The plan has conflicts; refusing to run it");
  const rollback = async () => {
    await shared.query("ROLLBACK").catch(() => {});
    await api.query("ROLLBACK").catch(() => {});
  };
  await shared.query("BEGIN");
  await api.query("BEGIN");
  try {
    await applyAuthInserts(shared, plan);
    await applyTenantUpdates(api, plan);
    await applySourceUpdates(api, plan);
    const problems = await verifyCutover(shared, api);
    if (problems.length > 0) throw new Error(`Verification failed:\n  ${problems.join("\n  ")}`);
  } catch (error) {
    await rollback();
    throw error;
  }
  if (!apply) {
    await rollback();
    return;
  }
  // Auth first: its inserts are idempotent, so a failure between the two commits is
  // recovered by re-running the cutover.
  await shared.query("COMMIT");
  await api.query("COMMIT");
}

/**
 * After the cutover every tenant and activity source must point at an org that exists in
 * the shared DB, or tenant resolution and source review access break.
 */
export async function verifyCutover(shared: Queryable, api: Queryable): Promise<string[]> {
  const tenants = await loadTenantRefs(api);
  const sources = await loadSourceRefs(api);
  const orgs = await shared.query<{ id: string }>(`SELECT id FROM organization`);
  const orgIds = new Set(orgs.rows.map((o) => o.id));
  const problems: string[] = [];
  for (const tenant of tenants) {
    if (!orgIds.has(tenant.organizationId)) {
      problems.push(`Tenant ${tenant.label}: org ${tenant.organizationId} is not in the shared DB`);
    }
  }
  for (const source of sources) {
    if (!orgIds.has(source.organizationId)) {
      problems.push(`Source ${source.label}: org ${source.organizationId} is not in the shared DB`);
    }
  }
  return problems;
}
