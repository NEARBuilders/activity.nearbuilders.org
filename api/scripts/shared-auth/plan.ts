/**
 * Remap plan for moving activity onto the shared nearbuilders.org auth database (#118).
 *
 * Pure: takes snapshots of the two auth databases and activity's org references and
 * decides, without touching any database, which shared-DB org each activity org becomes,
 * which auth rows must be copied (ids preserved) so org members keep their access, and
 * how `tenants.org_id` / `activity_sources.organization_id` are rewritten. Activity has
 * no team references, so — unlike feedback's cutover (#110) — teams are not remapped.
 */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthNearAccount {
  id: string;
  userId: string;
  accountId: string;
  network: string;
  publicKey: string;
  isPrimary: boolean | null;
  createdAt: Date;
}

export interface AuthAccount {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  password: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthOrganization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  metadata: string | null;
  createdAt: Date;
}

export interface AuthMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
}

export interface AuthApiKey {
  id: string;
  name: string | null;
  referenceId: string;
}

export interface AuthSnapshot {
  users: AuthUser[];
  nearAccounts: AuthNearAccount[];
  accounts: AuthAccount[];
  organizations: AuthOrganization[];
  members: AuthMember[];
  apiKeys: AuthApiKey[];
  sessionCount: number;
}

/** An api-DB row that points at an auth org: a tenant or an activity source. */
export interface OrgRef {
  id: string;
  label: string;
  organizationId: string;
}

/** Hand-picked source id → shared id pairs, for orgs whose slug differs. */
export interface RemapOverrides {
  organizations?: Record<string, string>;
}

export type Resolution<T extends string> =
  | { kind: "same-id"; targetId: string }
  | { kind: T; targetId: string }
  | { kind: "override"; targetId: string }
  | { kind: "copy"; targetId: string };

export interface OrgMapping {
  sourceId: string;
  slug: string;
  targetSlug: string;
  sharedNearAccounts: string[];
  resolution: Resolution<"slug">;
}

export interface UserMapping {
  sourceId: string;
  resolution: Resolution<"near-account" | "email">;
}

export interface OrgRefUpdate {
  id: string;
  label: string;
  from: string;
  to: string;
}

