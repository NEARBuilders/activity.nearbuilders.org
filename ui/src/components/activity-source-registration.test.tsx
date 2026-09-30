// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText(/Each NEAR account can own only one source/)).toBeTruthy();
    expect(screen.getByText(/0 scores nothing/)).toBeTruthy();
    expect(screen.getByText(/rejected with a 400/)).toBeTruthy();
  });

  it("flags an invalid Source ID as it is typed and blocks submission", () => {
    const onCreate = vi.fn();
    render(
      <ActivitySourceRegistration access="allowed" isSubmitting={false} onCreate={onCreate} />,
    );

    fireEvent.change(screen.getByLabelText("Source ID"), { target: { value: "Near Catalog" } });

    expect(screen.getByRole("alert").textContent).toMatch(/lowercase letters and numbers/);
  });

  it("shows a conflict under the field it belongs to", async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValue(
        new Error("The NEAR account catalog.near already owns an Activity Source"),
      );
    render(
      <ActivitySourceRegistration
        access="allowed"
        isSubmitting={false}
        onCreate={onCreate}
        defaultNearAccountId="catalog.near"
      />,
    );

    fireEvent.change(screen.getByLabelText("Source ID"), { target: { value: "near-catalog" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "NEAR Catalog" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "catalog.published" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Published" } });
    fireEvent.submit(screen.getByRole("button", { name: "Register source" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "The NEAR account catalog.near already owns an Activity Source",
      ),
    );
  });
});
