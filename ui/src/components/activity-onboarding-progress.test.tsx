// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

    expect(screen.getByText("Setup · Step 2 of 3")).toBeTruthy();
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

  it("restarts at the register step for another source and can be cancelled", () => {
    const onCancel = vi.fn();
    render(
      <ActivityOnboardingProgress
        steps={getActivityOnboardingSteps({ ...approvedSource, source: null })}
        nearAccountId={null}
        title="Register another source"
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Setup · Step 1 of 3")).toBeTruthy();
    expect(screen.getByText("Register another source")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows only Info, Link on-chain, and API key, while still guiding a missing NEAR wallet", () => {
    render(
      <ActivityOnboardingProgress
        steps={getActivityOnboardingSteps({
          ...approvedSource,
          hasNearAccount: false,
          isOrganizationOwner: false,
          source: null,
        })}
        nearAccountId={null}
      />,
    );

    expect(screen.getByText("Setup · Step 1 of 3")).toBeTruthy();
    expect(screen.getByText("Connect your NEAR wallet")).toBeTruthy();
    expect(screen.getAllByText("Info").length).toBeGreaterThan(0);
    expect(screen.queryByText("Connect NEAR")).toBeNull();
    expect(screen.queryByText("Organization")).toBeNull();
  });

  it("lets a registered source go back and edit its info", () => {
    const onEditStep = vi.fn();
    const { rerender } = render(
      <ActivityOnboardingProgress
        steps={getActivityOnboardingSteps(approvedSource)}
        nearAccountId="catalog.near"
        onEditStep={onEditStep}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit info" })[0]);
    expect(onEditStep).toHaveBeenCalledWith("register");

    rerender(
      <ActivityOnboardingProgress
        steps={getActivityOnboardingSteps(approvedSource)}
        nearAccountId="catalog.near"
        onEditStep={onEditStep}
        editingStepId="register"
        action={<p>Edit form</p>}
      />,
    );

    expect(screen.getByText("Setup · Step 1 of 3")).toBeTruthy();
    expect(screen.getByText("Edit your source info")).toBeTruthy();
    expect(screen.getByText("Edit form")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit info" })).toBeNull();
  });
});
