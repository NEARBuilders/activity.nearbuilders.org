// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityOnboardingProgress } from "@/components/activity-onboarding-progress";
import {
  type ActivityOnboardingInput,
  getActivityOnboardingSteps,
} from "@/lib/activity-onboarding";

afterEach(cleanup);

const approvedSource: ActivityOnboardingInput = {
  hasNearAccount: true,
  isOrganizationOwner: true,
  source: { approvalStatus: "approved" },
  identity: null,
  hasApiKey: false,
};

describe("ActivityOnboardingProgress", () => {
  it("shows the current step, what it means, and its action in place", () => {
    render(
      <ActivityOnboardingProgress
        steps={getActivityOnboardingSteps(approvedSource)}
        nearAccountId="catalog.near"
        action={<button type="button">Approve in wallet</button>}
      />,
    );

    expect(screen.getByText("Setup · Step 5 of 6")).toBeTruthy();
    expect(screen.getByText("Link your source on-chain")).toBeTruthy();
    expect(screen.getByText(/Approve one transaction from catalog\.near/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve in wallet" })).toBeTruthy();
  });

  it("explains a rejection instead of implying the user should wait", () => {
    render(
      <ActivityOnboardingProgress
        steps={getActivityOnboardingSteps({
          ...approvedSource,
          source: { approvalStatus: "rejected" },
        })}
        nearAccountId="catalog.near"
      />,
    );

    expect(screen.getByText("Your source was rejected")).toBeTruthy();
  });

  it("hands over to the completion view once every step is done", () => {
    render(
      <ActivityOnboardingProgress
        steps={getActivityOnboardingSteps({
          ...approvedSource,
          identity: { bindingStatus: "bound" },
          hasApiKey: true,
        })}
        nearAccountId="catalog.near"
        complete={<p>All done</p>}
      />,
    );

    expect(screen.getByText("All done")).toBeTruthy();
    expect(screen.queryByLabelText("Setup progress")).toBeNull();
  });
});
