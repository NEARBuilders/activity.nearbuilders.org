import { createPluginRuntime, type PluginClientType } from "every-plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Plugin from "../src/index";
import { NostrVariablesSchema, resolveNostrConfig } from "../src/lib/nostr-config";
import { activityEvent, TestRelay } from "./fixtures/relay";

const rawFilter = {
  kinds: [1701],
  tags: [
    { tag: "s", values: ["source"] },
    { tag: "t", values: ["test.completed"] },
    { tag: "n", values: ["alice.near"] },
  ],
};

it("reports publishing failure when the configured relay cannot be reached", async () => {
  const relay = new TestRelay();
  await relay.start();
  const relayUrl = relay.url;
  await relay.stop();
  const runtime = createPluginRuntime({ registry: { nostr: { module: Plugin } } });
  try {
    const plugin = await runtime.usePlugin("nostr", {
      variables: { relays: [relayUrl] },
      secrets: {},
    });
    const result = await plugin.createClient().publishEvent({ event: activityEvent(500) });
    expect(result.statuses).toEqual([{ relay: relayUrl, success: false }]);
  } finally {
    await runtime.shutdown();
  }
});

describe("Nostr relay operations through the plugin runtime", () => {
  let relay: TestRelay;
  let runtime: ReturnType<typeof createPluginRuntime>;
  let client: PluginClientType<typeof Plugin>;
  let stopped = false;
  const controllers: AbortController[] = [];

  beforeEach(async () => {
    stopped = false;
    relay = new TestRelay();
    await relay.start();
    runtime = createPluginRuntime({ registry: { nostr: { module: Plugin } } });
    const plugin = await runtime.usePlugin("nostr", {
      variables: { relays: [relay.url] },
      secrets: {},
    });
    client = plugin.createClient();
  });

  afterEach(async () => {
    for (const controller of controllers.splice(0)) controller.abort();
    if (!stopped) await runtime?.shutdown();
    await relay.stop();
  });

  it("publishes a source-signed event without a user session or API key and reads it by all Activity tags", async () => {
    const event = activityEvent(1);
    expect(await client.listRelays()).toEqual({ relays: [relay.url] });
    const result = await client.publishEvent({ event });
    expect(result).toEqual({ eventId: event.id, statuses: [{ relay: relay.url, success: true }] });
    await client.publishEvent({ event });
    const read = await client.queryEvents({
      filter: { ...rawFilter, tags: [...rawFilter.tags, { tag: "i", values: ["test:1"] }] },
    });
    expect(read.events.map((entry) => entry.id)).toEqual([event.id]);
    expect(read.meta.limited).toBe(false);
    expect(relay.events.size).toBe(1);
    expect((await client.queryEvents({ filter: { kinds: [1] } })).events).toEqual([]);
  });

  it("rejects forged signatures and unconfigured relay destinations", async () => {
    const event = activityEvent(2);
    await expect(
      client.publishEvent({ event: { ...event, content: "forged" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.publishEvent({ event, relays: ["ws://127.0.0.1:1"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.queryEvents({ filter: {}, relays: ["ws://127.0.0.1:1"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(relay.events.size).toBe(0);
  });

  it("retains user authentication for comments and binding challenges", async () => {
    await expect(client.createChallenge({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      client.createComment({ event: activityEvent(1), target: "test" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns a negative relay acknowledgement without claiming a publish succeeded", async () => {
    relay.rejectPublish = true;
    const result = await client.publishEvent({ event: activityEvent(3) });
    expect(result.statuses).toEqual([{ relay: relay.url, success: false }]);
    expect(relay.events.size).toBe(0);
  });

  it("rejects incomplete reads after a relay disconnect instead of returning partial events", async () => {
    relay.events.set("fixture", activityEvent(4));
    relay.queryMode = "close";
    await expect(client.queryEvents({ filter: rawFilter })).rejects.toMatchObject({
      code: "RELAY_UNAVAILABLE",
    });
  });

  it("times out a relay that never sends EOSE", async () => {
    relay.queryMode = "stall";
    await expect(client.queryEvents({ filter: rawFilter })).rejects.toMatchObject({
      code: "RELAY_TIMEOUT",
    });
  }, 10_000);

  it("supports 1,000-event scans and reports when the result reaches the limit", async () => {
    const now = Math.floor(Date.now() / 1_000);
    for (let i = 0; i < 1001; i++) {
      const event = activityEvent(i, now);
      relay.events.set(event.id, event);
    }
    const result = await client.queryEvents({ filter: { kinds: [1701], limit: 1000, until: now } });
    expect(result.events).toHaveLength(1000);
    expect(result.meta.limited).toBe(true);
    expect(result.events.map((event) => event.id)).toEqual(
      [...relay.events.keys()].sort().slice(0, 1000),
    );
  }, 15_000);

  it("streams filtered live events and releases subscriptions on abort", async () => {
    const controller = new AbortController();
    controllers.push(controller);
    const stream = await client.subscribeEvents(
      { filter: { ...rawFilter, limit: 0 } },
      { signal: controller.signal },
    );
    const pending = stream.next();
    await expect.poll(() => relay.subscriptionCount).toBe(1);
    const event = activityEvent(5);
    relay.emit(event);
    expect(await pending).toMatchObject({ done: false, value: { id: event.id } });
    const cancelled = stream.next();
    controller.abort();
    await cancelled.catch(() => undefined);
    await expect.poll(() => relay.subscriptionCount).toBe(0);
  });

  it("reconnects and replays missed events without redelivering earlier event IDs", async () => {
    const controller = new AbortController();
    controllers.push(controller);
    const stream = await client.subscribeEvents(
      { filter: rawFilter },
      { signal: controller.signal },
    );
    const firstRead = stream.next();
    await expect.poll(() => relay.subscriptionCount).toBe(1);
    const first = activityEvent(6);
    relay.emit(first);
    expect(await firstRead).toMatchObject({ done: false, value: { id: first.id } });
    await relay.stop();
    const missed = activityEvent(7, first.created_at);
    relay.events.set(missed.id, missed);
    await relay.start();
    const nextRead = stream.next();
    expect(await nextRead).toMatchObject({ done: false, value: { id: missed.id } });
    const afterReconnect = activityEvent(8);
    const lastRead = stream.next();
    relay.emit(first);
    relay.emit(afterReconnect);
    expect(await lastRead).toMatchObject({ done: false, value: { id: afterReconnect.id } });
    controller.abort();
    await stream.return(undefined);
  }, 10_000);

  it("reports an explicit relay authentication rejection", async () => {
    relay.queryMode = "reject";
    const stream = await client.subscribeEvents({ filter: rawFilter });
    await expect(stream.next()).rejects.toMatchObject({ code: "RELAY_UNAVAILABLE" });
  });

  it("deduplicates results from multiple relays and fails if any selected relay closes early", async () => {
    const secondRelay = new TestRelay();
    await secondRelay.start();
    const secondRuntime = createPluginRuntime({ registry: { nostr: { module: Plugin } } });
    try {
      const plugin = await secondRuntime.usePlugin("nostr", {
        variables: { relays: [relay.url, secondRelay.url] },
        secrets: {},
      });
      const multi = plugin.createClient();
      const event = activityEvent(40);
      expect((await multi.publishEvent({ event })).statuses.every((status) => status.success)).toBe(
        true,
      );
      expect((await multi.queryEvents({ filter: rawFilter })).events).toHaveLength(1);
      secondRelay.queryMode = "close";
      await expect(multi.queryEvents({ filter: rawFilter })).rejects.toMatchObject({
        code: "RELAY_UNAVAILABLE",
      });
    } finally {
      await secondRuntime.shutdown();
      await secondRelay.stop();
    }
  });

  it("does not deliver events excluded by source, type or actor filters", async () => {
    const event = activityEvent(41);
    await client.publishEvent({ event });
    for (const tag of ["s", "t", "n", "i"]) {
      expect(
        (
          await client.queryEvents({
            filter: { kinds: [1701], tags: [{ tag, values: ["nonmatching"] }] },
          })
        ).events,
      ).toEqual([]);
    }
  });

  it("does not move the replay boundary to a future-dated event timestamp", async () => {
    const controller = new AbortController();
    controllers.push(controller);
    const stream = await client.subscribeEvents(
      { filter: rawFilter },
      { signal: controller.signal },
    );
    const pending = stream.next();
    await expect.poll(() => relay.subscriptionCount).toBe(1);
    const future = activityEvent(30, Math.floor(Date.now() / 1000) + 3600);
    relay.emit(future);
    expect(await pending).toMatchObject({ value: { id: future.id } });
    await relay.stop();
    const missed = activityEvent(31);
    relay.events.set(missed.id, missed);
    await relay.start();
    expect(await stream.next()).toMatchObject({ value: { id: missed.id } });
    controller.abort();
    await stream.return(undefined);
  }, 10_000);

  it("fails visibly when subscription replay reaches its bound", async () => {
    const event = activityEvent(32);
    relay.events.set(event.id, event);
    const stream = await client.subscribeEvents({
      filter: { kinds: [1701], since: event.created_at, limit: 1 },
    });
    await expect(stream.next()).rejects.toMatchObject({ code: "RELAY_LIMIT" });
    await expect.poll(() => relay.subscriptionCount).toBe(0);
  });

  it("cancels a pending query and closes its subscription", async () => {
    relay.queryMode = "stall";
    const controller = new AbortController();
    controllers.push(controller);
    const query = client.queryEvents({ filter: rawFilter }, { signal: controller.signal });
    const failed = expect(query).rejects.toBeDefined();
    await expect.poll(() => relay.subscriptionCount).toBe(1);
    controller.abort();
    await failed;
    await expect.poll(() => relay.subscriptionCount).toBe(0);
  });

  it("honors zero-history reads without reporting a truncated result", async () => {
    const event = activityEvent(33);
    relay.events.set(event.id, event);
    expect(await client.queryEvents({ filter: { kinds: [1701], limit: 0 } })).toEqual({
      events: [],
      meta: { limited: false },
    });
  });

  it("shutdown closes an active stream and its sockets", async () => {
    const stream = await client.subscribeEvents({ filter: rawFilter });
    const pending = stream.next();
    await expect.poll(() => relay.subscriptionCount).toBe(1);
    await runtime.shutdown();
    stopped = true;
    expect((await pending).done).toBe(true);
    await expect.poll(() => relay.server.clients.size).toBe(0);
  });
});

describe("effective relay configuration", () => {
  it("preserves explicit STANDARD_RELAYS overrides and reports the actual pool", () => {
    const config = resolveNostrConfig(
      NostrVariablesSchema.parse({
        relays: ["wss://other.example"],
        STANDARD_RELAYS: "wss://configured.example,wss://configured.example",
      }),
      {},
    );
    expect(config.relays).toEqual(["wss://configured.example"]);
    expect(config.standardRelays).toEqual(config.relays);
  });
});
