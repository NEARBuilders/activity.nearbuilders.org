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
        linkedAccountIds={["catalog.near"]}
        isLinkingAccount={false}
        onLinkAccount={vi.fn()}
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
        linkedAccountIds={["catalog.near"]}
        isLinkingAccount={false}
        onLinkAccount={vi.fn()}
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
  it("offers to add the source account instead of a wallet approval that cannot succeed", () => {
    const onLinkAccount = vi.fn();
    render(
      <ActivityLinkOnChainAction
        requiredAccountId="catalog.near"
        linkedAccountIds={["someone.near"]}
        isLinking={false}
        isChecking={false}
        isLinkingAccount={false}
        canCheck
        onLink={vi.fn()}
        onCheck={vi.fn()}
        onLinkAccount={onLinkAccount}
      />,
    );

    expect(screen.getByText("Add catalog.near to your profile")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve in wallet" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add catalog.near" }));
    expect(onLinkAccount).toHaveBeenCalled();
  });

  it("allows linking when the source account is any linked account, not only the primary", () => {
    render(
      <ActivityLinkOnChainAction
        requiredAccountId="catalog.near"
        linkedAccountIds={["someone.near", "catalog.near"]}
        isLinking={false}
        isChecking={false}
        isLinkingAccount={false}
        canCheck={false}
        onLink={vi.fn()}
        onCheck={vi.fn()}
        onLinkAccount={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Approve in wallet" })).toBeTruthy();
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

describe("ActivitySetupComplete first event", () => {
  it("waits for the first event, then confirms it arrived", () => {
    const props = {
      revealedSecret: "act_test_secret",
      eventType: "build.completed",
      actor: "catalog.near",
      onDismiss: vi.fn(),
    };
    const { rerender } = render(<ActivitySetupComplete {...props} firstEvent={null} />);
    expect(screen.getByText(/Waiting for your first event/)).toBeTruthy();

    rerender(
      <ActivitySetupComplete
        {...props}
        firstEvent={{ type: "build.completed", timestamp: new Date().toISOString() }}
      />,
    );
    expect(screen.getByText(/First event received/)).toBeTruthy();
    expect(screen.getByText("View in feed")).toBeTruthy();
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
