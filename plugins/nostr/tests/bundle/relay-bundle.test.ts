import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createPluginRuntime, type PluginClientType } from "every-plugin";
import { expect, it } from "vitest";
import type Plugin from "../../src/index";
import { activityEvent, TestRelay } from "../fixtures/relay";

it("loads the built remote and publishes, reads and streams through its bundled WebSocket client", async () => {
  const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
  const server = createServer(async (request, response) => {
    const name = request.url?.slice(1) ?? "";
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(`${dist}${name}`);
      response.setHeader(
        "Content-Type",
        name.endsWith(".json") ? "application/json" : "application/javascript",
      );
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No artifact server address");
  const relay = new TestRelay();
  await relay.start();
  const runtime = createPluginRuntime({
    registry: {
      "@every-plugin/nostr": { remote: `http://127.0.0.1:${address.port}/mf-manifest.json` },
    },
  });
  const controller = new AbortController();
  try {
    const plugin = await runtime.usePlugin("@every-plugin/nostr", {
      variables: { relays: [relay.url] },
      secrets: {},
    });
    const client: PluginClientType<typeof Plugin> = plugin.createClient();
    const stream = await client.subscribeEvents(
      { filter: { kinds: [1701], limit: 0 } },
      { signal: controller.signal },
    );
    const next = stream.next();
    await expect.poll(() => relay.subscriptionCount).toBe(1);
    const event = activityEvent(1);
    expect((await client.publishEvent({ event })).statuses[0]?.success).toBe(true);
    expect(await next).toMatchObject({ value: { id: event.id } });
    expect((await client.queryEvents({ filter: { ids: [event.id] } })).events).toHaveLength(1);
    controller.abort();
    await stream.return(undefined);
  } finally {
    controller.abort();
    await runtime.shutdown();
    await relay.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 20_000);
