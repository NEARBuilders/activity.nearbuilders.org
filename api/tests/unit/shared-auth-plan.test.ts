import { describe, expect, it } from "vitest";
import {
  type AuthSnapshot,
  type OrgRef,
  planRemap,
  summarizePlan,
} from "../../scripts/shared-auth/plan";

const at = new Date("2026-01-01T00:00:00Z");

function snapshot(partial: Partial<AuthSnapshot> = {}): AuthSnapshot {
  return {
    users: [],
    nearAccounts: [],
    accounts: [],
    organizations: [],
    members: [],
    apiKeys: [],
    sessionCount: 0,
    ...partial,
  };
}

const user = (id: string, email = `${id}@example.com`, emailVerified = true) => ({
  id,
  name: id,
  email,
  emailVerified,
  image: null,
  createdAt: at,
  updatedAt: at,
});
const near = (id: string, userId: string, accountId: string) => ({
  id,
  userId,
  accountId,
  network: "mainnet",
  publicKey: `ed25519:${id}`,
  isPrimary: true,
  createdAt: at,
});
const org = (id: string, slug: string) => ({
  id,
  name: slug,
  slug,
  logo: null,
  metadata: null,
  createdAt: at,
});
const member = (id: string, organizationId: string, userId: string, role = "member") => ({
  id,
  organizationId,
  userId,
  role,
  createdAt: at,
});
const tenant = (subdomain: string, organizationId: string): OrgRef => ({
  id: `t_${subdomain}`,
  label: subdomain,
  organizationId,
});
const source = (sourceId: string, organizationId: string): OrgRef => ({
  id: `s_${sourceId}`,
  label: sourceId,
  organizationId,
});
const refs = (
  tenantRefs: OrgRef[],
  sourceRefs: OrgRef[] = [],
): { tenants: OrgRef[]; sources: OrgRef[] } => ({ tenants: tenantRefs, sources: sourceRefs });

