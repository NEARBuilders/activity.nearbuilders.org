import { createServer } from "node:http";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { RPCHandler } from "@orpc/server/node";
import { createPluginRuntime } from "every-plugin";
import { type Filter, matchFilters } from "nostr-tools/filter";
import type { Event } from "nostr-tools/pure";
import { type WebSocket, WebSocketServer } from "ws";
import type { contract } from "@/contract";
import Plugin from "@/index";
import type { ActivityCredentialsService } from "@/services/activity-credentials";
import pluginDevConfig from "../plugin.dev";

const TEST_PLUGIN_ID = pluginDevConfig.pluginId;
const TEST_CONFIG = pluginDevConfig.config;

const TEST_REGISTRY = {
  [TEST_PLUGIN_ID]: {
    module: Plugin,
    description: "API integration test runtime",
  },
} as const;

export const runtime = createPluginRuntime({
  registry: TEST_REGISTRY,
  secrets: {},
});

let server: ReturnType<typeof createServer> | null = null;
let baseUrl = "";
let activityCredentialsService: ActivityCredentialsService | null = null;
let relayServer: WebSocketServer | null = null;
let relayUrl = "";
const relayEvents: Event[] = [];
const relaySubscriptions = new Map<WebSocket, Map<string, Filter[]>>();
let dropNextRelayAcknowledgement = false;

async function ensureTestRelay(): Promise<string> {
  if (relayServer) return relayUrl;
  relayServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  relayServer.on("connection", (socket) => {
    relaySubscriptions.set(socket, new Map());
    socket.on("close", () => relaySubscriptions.delete(socket));
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as unknown[];
      if (message[0] === "REQ" && typeof message[1] === "string") {
        const subscriptionId = message[1];
        const filters = message.slice(2) as Filter[];
        relaySubscriptions.get(socket)?.set(subscriptionId, filters);
        const uniqueEvents = [...new Map(relayEvents.map((event) => [event.id, event])).values()];
        for (const event of uniqueEvents.filter((candidate) => matchFilters(filters, candidate))) {
          socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
        }
        socket.send(JSON.stringify(["EOSE", subscriptionId]));
        return;
      }
      if (message[0] === "EVENT" && isEventMessage(message)) {
        relayEvents.push(message[1]);
        if (dropNextRelayAcknowledgement) {
          dropNextRelayAcknowledgement = false;
          socket.close();
          return;
        }
        socket.send(JSON.stringify(["OK", message[1].id, true, "stored"]));
        for (const [subscriber, subscriptions] of relaySubscriptions) {
          for (const [subscriptionId, filters] of subscriptions) {
            if (matchFilters(filters, message[1])) {
              subscriber.send(JSON.stringify(["EVENT", subscriptionId, message[1]]));
            }
          }
        }
        return;
      }
      if (message[0] === "CLOSE" && typeof message[1] === "string") {
        relaySubscriptions.get(socket)?.delete(message[1]);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    relayServer?.once("listening", resolve);
    relayServer?.once("error", reject);
  });
  const address = relayServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Test relay did not bind to a TCP port");
  }
  relayUrl = `ws://127.0.0.1:${address.port}`;
  return relayUrl;
}

function isEventMessage(message: unknown[]): message is ["EVENT", Event] {
  return message.length >= 2 && typeof message[1] === "object" && message[1] !== null;
}

export function getTestRelayEvents(): readonly Event[] {
  return relayEvents;
}

export function resetTestRelayEvents(): void {
  relayEvents.length = 0;
}

export function getTestRelaySubscriptionCount(): number {
  return [...relaySubscriptions.values()].reduce(
    (count, subscriptions) => count + subscriptions.size,
    0,
  );
}

export function loseNextTestRelayAcknowledgement(): void {
  dropNextRelayAcknowledgement = true;
}

