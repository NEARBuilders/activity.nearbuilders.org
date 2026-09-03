// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityLeaderboard } from "@/components/activity-leaderboard";

afterEach(cleanup);

describe("ActivityLeaderboard", () => {
  it("renders exact rankings and changes the selected period", () => {
    const onPeriodChange = vi.fn();
    render(
      <ActivityLeaderboard
        period="weekly"
        status="success"
        result={{
          period: "weekly",
          startsAt: "2026-08-31T00:00:00.000Z",
          endsAt: "2026-09-07T00:00:00.000Z",
          generatedAt: "2026-09-03T12:00:00.000Z",
          projection: {
            state: "ready",
            rebuiltAt: "2026-09-03T11:00:00.000Z",
            seen: 3,
            applied: 3,
            hidden: 0,
          },
          data: [
            {
              rank: 1,
              actor: "alice.near",
              score: 25,
              eventCount: 4,
              breakdown: [
                {
                  source: "feedback",
                  type: "feedback.written",
                  pointValue: 5,
                  eventCount: 3,
                  score: 15,
                },
                {
                  source: "events",
                  type: "event.attended",
                  pointValue: 10,
                  eventCount: 1,
                  score: 10,
                },
              ],
            },
          ],
        }}
        onPeriodChange={onPeriodChange}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Leaderboard" })).toBeTruthy();
    expect(screen.getByText("alice.near")).toBeTruthy();
    expect(screen.getByText("25 points")).toBeTruthy();
    expect(screen.getByText("4 events")).toBeTruthy();
    expect(screen.getByText(/feedback\.written/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(onPeriodChange).toHaveBeenCalledWith("monthly");
  });

  it("presents loading, empty, and retryable error states", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <ActivityLeaderboard
        period="weekly"
        status="loading"
        onPeriodChange={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Loading leaderboard");

    rerender(
      <ActivityLeaderboard
        period="weekly"
        status="success"
        result={{
          period: "weekly",
          startsAt: "2026-08-31T00:00:00.000Z",
          endsAt: "2026-09-07T00:00:00.000Z",
          generatedAt: "2026-09-03T12:00:00.000Z",
          projection: {
            state: "ready",
            rebuiltAt: null,
            seen: 0,
            applied: 0,
            hidden: 0,
          },
          data: [],
        }}
        onPeriodChange={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("No ranked activity yet")).toBeTruthy();

    rerender(
      <ActivityLeaderboard
        period="weekly"
        status="error"
        errorMessage="Redis is unavailable"
        onPeriodChange={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Redis is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
