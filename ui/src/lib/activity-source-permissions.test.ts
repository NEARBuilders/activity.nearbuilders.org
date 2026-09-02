import { describe, expect, it, vi } from "vitest";
import {
  getActivitySourceRegistrationAccess,
  resolveActiveOrganizationMembership,
} from "@/lib/activity-source-permissions";

describe("getActivitySourceRegistrationAccess", () => {
  it.each([
    {
      input: { activeOrganizationId: null, organizationRole: null, hasNearAccount: true },
      expected: "organization-required",
    },
    {
      input: { activeOrganizationId: "org-1", organizationRole: "member", hasNearAccount: true },
      expected: "owner-required",
    },
    {
      input: { activeOrganizationId: "org-1", organizationRole: "owner", hasNearAccount: false },
      expected: "near-required",
    },
    {
      input: { activeOrganizationId: "org-1", organizationRole: "owner", hasNearAccount: true },
      expected: "allowed",
    },
  ])("returns $expected", ({ input, expected }) => {
    expect(getActivitySourceRegistrationAccess(input)).toBe(expected);
  });
});

describe("resolveActiveOrganizationMembership", () => {
  it("uses the dedicated member-role endpoint when the general auth context omits the member", async () => {
    const getActiveMemberRole = vi.fn().mockResolvedValue({ role: "owner" });

    await expect(
      resolveActiveOrganizationMembership({
        activeOrganizationId: "org-new",
        getActiveMemberRole,
      }),
    ).resolves.toEqual({
      activeOrganizationId: "org-new",
      activeOrganizationRole: "owner",
    });
    expect(getActiveMemberRole).toHaveBeenCalledWith({ organizationId: "org-new" });
  });
});
