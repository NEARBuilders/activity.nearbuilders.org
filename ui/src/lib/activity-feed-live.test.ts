import { describe, expect, it } from "vitest";
import { mergeLiveActivityEvent } from "@/lib/activity-feed-live";

const event = (id: string, sequence: number) => ({
  id: id.repeat(64),
  source: "feedback-rounds",
  type: "feedback.submitted",
  actor: "alice.near",
  idempotencyKey: `feedback:${sequence}`,
  timestamp: `2026-09-03T01:46:${String(sequence).padStart(2, "0")}.000Z`,
  payload: { sequence },
});

describe("mergeLiveActivityEvent", () => {
  it("prepends a live event without duplicating existing events or growing the page", () => {
    const current = [event("b", 2), event("a", 1)];

    expect(mergeLiveActivityEvent(current, event("c", 3), 2)).toEqual([
      event("c", 3),
      event("b", 2),
    ]);
    expect(mergeLiveActivityEvent(current, event("b", 2), 2)).toEqual(current);
  });
});