export interface RemapPlan {
  organizations: OrgMapping[];
  users: UserMapping[];
  /** Rows to insert into the shared auth DB, already rewritten to shared ids. */
  inserts: {
    users: AuthUser[];
    nearAccounts: AuthNearAccount[];
    accounts: AuthAccount[];
    organizations: AuthOrganization[];
    members: AuthMember[];
  };
  tenantUpdates: OrgRefUpdate[];
  sourceUpdates: OrgRefUpdate[];
  /** Memberships already present in the shared DB with a different role; the shared role wins. */
  roleDifferences: {
    organizationId: string;
    userId: string;
    sourceRole: string;
    targetRole: string;
  }[];
  /** Activity's auth-DB API keys that will not exist in the shared DB and must be re-issued. */
  apiKeysToReissue: AuthApiKey[];
  /** Activity sessions that will be dropped; their users sign in again. */
  sessionsDropped: number;
  /** Anything that blocks the cutover. A plan with conflicts must not be applied. */
  conflicts: string[];
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function nearKey(account: { accountId: string; network: string }): string {
  return `${account.network}:${account.accountId.toLowerCase()}`;
}

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function memberNearAccounts(snapshot: AuthSnapshot, organizationId: string): AuthNearAccount[] {
  const userIds = new Set(
    snapshot.members
      .filter((member) => member.organizationId === organizationId)
      .map((m) => m.userId),
  );
  return snapshot.nearAccounts.filter((account) => userIds.has(account.userId));
}

function sharedNearAccountIds(
  source: AuthSnapshot,
  target: AuthSnapshot,
  sourceOrgId: string,
  targetOrgId: string,
): string[] {
  const targetKeys = new Set(memberNearAccounts(target, targetOrgId).map(nearKey));
  const shared = new Set<string>();
  for (const account of memberNearAccounts(source, sourceOrgId)) {
    if (targetKeys.has(nearKey(account))) shared.add(account.accountId.toLowerCase());
  }
  return [...shared].sort();
}

/** Orgs an update would rewrite: the ones tenants and activity sources point at. */
export function relevantOrgIds(refs: OrgRef[]): Set<string> {
  return new Set(refs.map((ref) => ref.organizationId));
}

function mapOrgs(
  source: AuthSnapshot,
  target: AuthSnapshot,
  refs: OrgRef[],
  overrides: RemapOverrides,
  conflicts: string[],
): { orgMap: Map<string, string>; mappings: OrgMapping[]; orgInserts: AuthOrganization[] } {
  const sourceOrgs = byId(source.organizations);
  const targetOrgs = byId(target.organizations);
  const targetOrgBySlug = new Map(target.organizations.map((o) => [o.slug, o]));

  const orgMap = new Map<string, string>();
  const mappings: OrgMapping[] = [];
  const orgInserts: AuthOrganization[] = [];
  for (const orgId of [...relevantOrgIds(refs)].sort()) {
    const org = sourceOrgs.get(orgId);
    if (!org) continue;
    const override = overrides.organizations?.[orgId];
    let resolution: Resolution<"slug">;
    let targetSlug = org.slug;
    let sharedMembers: string[] = [];
    if (override) {
      if (!targetOrgs.has(override)) {
        conflicts.push(`Override maps org ${orgId} to ${override}, which is not in the shared DB`);
        continue;
      }
      resolution = { kind: "override", targetId: override };
      targetSlug = targetOrgs.get(override)!.slug;
      sharedMembers = sharedNearAccountIds(source, target, orgId, override);
    } else if (targetOrgs.has(orgId)) {
      resolution = { kind: "same-id", targetId: orgId };
      targetSlug = targetOrgs.get(orgId)!.slug;
      sharedMembers = sharedNearAccountIds(source, target, orgId, orgId);
    } else if (targetOrgBySlug.has(org.slug)) {
      const slugMatch = targetOrgBySlug.get(org.slug)!;
      sharedMembers = sharedNearAccountIds(source, target, orgId, slugMatch.id);
      if (sharedMembers.length === 0) {
        conflicts.push(
          `Org ${orgId} matches shared org ${slugMatch.id} by slug "${org.slug}" but they share no members; add an override`,
        );
        continue;
      }
      resolution = { kind: "slug", targetId: slugMatch.id };
      targetSlug = slugMatch.slug;
    } else {
      resolution = { kind: "copy", targetId: orgId };
      orgInserts.push(org);
    }
    orgMap.set(orgId, resolution.targetId);
    mappings.push({
      sourceId: orgId,
      slug: org.slug,
      targetSlug,
      sharedNearAccounts: sharedMembers,
      resolution,
    });
  }
  return { orgMap, mappings, orgInserts };
}

/**
 * Rewrites one list of api-DB org references onto mapped shared org ids. A ref whose org
 * could not be mapped is skipped (the org loop already reported it as a conflict); a ref
 * whose org exists only in the shared DB needs no update; a ref pointing at an org in
 * neither database is a conflict.
 */
function planRefUpdates(
  refs: OrgRef[],
  what: "Tenant" | "Source",
  orgMap: Map<string, string>,
  sourceOrgIds: Set<string>,
  targetOrgIds: Set<string>,
  conflicts: string[],
): OrgRefUpdate[] {
  const updates: OrgRefUpdate[] = [];
  for (const ref of refs) {
    let organizationId = ref.organizationId;
    if (orgMap.has(organizationId)) {
      organizationId = orgMap.get(organizationId)!;
    } else if (sourceOrgIds.has(organizationId)) {
      continue;
    } else if (!targetOrgIds.has(organizationId)) {
      conflicts.push(
        `${what} ${ref.label} points at org ${organizationId}, which is in neither auth DB`,
      );
      continue;
    }
    if (organizationId !== ref.organizationId) {
      updates.push({ id: ref.id, label: ref.label, from: ref.organizationId, to: organizationId });
    }
  }
  return updates;
}

export function planRemap(
  source: AuthSnapshot,
  target: AuthSnapshot,
  refs: { tenants: OrgRef[]; sources: OrgRef[] },
  overrides: RemapOverrides = {},
): RemapPlan {
  const conflicts: string[] = [];
  const allRefs = [...refs.tenants, ...refs.sources];

  const { orgMap, mappings, orgInserts } = mapOrgs(source, target, allRefs, overrides, conflicts);

  // Users that hold a membership in a relevant org, so access survives the cutover.
  const relevantMembers = source.members.filter((m) => orgMap.has(m.organizationId));
  const relevantUserIds = new Set(relevantMembers.map((m) => m.userId));

  const sourceOrgIds = new Set(source.organizations.map((o) => o.id));
  const targetOrgIds = new Set(target.organizations.map((o) => o.id));
  const sourceUsers = byId(source.users);
  const targetUsers = byId(target.users);
  const targetUserByNear = new Map<string, string>();
  for (const account of target.nearAccounts) targetUserByNear.set(nearKey(account), account.userId);
  const targetUserByEmail = new Map(target.users.map((u) => [normalizeName(u.email), u.id]));

  const userMap = new Map<string, string>();
  const users: UserMapping[] = [];
  const userInserts: AuthUser[] = [];
  const nearAccountInserts: AuthNearAccount[] = [];
  const accountInserts: AuthAccount[] = [];
  for (const userId of [...relevantUserIds].sort()) {
    const user = sourceUsers.get(userId);
    if (!user) {
      conflicts.push(
        `Membership references user ${userId}, which is missing from the activity auth DB`,
      );
      continue;
    }
    const nearAccounts = source.nearAccounts.filter((a) => a.userId === userId);
    const nearMatches = new Set(
      nearAccounts.map((a) => targetUserByNear.get(nearKey(a))).filter((id): id is string => !!id),
    );
    let resolution: UserMapping["resolution"];
    if (targetUsers.has(userId)) {
      resolution = { kind: "same-id", targetId: userId };
    } else if (nearMatches.size > 1) {
      conflicts.push(
        `User ${userId}'s NEAR accounts belong to ${nearMatches.size} different shared users: ${[...nearMatches].join(", ")}`,
      );
      continue;
    } else if (nearMatches.size === 1) {
      resolution = { kind: "near-account", targetId: [...nearMatches][0]! };
    } else if (targetUserByEmail.has(normalizeName(user.email))) {
      const targetUserId = targetUserByEmail.get(normalizeName(user.email))!;
      const targetUser = targetUsers.get(targetUserId);
      if (!user.emailVerified || !targetUser?.emailVerified) {
        conflicts.push(
          `User ${userId} matches shared user ${targetUserId} by email but the email is not verified on both sides; add an override`,
        );
        continue;
      }
      resolution = { kind: "email", targetId: targetUserId };
    } else {
      resolution = { kind: "copy", targetId: userId };
      userInserts.push(user);
      nearAccountInserts.push(...nearAccounts);
      accountInserts.push(...source.accounts.filter((a) => a.userId === userId));
    }
    userMap.set(userId, resolution.targetId);
    users.push({ sourceId: userId, resolution });
  }

  const targetMemberKeys = new Map(
    target.members.map((m) => [`${m.organizationId}|${m.userId}`, m]),
  );
  const memberInserts: AuthMember[] = [];
  const roleDifferences: RemapPlan["roleDifferences"] = [];
  const plannedMemberKeys = new Set<string>();
  for (const member of relevantMembers) {
    const userId = userMap.get(member.userId);
    if (!userId) continue;
    const organizationId = orgMap.get(member.organizationId)!;
    const key = `${organizationId}|${userId}`;
    const existing = targetMemberKeys.get(key);
    if (existing) {
      if (existing.role !== member.role) {
        roleDifferences.push({
          organizationId,
          userId,
          sourceRole: member.role,
          targetRole: existing.role,
        });
      }
      continue;
    }
    if (plannedMemberKeys.has(key)) continue;
    plannedMemberKeys.add(key);
    memberInserts.push({ ...member, organizationId, userId });
  }

  return {
    organizations: mappings,
    users,
    inserts: {
      users: userInserts,
      nearAccounts: nearAccountInserts,
      accounts: accountInserts,
      organizations: orgInserts,
      members: memberInserts,
    },
    tenantUpdates: planRefUpdates(
      refs.tenants,
      "Tenant",
      orgMap,
      sourceOrgIds,
      targetOrgIds,
      conflicts,
    ),
    sourceUpdates: planRefUpdates(
      refs.sources,
      "Source",
      orgMap,
      sourceOrgIds,
      targetOrgIds,
      conflicts,
    ),
    roleDifferences,
    apiKeysToReissue: source.apiKeys,
    sessionsDropped: source.sessionCount,
    conflicts,
  };
}

/** Human-readable summary for the dry-run report. */
export function summarizePlan(plan: RemapPlan): string {
  const count = <T extends { resolution: { kind: string } }>(rows: T[], kind: string) =>
    rows.filter((row) => row.resolution.kind === kind).length;
  const lines = [
    `Organizations: ${plan.organizations.length} (same id ${count(plan.organizations, "same-id")}, by slug ${count(plan.organizations, "slug")}, override ${count(plan.organizations, "override")}, copied ${count(plan.organizations, "copy")})`,
    ...plan.organizations
      .filter((org) => org.resolution.kind !== "same-id")
      .map((org) => {
        const shared = org.sharedNearAccounts.length
          ? `; shared members ${org.sharedNearAccounts.join(", ")}`
          : "";
        return `  ${org.slug} [${org.sourceId}] -> ${org.targetSlug} [${org.resolution.targetId}] (${org.resolution.kind}${shared})`;
      }),
    `Users: ${plan.users.length} (same id ${count(plan.users, "same-id")}, by NEAR account ${count(plan.users, "near-account")}, by email ${count(plan.users, "email")}, copied ${count(plan.users, "copy")})`,
    `Rows to insert: ${plan.inserts.users.length} users, ${plan.inserts.nearAccounts.length} NEAR accounts, ${plan.inserts.accounts.length} accounts, ${plan.inserts.organizations.length} orgs, ${plan.inserts.members.length} members`,
    `Tenants to rewrite: ${plan.tenantUpdates.length}`,
    ...plan.tenantUpdates.map((u) => `  ${u.label}: org ${u.from} -> ${u.to}`),
    `Sources to rewrite: ${plan.sourceUpdates.length}`,
    ...plan.sourceUpdates.map((u) => `  ${u.label}: org ${u.from} -> ${u.to}`),
    `Role differences (shared role kept): ${plan.roleDifferences.length}`,
    ...plan.roleDifferences.map(
      (d) =>
        `  org ${d.organizationId} user ${d.userId}: activity ${d.sourceRole}, shared ${d.targetRole}`,
    ),
    `API keys to re-issue: ${plan.apiKeysToReissue.length}`,
    ...plan.apiKeysToReissue.map(
      (k) => `  ${k.name ?? "(unnamed)"} [${k.id}] for ${k.referenceId}`,
    ),
    `Sessions dropped (users sign in again): ${plan.sessionsDropped}`,
    `Conflicts: ${plan.conflicts.length}`,
    ...plan.conflicts.map((c) => `  ! ${c}`),
  ];
  return lines.join("\n");
}
