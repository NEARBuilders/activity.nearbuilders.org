export type ActivitySourceRegistrationAccess =
  | "allowed"
  | "organization-required"
  | "owner-required"
  | "near-required";

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
