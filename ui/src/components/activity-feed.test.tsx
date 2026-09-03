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
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(event.timestamp);
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
});
