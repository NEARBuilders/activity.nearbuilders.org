// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActivityBindingKeyReveal,
  buildAgentPrompt,
  buildConnectionTestCommand,
} from "@/components/activity-binding-key-reveal";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

afterEach(cleanup);

const secret = "act_super_secret_value";
const baseProps = {
  sourceId: "proptix",
  actor: "owner.near",
  eventTypes: [{ name: "listing.published", pointValue: 10 }],
  apiBaseUrl: "https://activity.nearbuilders.org/api",
  siteUrl: "https://activity.nearbuilders.org",
  isRevealing: false,
  connectionWorks: false,
  onReveal: vi.fn(),
};

describe("ActivityBindingKeyReveal", () => {
  it("keeps the key out of the test command and the agent prompt", () => {
    const command = buildConnectionTestCommand({
      apiBaseUrl: baseProps.apiBaseUrl,
      actor: "owner.near",
    });
    const prompt = buildAgentPrompt({
      siteUrl: baseProps.siteUrl,
      sourceId: "proptix",
      eventTypes: baseProps.eventTypes,
    });

    expect(command).toContain("$ACTIVITY_API_KEY");
    expect(command).toContain('"eventType":"activity.test"');
    expect(prompt).toContain("ACTIVITY_API_KEY environment variable");
    expect(prompt).toContain("listing.published (10 points)");

    render(<ActivityBindingKeyReveal {...baseProps} status="ready" secret={secret} />);

    const blocks = Array.from(document.querySelectorAll("pre")).map((block) => block.textContent);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) expect(block).not.toContain(secret);
    expect((screen.getByLabelText("Your API key") as HTMLInputElement).value).toBe(secret);
  });

  it("asks before revealing the key, and reports a key that was already shown", () => {
    const onReveal = vi.fn();
    const { rerender } = render(
      <ActivityBindingKeyReveal {...baseProps} status="ready" secret={null} onReveal={onReveal} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show my API key" }));
    expect(onReveal).toHaveBeenCalledOnce();

    rerender(<ActivityBindingKeyReveal {...baseProps} status="claimed" secret={null} />);
    expect(screen.getByText("Your API key was already shown")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show my API key" })).toBeNull();
  });

  it("switches to Connection works once the test event arrives", () => {
    const { rerender } = render(
      <ActivityBindingKeyReveal {...baseProps} status="ready" secret={secret} />,
    );
    expect(screen.getByText("Waiting for the test event")).toBeTruthy();

    rerender(
      <ActivityBindingKeyReveal {...baseProps} status="ready" secret={secret} connectionWorks />,
    );
    expect(screen.getByText("Connection works")).toBeTruthy();
  });
});
