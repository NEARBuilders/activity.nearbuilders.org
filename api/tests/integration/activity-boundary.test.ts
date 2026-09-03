import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVITY_EVENT_KIND,
  ActivityBoundary,
  signActivityEvent,
} from "@/activity/activity-boundary";
import {
  type ActivityLeaderboard,
  createRedisActivityLeaderboard,
} from "@/services/activity-leaderboard";

const SECRET_KEY = "0000000000000000000000000000000000000000000000000000000000000001";
const execFileAsync = promisify(execFile);

function eventData({ id, pubkey, created_at, kind, tags, content, sig }: NostrEvent) {
  return { id, pubkey, created_at, kind, tags, content, sig };
}

const activityDescribe = process.env.ACTIVITY_INTEGRATION === "1" ? describe : describe.skip;

async function retryWhileRelayStarts<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
  }
  throw lastError;
}

activityDescribe("Activity Nostr boundary", () => {
  let boundary: ActivityBoundary | undefined;
  let leaderboard: ActivityLeaderboard | undefined;

  afterEach(async () => {
    await boundary?.close();
    await leaderboard?.close();
  });

  it("publishes and queries a signed Activity event by relay-indexed fields", async () => {
    boundary = await ActivityBoundary.connect({
      relayUrl: process.env.ACTIVITY_RELAY_URL ?? "ws://127.0.0.1:7447",
      redisUrl: process.env.ACTIVITY_REDIS_URL ?? "redis://127.0.0.1:6379",
    });
    const idempotencyKey = `github:pr:${randomUUID()}`;
    const event = signActivityEvent(
      {
        source: "github.nearbuilders.org",
        eventType: "github.pr.merged",
        actor: "alice.near",
        idempotencyKey,
        payload: { repository: "NEARBuilders/example", number: 42 },
      },
      SECRET_KEY,
    );

    const acknowledgement = await boundary.publish(event);
    const result = await boundary.query({
      source: "github.nearbuilders.org",
      eventType: "github.pr.merged",
      actor: "alice.near",
      idempotencyKey,
    });

    expect(acknowledgement).toEqual({ accepted: true, message: "" });
    expect(event.kind).toBe(ACTIVITY_EVENT_KIND);
    expect(event.tags).toEqual([
      ["s", "github.nearbuilders.org"],
      ["t", "github.pr.merged"],
      ["n", "alice.near"],
      ["i", idempotencyKey],
    ]);
    expect(result.events.map(eventData)).toEqual([eventData(event)]);
  });

  it("paginates equal-timestamp events deterministically by descending event id", async () => {
    boundary = await ActivityBoundary.connect({
      relayUrl: process.env.ACTIVITY_RELAY_URL ?? "ws://127.0.0.1:7447",
      redisUrl: process.env.ACTIVITY_REDIS_URL ?? "redis://127.0.0.1:6379",
    });
    const source = `cursor-test:${randomUUID()}`;
    const createdAt = Math.floor(Date.now() / 1_000);
    const events = ["first", "second", "third"].map((label) =>
      signActivityEvent(
        {
          source,
          eventType: "test.cursor",
          actor: "cursor.near",
          idempotencyKey: `${source}:${label}`,
          payload: { label },
          createdAt,
        },
        SECRET_KEY,
      ),
    );
    await Promise.all(events.map((event) => boundary?.publish(event)));

    const firstPage = await boundary.query({ source, limit: 2 });
    const repeatedFirstPage = await boundary.query({ source, limit: 2 });
    const secondPage = await boundary.query({ source, limit: 2, cursor: firstPage.nextCursor });
    const expectedIds = events.map(({ id }) => id).sort((left, right) => right.localeCompare(left));

    expect(firstPage.events.map(({ id }) => id)).toEqual(expectedIds.slice(0, 2));
    expect(repeatedFirstPage.events.map(({ id }) => id)).toEqual(expectedIds.slice(0, 2));
    expect(secondPage.events.map(({ id }) => id)).toEqual(expectedIds.slice(2));
    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.nextCursor).toBeNull();
  });

  it("resubscribes after the local relay restarts", async () => {
    boundary = await ActivityBoundary.connect({
      relayUrl: process.env.ACTIVITY_RELAY_URL ?? "ws://127.0.0.1:7447",
      redisUrl: process.env.ACTIVITY_REDIS_URL ?? "redis://127.0.0.1:6379",
    });
    const source = `subscription-test:${randomUUID()}`;
    const received: NostrEvent[] = [];
    let receiveNext: (() => void) | undefined;
    const subscription = boundary.subscribe({ source }, (event) => {
      received.push(event);
      receiveNext?.();
    });
    const firstReceived = new Promise<void>((resolveEvent) => {
      receiveNext = resolveEvent;
    });
    const createdAt = Math.floor(Date.now() / 1_000);
    const first = signActivityEvent(
      {
        source,
        eventType: "test.subscription",
        actor: "subscriber.near",
        idempotencyKey: `${source}:first`,
        payload: { sequence: 1 },
        createdAt,
      },
      SECRET_KEY,
    );
    await boundary.publish(first);
    await firstReceived;

    await execFileAsync("docker", [
      "compose",
      "-f",
      resolve(process.cwd(), "../compose.activity.yml"),
      "restart",
      "activity-relay",
    ]);
    const second = signActivityEvent(
      {
        source,
        eventType: "test.subscription",
        actor: "subscriber.near",
        idempotencyKey: `${source}:second`,
        payload: { sequence: 2 },
        createdAt: createdAt + 1,
      },
      SECRET_KEY,
    );
    const publisher = await ActivityBoundary.connect({
      relayUrl: process.env.ACTIVITY_RELAY_URL ?? "ws://127.0.0.1:7447",
      redisUrl: process.env.ACTIVITY_REDIS_URL ?? "redis://127.0.0.1:6379",
    });
    const secondReceived = new Promise<void>((resolveEvent) => {
      receiveNext = resolveEvent;
    });
    await retryWhileRelayStarts(() => publisher.publish(second));
    await publisher.close();

    await Promise.race([
      secondReceived,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Subscription did not reconnect")), 15_000),
      ),
    ]);
    subscription.close();

    expect(received.map(({ id }) => id)).toEqual([first.id, second.id]);
  }, 20_000);

  it("replays relay history into Redis without double counting", async () => {
    boundary = await ActivityBoundary.connect({
      relayUrl: process.env.ACTIVITY_RELAY_URL ?? "ws://127.0.0.1:7447",
      redisUrl: process.env.ACTIVITY_REDIS_URL ?? "redis://127.0.0.1:6379",
    });
    const source = `replay-test:${randomUUID()}`;
    const actor = `${randomUUID()}.near`;
    const inputs = [
      { idempotencyKey: `${source}:one`, payload: { sequence: 1 } },
      { idempotencyKey: `${source}:one`, payload: { sequence: "duplicate" } },
      { idempotencyKey: `${source}:two`, payload: { sequence: 2 } },
    ];
    const events = inputs.map((input, index) =>
      signActivityEvent(
        {
          source,
          eventType: "test.projected",
          actor,
          idempotencyKey: input.idempotencyKey,
          payload: input.payload,
          createdAt: Math.floor(Date.now() / 1_000) - index,
        },
        SECRET_KEY,
      ),
    );
    const otherSource = `replay-test:${randomUUID()}`;
    const otherSourceEvent = signActivityEvent(
      {
        source: otherSource,
        eventType: "test.projected",
        actor,
        idempotencyKey: `${source}:one`,
        payload: { sequence: "other-source" },
      },
      SECRET_KEY,
    );
    await Promise.all([...events, otherSourceEvent].map((event) => boundary?.publish(event)));

    const firstReplay = await boundary.replay({ source });
    const secondReplay = await boundary.replay({ source });
    const otherSourceReplay = await boundary.replay({ source: otherSource });
    const projectedCount = await boundary.getProjectionCount({
      source,
      actor,
      eventType: "test.projected",
    });
    const otherSourceProjectedCount = await boundary.getProjectionCount({
      source: otherSource,
      actor,
      eventType: "test.projected",
    });

    expect(firstReplay).toEqual({ seen: 3, applied: 2 });
    expect(secondReplay).toEqual({ seen: 3, applied: 0 });
    expect(otherSourceReplay).toEqual({ seen: 1, applied: 1 });
    expect(projectedCount).toBe(2);
    expect(otherSourceProjectedCount).toBe(1);
  });

  it("stores exact dynamic leaderboard counts and exclusions in Redis", async () => {
    let pointValue = 5;
    leaderboard = await createRedisActivityLeaderboard({
      redisUrl: process.env.ACTIVITY_REDIS_URL ?? "redis://127.0.0.1:6379",
      namespace: `activity:test:${randomUUID()}`,
      listPointValues: async () => [{ source: "feedback", type: "feedback.written", pointValue }],
      now: () => new Date("2026-09-03T12:00:00.000Z"),
    });
    await leaderboard.rebuild({ events: [], hiddenEvents: [] });
    const projectedEvent = {
      id: "1".repeat(64),
      source: "feedback",
      type: "feedback.written",
      actor: "alice.near",
      timestamp: "2026-09-02T12:00:00.000Z",
    };

    expect(await leaderboard.apply({ operation: "include", event: projectedEvent })).toBe(true);
    expect(await leaderboard.apply({ operation: "include", event: projectedEvent })).toBe(false);
    expect(await leaderboard.getLeaderboard({ period: "weekly", limit: 10 })).toMatchObject({
      data: [{ actor: "alice.near", eventCount: 1, score: 5 }],
    });

    pointValue = 12;
    expect(await leaderboard.getLeaderboard({ period: "weekly", limit: 10 })).toMatchObject({
      data: [{ actor: "alice.near", eventCount: 1, score: 12 }],
    });

    expect(await leaderboard.apply({ operation: "exclude", event: projectedEvent })).toBe(true);
    expect(await leaderboard.apply({ operation: "exclude", event: projectedEvent })).toBe(false);
    expect(await leaderboard.apply({ operation: "include", event: projectedEvent })).toBe(false);
    expect(await leaderboard.getLeaderboard({ period: "weekly", limit: 10 })).toMatchObject({
      data: [],
    });
  });
});