describe("planRemap", () => {
  const activity = snapshot({
    users: [user("fb_alice"), user("fb_bob")],
    nearAccounts: [near("fn_a", "fb_alice", "alice.near"), near("fn_b", "fb_bob", "bob.near")],
    organizations: [org("fb_acme", "acme")],
    members: [member("fm_a", "fb_acme", "fb_alice", "owner"), member("fm_b", "fb_acme", "fb_bob")],
  });

  it("maps orgs by slug and users by NEAR account, rewriting tenants and sources", () => {
    const shared = snapshot({
      users: [user("nb_alice", "different@example.com"), user("nb_bob", "bob2@example.com")],
      nearAccounts: [near("nn_a", "nb_alice", "alice.near"), near("nn_b", "nb_bob", "BOB.near")],
      organizations: [org("nb_acme", "acme")],
      members: [member("nm_a", "nb_acme", "nb_alice", "owner")],
    });

    const plan = planRemap(
      activity,
      shared,
      refs([tenant("acme", "fb_acme")], [source("acme", "fb_acme")]),
    );

    expect(plan.conflicts).toEqual([]);
    expect(plan.organizations[0]!.resolution).toEqual({ kind: "slug", targetId: "nb_acme" });
    expect(plan.users.map((u) => u.resolution)).toEqual([
      { kind: "near-account", targetId: "nb_alice" },
      { kind: "near-account", targetId: "nb_bob" },
    ]);
    expect(plan.inserts.organizations).toEqual([]);
    expect(plan.inserts.users).toEqual([]);
    expect(plan.inserts.members).toEqual([
      expect.objectContaining({ organizationId: "nb_acme", userId: "nb_bob", role: "member" }),
    ]);
    expect(plan.tenantUpdates).toEqual([
      { id: "t_acme", label: "acme", from: "fb_acme", to: "nb_acme" },
    ]);
    expect(plan.sourceUpdates).toEqual([
      { id: "s_acme", label: "acme", from: "fb_acme", to: "nb_acme" },
    ]);
  });

  it("copies orgs and users with no shared counterpart, keeping their ids", () => {
    const plan = planRemap(activity, snapshot(), refs([tenant("acme", "fb_acme")]));

    expect(plan.conflicts).toEqual([]);
    expect(plan.inserts.organizations.map((o) => o.id)).toEqual(["fb_acme"]);
    expect(plan.inserts.users.map((u) => u.id)).toEqual(["fb_alice", "fb_bob"]);
    expect(plan.inserts.nearAccounts.map((a) => a.id)).toEqual(["fn_a", "fn_b"]);
    expect(plan.inserts.members).toHaveLength(2);
    expect(plan.tenantUpdates).toEqual([]);
    expect(plan.sourceUpdates).toEqual([]);
  });

  it("falls back to email when no NEAR account matches and both emails are verified", () => {
    const shared = snapshot({ users: [user("nb_alice", "FB_ALICE@example.com")] });
    const plan = planRemap(activity, shared, refs([tenant("acme", "fb_acme")]));
    expect(plan.users[0]!.resolution).toEqual({ kind: "email", targetId: "nb_alice" });
  });

  it("refuses a slug match when the orgs share no NEAR members", () => {
    const activitySolo = snapshot({
      users: [user("alice")],
      nearAccounts: [near("fn_a", "alice", "alice.near")],
      organizations: [org("fb_acme", "acme")],
      members: [member("fm_a", "fb_acme", "alice", "owner")],
    });
    const shared = snapshot({
      users: [user("mallory")],
      nearAccounts: [near("nn_m", "mallory", "mallory.near")],
      organizations: [org("sh_other", "acme")],
      members: [member("nm_m", "sh_other", "mallory", "owner")],
    });
    const plan = planRemap(activitySolo, shared, refs([tenant("acme", "fb_acme")]));
    expect(plan.conflicts).toEqual([
      'Org fb_acme matches shared org sh_other by slug "acme" but they share no members; add an override',
    ]);
    expect(plan.organizations).toEqual([]);
    expect(plan.tenantUpdates).toEqual([]);
  });

  it("refuses an email match when either address is unverified", () => {
    const shared = snapshot({ users: [user("nb_alice", "FB_ALICE@example.com", false)] });
    const plan = planRemap(activity, shared, refs([tenant("acme", "fb_acme")]));
    expect(plan.conflicts).toEqual([
      "User fb_alice matches shared user nb_alice by email but the email is not verified on both sides; add an override",
    ]);
    expect(plan.users.find((mapped) => mapped.sourceId === "fb_alice")).toBeUndefined();
  });

  it("lists non-same-id org matches and the members they share", () => {
    const shared = snapshot({
      users: [user("nb_alice", "different@example.com")],
      nearAccounts: [near("nn_a", "nb_alice", "alice.near")],
      organizations: [org("nb_acme", "acme")],
      members: [member("nm_a", "nb_acme", "nb_alice", "owner")],
    });
    const plan = planRemap(activity, shared, refs([tenant("acme", "fb_acme")]));
    expect(summarizePlan(plan)).toContain(
      "acme [fb_acme] -> acme [nb_acme] (slug; shared members alice.near)",
    );
  });

  it("is a no-op once refs already point at shared-only orgs", () => {
    const shared = snapshot({ organizations: [org("nb_acme", "acme")] });
    const plan = planRemap(
      activity,
      shared,
      refs([tenant("acme", "nb_acme")], [source("x", "nb_acme")]),
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.organizations).toEqual([]);
    expect(plan.tenantUpdates).toEqual([]);
    expect(plan.sourceUpdates).toEqual([]);
  });

  it("keeps the shared role when a membership already exists and reports the difference", () => {
    const shared = snapshot({
      users: [user("nb_alice")],
      nearAccounts: [near("nn_a", "nb_alice", "alice.near")],
      organizations: [org("nb_acme", "acme")],
      members: [member("nm_a", "nb_acme", "nb_alice", "admin")],
    });
    const plan = planRemap(activity, shared, refs([tenant("acme", "fb_acme")]));
    expect(plan.roleDifferences).toEqual([
      { organizationId: "nb_acme", userId: "nb_alice", sourceRole: "owner", targetRole: "admin" },
    ]);
    expect(plan.inserts.members.some((m) => m.userId === "nb_alice")).toBe(false);
  });

  it("honours overrides and rejects ones that point nowhere", () => {
    const shared = snapshot({ organizations: [org("nb_acme_inc", "acme-inc")] });
    const plan = planRemap(activity, shared, refs([tenant("acme", "fb_acme")]), {
      organizations: { fb_acme: "nb_acme_inc" },
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.tenantUpdates[0]!.to).toBe("nb_acme_inc");

    const bad = planRemap(activity, shared, refs([tenant("acme", "fb_acme")]), {
      organizations: { fb_acme: "missing" },
    });
    expect(bad.conflicts).toEqual([
      "Override maps org fb_acme to missing, which is not in the shared DB",
    ]);
  });

  it("refuses a user whose NEAR accounts belong to different shared users", () => {
    const split = snapshot({
      ...activity,
      nearAccounts: [...activity.nearAccounts, near("fn_a2", "fb_alice", "alice2.near")],
    });
    const shared = snapshot({
      users: [user("nb_1"), user("nb_2")],
      nearAccounts: [near("n1", "nb_1", "alice.near"), near("n2", "nb_2", "alice2.near")],
    });
    const plan = planRemap(split, shared, refs([tenant("acme", "fb_acme")]));
    expect(plan.conflicts).toEqual([
      "User fb_alice's NEAR accounts belong to 2 different shared users: nb_1, nb_2",
    ]);
  });

  it("flags tenants and sources whose org exists in neither auth DB", () => {
    const plan = planRemap(
      activity,
      snapshot(),
      refs([tenant("ghost", "org_gone")], [source("ghost-src", "org_gone")]),
    );
    expect(plan.conflicts).toEqual([
      "Tenant ghost points at org org_gone, which is in neither auth DB",
      "Source ghost-src points at org org_gone, which is in neither auth DB",
    ]);
  });

  it("lists activity API keys and live sessions that will not carry over", () => {
    const withKeys = snapshot({
      ...activity,
      apiKeys: [{ id: "k1", name: "ci", referenceId: "fb_alice" }],
      sessionCount: 3,
    });
    const plan = planRemap(withKeys, snapshot(), refs([]));
    expect(plan.apiKeysToReissue).toEqual([{ id: "k1", name: "ci", referenceId: "fb_alice" }]);
    expect(plan.sessionsDropped).toBe(3);
  });
});
