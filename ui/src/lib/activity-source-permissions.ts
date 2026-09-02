export type ActivitySourceRegistrationAccess =
  | "allowed"
  | "organization-required"
  | "owner-required"
  | "near-required";

export async function resolveActiveOrganizationMembership(input: {
  activeOrganizationId: string | null;
  getActiveMemberRole: (input: { organizationId: string }) => Promise<{ role: string | null }>;
}): Promise<{ activeOrganizationId: string | null; activeOrganizationRole: string | null }> {
  const activeOrganizationId = input.activeOrganizationId;
  if (!activeOrganizationId) {
    return { activeOrganizationId: null, activeOrganizationRole: null };
  }
  const { role } = await input.getActiveMemberRole({ organizationId: activeOrganizationId });
  return { activeOrganizationId, activeOrganizationRole: role };
}

export function getActivitySourceRegistrationAccess(input: {
  activeOrganizationId: string | null;
  organizationRole: string | null;
  hasNearAccount: boolean;
}): ActivitySourceRegistrationAccess {
  if (!input.activeOrganizationId) return "organization-required";
  if (input.organizationRole !== "owner") return "owner-required";
  if (!input.hasNearAccount) return "near-required";
  return "allowed";
}
