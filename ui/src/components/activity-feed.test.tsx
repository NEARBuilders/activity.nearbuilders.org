// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityFeed, type ActivityFeedEventView } from "@/components/activity-feed";

afterEach(cleanup);

const event: ActivityFeedEventView = {
  id: "a".repeat(64),
  source: "feedback-rounds",
  type: "feedback.submitted",
  actor: "alice.near",
  idempotencyKey: "feedback:round-1:alice",
  timestamp: "2026-09-03T01:46:40.000Z",
  payload: { rating: 5, note: "Useful feedback" },
  provenance: {
    signatureVerified: true,
    publicKey: "b".repeat(64),
    signingIdentityStatus: "active",
    sourceDisplayName: "Feedback rounds",
    integration: null,
    trustStatus: "trusted",
    scoreMultiplier: 1.5,
    payloadClaimsVerified: false,
  },
};

describe("ActivityFeed", () => {
  it("presents Activity event identity, time, and payload", () => {
    const { container } = render(
      <ActivityFeed
        events={[event]}
        status="success"
        skippedInvalid={0}
        hasMore={false}
        onApplyFilters={vi.fn()}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("alice.near")).toBeTruthy();
    expect(screen.getByText("feedback.submitted")).toBeTruthy();
    expect(screen.getByText(/feedback-rounds/)).toBeTruthy();
    expect(screen.getByText(/Useful feedback/)).toBeTruthy();
    expect(screen.getByText("Feedback rounds")).toBeTruthy();
    expect(screen.getByText("Verified signature")).toBeTruthy();
    expect(screen.getByText("Trusted · 1.5×")).toBeTruthy();
    expect(screen.getByText(/claims are not independently verified/i)).toBeTruthy();
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(event.timestamp);
  });

  it("labels GitHub-ingested events in the normal Activity feed", () => {
    render(
      <ActivityFeed
        events={[
          {
            ...event,
            type: "github.pr.merged",
            provenance: { ...event.provenance, integration: "github" },
          },
        ]}
        status="success"
        skippedInvalid={0}
        hasMore={false}
        onApplyFilters={vi.fn()}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("github.pr.merged")).toBeTruthy();
  });

  it("does not label ordinary sources that use a GitHub-prefixed event type", () => {
    render(
      <ActivityFeed
        events={[{ ...event, type: "github.pr.merged" }]}
        status="success"
        skippedInvalid={0}
        hasMore={false}
        onApplyFilters={vi.fn()}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("applies source, type, and actor filters", () => {
    const onApplyFilters = vi.fn();
    render(
      <ActivityFeed
        events={[]}
        status="success"
        skippedInvalid={0}
        hasMore={false}
        onApplyFilters={onApplyFilters}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Activity Source"), {
      target: { value: "feedback-rounds" },
    });
    fireEvent.change(screen.getByLabelText("Event type"), {
      target: { value: "feedback.submitted" },
    });
    fireEvent.change(screen.getByLabelText("NEAR actor"), { target: { value: "alice.near" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(onApplyFilters).toHaveBeenCalledWith({
      source: "feedback-rounds",
      type: "feedback.submitted",
      actor: "alice.near",
    });
  });

  it("exposes accessible loading, empty, partial, and error states", () => {
    const { rerender } = render(
      <ActivityFeed
        events={[]}
        status="loading"
        skippedInvalid={0}
        hasMore={false}
        onApplyFilters={vi.fn()}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Loading Activity events");

    rerender(
      <ActivityFeed
        events={[]}
        status="success"
        skippedInvalid={0}
        hasMore={false}
        onApplyFilters={vi.fn()}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("No Activity events found")).toBeTruthy();

    rerender(
      <ActivityFeed
        events={[event]}
        status="success"
        skippedInvalid={2}
        hasMore={false}
        onApplyFilters={vi.fn()}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("2 invalid relay events were omitted");

    const onRetry = vi.fn();
    rerender(
      <ActivityFeed
        events={[]}
        status="error"
        errorMessage="Activity relay query timed out"
        skippedInvalid={0}
        hasMore={false}
        onApplyFilters={vi.fn()}
        onNextPage={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Activity relay query timed out");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("requests the next page only when one is available", () => {
    const onNextPage = vi.fn();
    render(
      <ActivityFeed
        events={[event]}
        status="success"
        skippedInvalid={0}
        hasMore
        onApplyFilters={vi.fn()}
        onNextPage={onNextPage}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onNextPage).toHaveBeenCalledOnce();
  });

  it("shows endorsement count and current-user state without downvote language", () => {
    const onToggleEndorsement = vi.fn();
    const { rerender } = render(
      <ActivityFeed
        events={[event]}
        status="success"
        skippedInvalid={0}
        hasMore={false}
        endorsements={{
          [event.id]: { totalCount: 1, endorsedByCurrentUser: true },
        }}
        canEndorse
        onApplyFilters={vi.fn()}
        onToggleEndorsement={onToggleEndorsement}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const endorsed = screen.getByRole("button", { name: "Endorsed" });
    expect(endorsed.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 endorsement")).toBeTruthy();
    fireEvent.click(endorsed);
    expect(onToggleEndorsement).toHaveBeenCalledWith(event.id);
    expect(screen.queryByText(/downvote/i)).toBeNull();

    rerender(
      <ActivityFeed
        events={[event]}
        status="success"
        skippedInvalid={0}
        hasMore={false}
        endorsements={{
          [event.id]: { totalCount: 2, endorsedByCurrentUser: false },
        }}
        canEndorse
        onApplyFilters={vi.fn()}
        onToggleEndorsement={onToggleEndorsement}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Endorse" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByText("2 endorsements")).toBeTruthy();
  });

  it("requires sign-in before the endorsement action is available", () => {
    render(
      <ActivityFeed
        events={[event]}
        status="success"
        skippedInvalid={0}
        hasMore={false}
        onApplyFilters={vi.fn()}
        onNextPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Endorse" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toBe("Sign in to endorse Activity events");
  });
});
