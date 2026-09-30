// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActivityApiKeyAction,
  ActivityLinkOnChainAction,
  ActivitySetupComplete,
  buildFirstEventCommand,
} from "@/components/activity-setup-actions";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

describe("ActivityLinkOnChainAction", () => {
  it("offers one wallet approval and hides the manual check until a key exists", () => {
    const onLink = vi.fn();
    render(
      <ActivityLinkOnChainAction
        requiredAccountId="catalog.near"
        signedInAccountId="catalog.near"
        isLinking={false}
        isChecking={false}
        canCheck={false}
        onLink={onLink}
        onCheck={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve in wallet" }));
    expect(onLink).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "I already approved it" })).toBeNull();
  });

  it("tells the user it finishes on its own while linking", () => {
    render(
      <ActivityLinkOnChainAction
        requiredAccountId="catalog.near"
        signedInAccountId="catalog.near"
        isLinking
        isChecking={false}
        canCheck
        onLink={vi.fn()}
        onCheck={vi.fn()}
      />,
    );

    expect(screen.getByText(/finishes on its own/)).toBeTruthy();
  });
});

describe("ActivityLinkOnChainAction account mismatch", () => {
  it("names the required account instead of offering a wallet approval that cannot succeed", () => {
    render(
      <ActivityLinkOnChainAction
        requiredAccountId="catalog.near"
        signedInAccountId="someone.near"
        isLinking={false}
        isChecking={false}
        canCheck
        onLink={vi.fn()}
        onCheck={vi.fn()}
      />,
    );

    expect(screen.getByText("Sign in as catalog.near to continue")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve in wallet" })).toBeNull();
  });
});

describe("ActivityApiKeyAction", () => {
  it("creates a key with a sensible default name", () => {
    const onCreate = vi.fn();
    render(<ActivityApiKeyAction isSubmitting={false} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    expect(onCreate).toHaveBeenCalledWith("Production");
  });
});

describe("ActivitySetupComplete", () => {
  it("shows the new secret with a ready-to-run first event command", () => {
    render(
      <ActivitySetupComplete
        revealedSecret="act_test_secret"
        eventType="build.completed"
        actor="catalog.near"
        onDismiss={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("Your API key") as HTMLInputElement).value).toBe(
      "act_test_secret",
    );
    expect(screen.getByText(/Bearer act_test_secret/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "I saved my key" })).toBeTruthy();
  });

  it("collapses to a short notice once the secret is dismissed", () => {
    render(
      <ActivitySetupComplete
        revealedSecret={null}
        eventType="build.completed"
        actor="catalog.near"
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Setup complete")).toBeTruthy();
    expect(screen.queryByLabelText("Your API key")).toBeNull();
  });
});

describe("buildFirstEventCommand", () => {
  it("builds a request that matches the event submission contract", () => {
    const command = buildFirstEventCommand({
      apiBaseUrl: "https://activity.example/api",
      secret: "act_x",
      eventType: "build.completed",
      actor: "catalog.near",
    });

    expect(command).toContain("curl -X POST https://activity.example/api/v1/events");
    const body = JSON.parse(command.slice(command.indexOf("'") + 1, command.lastIndexOf("'")));
    expect(body).toEqual({
      eventType: "build.completed",
      actor: "catalog.near",
      idempotencyKey: "first-event",
      payload: {},
    });
  });
});
