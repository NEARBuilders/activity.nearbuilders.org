// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Organization } from "@/app";
import { OrgSwitcher } from "@/components/org-switcher";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

afterEach(cleanup);

const organizations = [
  {
    id: "org-current",
    name: "Current workspace",
    slug: "current-workspace",
    logo: null,
    metadata: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  },
  {
    id: "org-next",
    name: "Next workspace",
    slug: "next-workspace",
    logo: null,
    metadata: null,
    createdAt: new Date("2026-09-02T00:00:00.000Z"),
  },
] satisfies Organization[];

describe("OrgSwitcher", () => {
  it("shows the active workspace and delegates a new selection", async () => {
    const onSwitch = vi.fn().mockResolvedValue(undefined);
    render(
      <OrgSwitcher organizations={organizations} activeOrgId="org-current" onSwitch={onSwitch} />,
    );

    expect(screen.getByRole("button", { name: /Current workspace/ })).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: /Current workspace/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Next workspace" }));

    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("org-next"));
  });

  it("does not switch when the active workspace is selected again", async () => {
    const onSwitch = vi.fn();
    render(
      <OrgSwitcher organizations={organizations} activeOrgId="org-current" onSwitch={onSwitch} />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /Current workspace/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Current workspace" }));

    await waitFor(() => expect(onSwitch).not.toHaveBeenCalled());
  });
});