export async function getPluginClient(
  context?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  if (!server) {
    const activityRelayUrl = await ensureTestRelay();
    const config = {
      ...TEST_CONFIG,
      variables: { ...TEST_CONFIG.variables, activityRelayUrl },
    } as typeof TEST_CONFIG;
    const { router, initialized } = await runtime.usePlugin(TEST_PLUGIN_ID, config);
    activityCredentialsService = initialized.context.activityCredentials;
    const rpcHandler = new RPCHandler(router);
    const openApiHandler = new OpenAPIHandler(router);

    // Find an available port
    server = createServer(async (req, res) => {
      const url = new URL(req.url!, baseUrl);

      if (url.pathname.startsWith("/rpc")) {
        // Initialize empty context for each request to prevent closure capture
        let requestContext: Record<string, unknown> = {
          reqHeaders: new Headers(req.headers as Record<string, string>),
        };

        // Allow overriding context via headers for flexibility
        if (req.headers["x-test-context"]) {
          requestContext = {
            ...requestContext,
            ...JSON.parse(req.headers["x-test-context"] as string),
          };
        }

        const result = await rpcHandler.handle(req, res, {
          prefix: "/rpc",
          context: requestContext,
        });
        if (result.matched) return;
      }

      if (url.pathname.startsWith("/v1")) {
        const result = await openApiHandler.handle(req, res, {
          context: {
            reqHeaders: new Headers(req.headers as Record<string, string>),
          },
        });
        if (result.matched) return;
      }

      res.statusCode = 404;
      res.end("Route not found");
    });

    await new Promise<void>((resolve, reject) => {
      server?.listen(0, "127.0.0.1", () => resolve());
      server?.on("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind to a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  const link = new RPCLink({
    url: `${baseUrl}/rpc`,
    fetch: globalThis.fetch,
    headers: {
      ...headers,
      ...(context ? { "x-test-context": JSON.stringify(context) } : {}),
    },
  });

  const client: ContractRouterClient<typeof contract> = createORPCClient(link);
  return client;
}

export async function getPluginBaseUrl(): Promise<string> {
  await getPluginClient();
  return baseUrl;
}

export async function getActivitySourcesService() {
  const { initialized } = await runtime.usePlugin(TEST_PLUGIN_ID, TEST_CONFIG);
  return initialized.context.activitySources;
}

export async function getActivityCredentialsService() {
  if (!activityCredentialsService) await getPluginClient();
  if (!activityCredentialsService) throw new Error("Activity credentials service is unavailable");
  return activityCredentialsService;
}

export function authedContext(userId = "user-1"): Record<string, unknown> {
  return {
    userId,
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: "Test User",
    },
  };
}

export function orgContext(
  userId = "user-1",
  activeOrganizationId = "org-1",
): Record<string, unknown> {
  return {
    ...authedContext(userId),
    organization: {
      activeOrganizationId,
      organization: {
        id: activeOrganizationId,
        slug: activeOrganizationId,
        metadata: null,
      },
    },
  };
}

export function orgOwnerContext(
  userId = "owner-1",
  activeOrganizationId = "org-owner-1",
  nearAccountId: string | null = `${userId}.near`,
): Record<string, unknown> {
  return {
    ...orgContext(userId, activeOrganizationId),
    near: {
      primaryAccountId: nearAccountId,
      linkedAccounts: nearAccountId
        ? [
            {
              accountId: nearAccountId,
              network: "mainnet",
              publicKey: `ed25519:${"1".repeat(64)}`,
              isPrimary: true,
            },
          ]
        : [],
      hasNearAccount: nearAccountId !== null,
    },
    organization: {
      activeOrganizationId,
      member: { id: `member-${userId}`, role: "owner" },
      organization: {
        id: activeOrganizationId,
        slug: activeOrganizationId,
        metadata: null,
      },
    },
  };
}

export function orgMemberContext(
  userId = "member-1",
  activeOrganizationId = "org-1",
): Record<string, unknown> {
  return {
    ...authedContext(userId),
    near: {
      primaryAccountId: `${userId}.near`,
      linkedAccounts: [
        {
          accountId: `${userId}.near`,
          network: "mainnet",
          publicKey: `ed25519:${"1".repeat(64)}`,
          isPrimary: true,
        },
      ],
      hasNearAccount: true,
    },
    organization: {
      activeOrganizationId,
      member: { id: `member-${userId}`, role: "member" },
      organization: {
        id: activeOrganizationId,
        slug: activeOrganizationId,
        metadata: null,
      },
    },
  };
}

export function adminContext(userId = "platform-admin-1"): Record<string, unknown> {
  return {
    ...authedContext(userId),
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: "Platform Administrator",
      role: "admin",
    },
  };
}

export async function teardown() {
  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
    server = null;
  }
  await runtime.shutdown();
  if (relayServer) {
    await new Promise<void>((resolve) => relayServer?.close(() => resolve()));
    relayServer = null;
  }
}
