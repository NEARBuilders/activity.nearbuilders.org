// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivitySourceRegistration } from "@/components/activity-source-registration";

afterEach(cleanup);

describe("ActivitySourceRegistration", () => {
  it("renders the supplied action alongside a blocker so the page is never a dead end", () => {
    render(
      <ActivitySourceRegistration
        access="organization-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        registrationAction={<button type="button">Create an organization</button>}
      />,
    );

    expect(screen.getByText("Select an active organization")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create an organization" })).toBeTruthy();
  });

  it("explains that a NEAR account signs an on-chain transaction", () => {
    render(
      <ActivitySourceRegistration
        access="near-required"
        isSubmitting={false}
        onCreate={vi.fn()}
        registrationAction={<button type="button">Connect NEAR wallet</button>}
      />,
    );

    expect(screen.getByText(/one on-chain transaction/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect NEAR wallet" })).toBeTruthy();
  });

  it("tells an owner that members cannot register sources", () => {
    render(
      <ActivitySourceRegistration
        access="owner-required"
        isSubmitting={false}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText(/Members cannot register sources/)).toBeTruthy();
  });

  it("documents the permanent fields and the meaning of a zero point value", () => {
    render(<ActivitySourceRegistration access="allowed" isSubmitting={false} onCreate={vi.fn()} />);

    expect(screen.getByText(/It cannot be changed later/)).toBeTruthy();
    expect(screen.getByText(/exact mainnet account that will sign the binding/)).toBeTruthy();
    expect(screen.getByText(/0 means events of this type score nothing/)).toBeTruthy();
    expect(screen.getByText(/returns a 400/)).toBeTruthy();
  });
});
