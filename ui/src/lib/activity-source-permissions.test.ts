import { describe, expect, it } from "vitest";
import { getActivitySourceRegistrationAccess } from "@/lib/activity-source-permissions";

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
