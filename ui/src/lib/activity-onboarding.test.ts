import { describe, expect, it } from "vitest";
import {
  type ActivityOnboardingInput,
  getActivityOnboardingSteps,
  pickOnboardingSource,
} from "@/lib/activity-onboarding";

const ready: ActivityOnboardingInput = {
  hasNearAccount: true,
  isOrganizationOwner: true,
  source: { approvalStatus: "approved" },
  identity: { bindingStatus: "bound" },
  hasApiKey: true,
};

function statuses(input: ActivityOnboardingInput) {
  return Object.fromEntries(
    getActivityOnboardingSteps(input).map((step) => [step.id, step.status]),
  );
}

describe("getActivityOnboardingSteps", () => {
  it("starts a new user at connecting NEAR with every later step upcoming", () => {
    expect(
      statuses({
        hasNearAccount: false,
        isOrganizationOwner: false,
        source: null,
        identity: null,
        hasApiKey: false,
      }),
    ).toEqual({
      near: "current",
      organization: "upcoming",
      register: "upcoming",
      binding: "upcoming",
      "api-key": "upcoming",
    });
  });

  it("moves to the organization step once NEAR is connected", () => {
    expect(
      statuses({
        ...ready,
        isOrganizationOwner: false,
        source: null,
        identity: null,
        hasApiKey: false,
      }).organization,
    ).toBe("current");
  });

  it("lets a pending source continue to binding without waiting for approval", () => {
    const steps = statuses({
      ...ready,
      source: { approvalStatus: "pending" },
      identity: null,
      hasApiKey: false,
    });
    expect(steps.register).toBe("complete");
    expect(steps.binding).toBe("current");
    expect(steps).not.toHaveProperty("approval");
  });

  it("completes setup for a pending source once it has an API key", () => {
    expect(
      new Set(Object.values(statuses({ ...ready, source: { approvalStatus: "pending" } }))),
    ).toEqual(new Set(["complete"]));
  });

  it("blocks the register step when the source was rejected", () => {
    const steps = statuses({
      ...ready,
      source: { approvalStatus: "rejected" },
      identity: null,
      hasApiKey: false,
    });
    expect(steps.register).toBe("blocked");
    expect(steps.binding).toBe("upcoming");
  });

  it("walks binding and API key in order after registration", () => {
    expect(statuses({ ...ready, identity: null, hasApiKey: false }).binding).toBe("current");
    expect(
      statuses({ ...ready, identity: { bindingStatus: "pending" }, hasApiKey: false }).binding,
    ).toBe("current");
    expect(statuses({ ...ready, hasApiKey: false })["api-key"]).toBe("current");
  });

  it("marks every step complete once an API key exists", () => {
    expect(new Set(Object.values(statuses(ready)))).toEqual(new Set(["complete"]));
  });
});

describe("pickOnboardingSource", () => {
  it("prefers an approved source, then a pending one, then a rejected one", () => {
    const rejected = { sourceId: "a", approvalStatus: "rejected" as const };
    const pending = { sourceId: "b", approvalStatus: "pending" as const };
    const approved = { sourceId: "c", approvalStatus: "approved" as const };

    expect(pickOnboardingSource([rejected, pending, approved])).toBe(approved);
    expect(pickOnboardingSource([rejected, pending])).toBe(pending);
    expect(pickOnboardingSource([rejected])).toBe(rejected);
    expect(pickOnboardingSource([])).toBeNull();
  });
});
