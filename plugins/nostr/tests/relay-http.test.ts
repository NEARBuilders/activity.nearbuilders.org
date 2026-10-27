import { once } from "node:events";
import { createServer } from "node:http";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RPCHandler } from "@orpc/server/node";
import { createPluginRuntime, type PluginClientType } from "every-plugin";
import { expect, it } from "vitest";
import Plugin from "../src/index";
import { activityEvent, TestRelay } from "./fixtures/relay";

it("publishes and streams signed events over HTTP without cookies or API keys", async () => {
  const relay = new TestRelay();
  await relay.start();
  const runtime = createPluginRuntime({ registry: { nostr: { module: Plugin } } });
  const plugin = await runtime.usePlugin("nostr", {
    variables: { relays: [relay.url] },
    secrets: {},
  });
  const handler = new RPCHandler(plugin.router);
  const server = createServer(async (request, response) => {
    const result = await handler.handle(request, response, {
      prefix: "/rpc",
      context: { "effect/context": plugin.initialized.effectContext },
    });
    if (!result.matched) {
      response.statusCode = 404;
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server has no address");
  const client: PluginClientType<typeof Plugin> = createORPCClient(
    new RPCLink({ origin: `http://127.0.0.1:${address.port}`, url: "/rpc" }),
  );
  const controller = new AbortController();
  try {
    const event = activityEvent(100);
    const opening = client.subscribeEvents(
      { filter: { kinds: [1701], limit: 0 } },
      { signal: controller.signal },
    );
    await expect.poll(() => relay.subscriptionCount).toBe(1);
    const published = await client.publishEvent({ event });
    expect(published.statuses[0]?.success).toBe(true);
    const stream = await opening;
    expect(await stream.next()).toMatchObject({ value: { id: event.id } });
    expect((await client.queryEvents({ filter: { ids: [event.id] } })).events).toHaveLength(1);
    const next = stream.next();
    controller.abort();
    await next.catch(() => undefined);
    await expect.poll(() => relay.subscriptionCount).toBe(0);
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.shutdown();
    await relay.stop();
  }
});
