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
      approval: "upcoming",
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

  it("marks approval as waiting rather than actionable while a source is pending", () => {
    const steps = statuses({
      ...ready,
      source: { approvalStatus: "pending" },
      identity: null,
      hasApiKey: false,
    });
    expect(steps.register).toBe("complete");
    expect(steps.approval).toBe("waiting");
    expect(steps.binding).toBe("upcoming");
  });

  it("marks approval as blocked when the source was rejected", () => {
    expect(
      statuses({
        ...ready,
        source: { approvalStatus: "rejected" },
        identity: null,
        hasApiKey: false,
      }).approval,
    ).toBe("blocked");
  });

  it("walks binding and API key in order after approval", () => {
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
