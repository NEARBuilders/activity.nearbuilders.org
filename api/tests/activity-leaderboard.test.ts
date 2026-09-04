import { describe, expect, it } from "vitest";
import {
  type ActivityPointValue,
  createInMemoryActivityLeaderboard,
} from "@/services/activity-leaderboard";

const NOW = new Date("2026-09-03T12:00:00.000Z");

function event(input: {
  id: string;
  source: string;
  type: string;
  actor: string;
  timestamp?: string;
}) {
  return {
    ...input,
    timestamp: input.timestamp ?? NOW.toISOString(),
  };
}

describe("Activity leaderboard", () => {
  it("reweights historical counts using the current source trust multiplier", async () => {
    let pointValues: ActivityPointValue[] = [
      {
        source: "feedback",
        sourceDisplayName: "Feedback rounds",
        type: "feedback.written",
        pointValue: 5,
        trustStatus: "standard",
        scoreMultiplier: 1,
      },
      {
        source: "events",
        sourceDisplayName: "Builder events",
        type: "event.attended",
        pointValue: 8,
        trustStatus: "standard",
        scoreMultiplier: 1,
      },
    ];
    const leaderboard = createInMemoryActivityLeaderboard({
      listPointValues: async () => pointValues,
      now: () => NOW,
    });

    await leaderboard.apply({
      operation: "include",
      event: event({
        id: "7".repeat(64),
        source: "feedback",
        type: "feedback.written",
        actor: "alice.near",
      }),
    });
    await leaderboard.apply({
      operation: "include",
      event: event({
        id: "8".repeat(64),
        source: "events",
        type: "event.attended",
        actor: "bob.near",
      }),
    });

    expect(
      (await leaderboard.getLeaderboard({ period: "all-time", limit: 10 })).data.map(
        ({ actor, score }) => ({ actor, score }),
      ),
    ).toEqual([
      { actor: "bob.near", score: 8 },
      { actor: "alice.near", score: 5 },
    ]);

    pointValues = pointValues.map((value) =>
      value.source === "feedback"
        ? { ...value, trustStatus: "trusted", scoreMultiplier: 2 }
        : value,
    );

    const reweighted = await leaderboard.getLeaderboard({ period: "all-time", limit: 10 });
    expect(reweighted.data.map(({ actor, score }) => ({ actor, score }))).toEqual([
      { actor: "alice.near", score: 10 },
      { actor: "bob.near", score: 8 },
    ]);
    expect(reweighted.data[0]?.breakdown).toEqual([
      {
        source: "feedback",
        sourceDisplayName: "Feedback rounds",
        type: "feedback.written",
        pointValue: 5,
        trustStatus: "trusted",
        scoreMultiplier: 2,
        eventCount: 1,
        score: 10,
      },
    ]);
  });

  it("reweights historical counts using current Event Type point values", async () => {
    let pointValues: ActivityPointValue[] = [
      { source: "feedback", type: "feedback.written", pointValue: 5 },
      { source: "events", type: "event.attended", pointValue: 10 },
    ];
    const leaderboard = createInMemoryActivityLeaderboard({
      listPointValues: async () => pointValues,
      now: () => NOW,
    });

    await leaderboard.apply({
      operation: "include",
      event: event({
        id: "a".repeat(64),
        source: "feedback",
        type: "feedback.written",
        actor: "alice.near",
      }),
    });
    await leaderboard.apply({
      operation: "include",
      event: event({
        id: "b".repeat(64),
        source: "feedback",
        type: "feedback.written",
        actor: "alice.near",
      }),
    });
    await leaderboard.apply({
      operation: "include",
      event: event({
        id: "c".repeat(64),
        source: "events",
        type: "event.attended",
        actor: "bob.near",
      }),
    });

    const initial = await leaderboard.getLeaderboard({ period: "all-time", limit: 10 });
    expect(
      initial.data.map(({ actor, score, eventCount }) => ({ actor, score, eventCount })),
    ).toEqual([
      { actor: "alice.near", score: 10, eventCount: 2 },
      { actor: "bob.near", score: 10, eventCount: 1 },
    ]);

    pointValues = [
      { source: "feedback", type: "feedback.written", pointValue: 2 },
      { source: "events", type: "event.attended", pointValue: 20 },
    ];

    const reweighted = await leaderboard.getLeaderboard({ period: "all-time", limit: 10 });
    expect(
      reweighted.data.map(({ actor, score, eventCount }) => ({ actor, score, eventCount })),
    ).toEqual([
      { actor: "bob.near", score: 20, eventCount: 1 },
      { actor: "alice.near", score: 4, eventCount: 2 },
    ]);
    expect(reweighted.data[0]?.breakdown).toEqual([
      {
        source: "events",
        sourceDisplayName: "events",
        type: "event.attended",
        trustStatus: "standard",
        scoreMultiplier: 1,
        pointValue: 20,
        eventCount: 1,
        score: 20,
      },
    ]);
  });

  it("uses UTC calendar periods and never reapplies an excluded event", async () => {
    const leaderboard = createInMemoryActivityLeaderboard({
      listPointValues: async () => [
        { source: "feedback", type: "feedback.written", pointValue: 5 },
      ],
      now: () => NOW,
    });
    const previousMonth = event({
      id: "d".repeat(64),
      source: "feedback",
      type: "feedback.written",
      actor: "alice.near",
      timestamp: "2026-08-30T23:59:59.000Z",
    });
    const currentWeek = event({
      id: "e".repeat(64),
      source: "feedback",
      type: "feedback.written",
      actor: "bob.near",
      timestamp: "2026-09-01T00:00:00.000Z",
    });
    const hidden = event({
      id: "f".repeat(64),
      source: "feedback",
      type: "feedback.written",
      actor: "carol.near",
      timestamp: "2026-09-02T00:00:00.000Z",
    });

    expect(await leaderboard.apply({ operation: "include", event: previousMonth })).toBe(true);
    expect(await leaderboard.apply({ operation: "include", event: currentWeek })).toBe(true);
    expect(await leaderboard.apply({ operation: "include", event: currentWeek })).toBe(false);
    expect(await leaderboard.apply({ operation: "include", event: hidden })).toBe(true);
    expect(await leaderboard.apply({ operation: "exclude", event: hidden })).toBe(true);
    expect(await leaderboard.apply({ operation: "exclude", event: hidden })).toBe(false);
    expect(await leaderboard.apply({ operation: "include", event: hidden })).toBe(false);

    const weekly = await leaderboard.getLeaderboard({ period: "weekly", limit: 10 });
    expect(weekly).toMatchObject({
      startsAt: "2026-08-31T00:00:00.000Z",
      endsAt: "2026-09-07T00:00:00.000Z",
      data: [{ actor: "bob.near", score: 5, eventCount: 1 }],
    });

    const monthly = await leaderboard.getLeaderboard({ period: "monthly", limit: 10 });
    expect(monthly).toMatchObject({
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-10-01T00:00:00.000Z",
      data: [{ actor: "bob.near", score: 5, eventCount: 1 }],
    });

    const allTime = await leaderboard.getLeaderboard({ period: "all-time", limit: 10 });
    expect(allTime).toMatchObject({
      startsAt: null,
      endsAt: null,
      data: [
        { actor: "alice.near", score: 5, eventCount: 1 },
        { actor: "bob.near", score: 5, eventCount: 1 },
      ],
    });
  });

  it("rebuilds from trusted history without resurrecting hidden events", async () => {
    const leaderboard = createInMemoryActivityLeaderboard({
      listPointValues: async () => [
        { source: "feedback", type: "feedback.written", pointValue: 5 },
      ],
      now: () => NOW,
    });
    const stale = event({
      id: "1".repeat(64),
      source: "feedback",
      type: "feedback.written",
      actor: "stale.near",
    });
    const visible = event({
      id: "2".repeat(64),
      source: "feedback",
      type: "feedback.written",
      actor: "visible.near",
    });
    const hidden = event({
      id: "3".repeat(64),
      source: "feedback",
      type: "feedback.written",
      actor: "hidden.near",
    });
    await leaderboard.apply({ operation: "include", event: stale });

    const rebuilt = await leaderboard.rebuild({
      events: [visible, hidden, visible],
      hiddenEvents: [hidden],
    });

    expect(rebuilt).toEqual({ seen: 3, applied: 1, hidden: 1 });
    expect(await leaderboard.getStatus()).toEqual({
      state: "ready",
      rebuiltAt: NOW.toISOString(),
      seen: 3,
      applied: 1,
      hidden: 1,
    });
    expect(await leaderboard.apply({ operation: "include", event: hidden })).toBe(false);
    expect(await leaderboard.getLeaderboard({ period: "all-time", limit: 10 })).toMatchObject({
      projection: { state: "ready", rebuiltAt: NOW.toISOString() },
      data: [{ actor: "visible.near", eventCount: 1, score: 5 }],
    });
  });
});
