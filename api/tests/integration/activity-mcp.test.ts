import { afterAll, describe, expect, it } from "vitest";
import { getPluginBaseUrl, getPluginClient, orgOwnerContext, teardown } from "../setup";
import { linkSourceOnChain } from "./activity-test-helpers";

afterAll(teardown);

const eventTypes = [
  { name: "mcp.task.completed", description: "A task was completed", enabled: true, pointValue: 4 },
];

let requestId = 0;

async function post(message: unknown, headers: Record<string, string> = {}) {
  return fetch(`${await getPluginBaseUrl()}/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(message),
  });
}

async function rpc(method: string, params?: unknown, headers?: Record<string, string>) {
  requestId += 1;
  const response = await post({ jsonrpc: "2.0", id: requestId, method, params }, headers);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^application\/json/);
  const body = (await response.json()) as {
    id: number;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
  expect(body.id).toBe(requestId);
  return body;
}

async function callTool(name: string, args: unknown, headers?: Record<string, string>) {
  const { result } = await rpc("tools/call", { name, arguments: args }, headers);
  return result as {
    structuredContent?: Record<string, unknown>;
    content: { type: string; text: string }[];
    isError?: boolean;
  };
}

describe("Activity MCP server", () => {
  it("negotiates the protocol and lists the registration tools", async () => {
    await expect(
      rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-agent", version: "1.0.0" },
      }),
    ).resolves.toMatchObject({
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "activity.nearbuilders.org" },
      },
    });
    await expect(rpc("initialize", { protocolVersion: "1999-01-01" })).resolves.toMatchObject({
      result: { protocolVersion: "2025-06-18" },
    });

    const initialized = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(initialized.status).toBe(202);
    expect(await initialized.text()).toBe("");

    const { result } = await rpc("tools/list");
    const tools = result?.tools as { name: string; inputSchema: { type: string } }[];
    expect(tools.map(({ name }) => name)).toEqual([
      "start_activity_registration",
      "check_activity_registration",
      "submit_activity_event",
    ]);
    expect(tools.every(({ inputSchema }) => inputSchema.type === "object")).toBe(true);
    const published = JSON.stringify(tools.map(({ inputSchema }) => inputSchema));
    expect(published).not.toContain("$schema");
    expect(published).not.toContain("$ref");
    await expect(rpc("ping")).resolves.toMatchObject({ result: {} });
  });

  it("registers a source through a binding session and hands the key over exactly once", async () => {
    const started = await callTool(
      "start_activity_registration",
      { sourceId: "mcp-project", displayName: "MCP Project", eventTypes },
      { "x-forwarded-for": "203.0.113.61" },
    );
    expect(started.isError).toBeUndefined();
    const session = started.structuredContent as {
      sessionId: string;
      pollToken: string;
      url: string;
      matchCode: string;
    };
    expect(session.matchCode).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(JSON.parse(started.content[0]?.text ?? "{}")).toEqual(session);
    const sessionToken = new URL(session.url).searchParams.get("sessionToken");
    if (!sessionToken) throw new Error("Binding session URL has no session token");

    const check = { sessionId: session.sessionId, pollToken: session.pollToken };
    await expect(callTool("check_activity_registration", check)).resolves.toMatchObject({
      structuredContent: { status: "waiting" },
    });
    await expect(
      callTool("check_activity_registration", { ...check, pollToken: "abp_wrong" }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: "NOT_FOUND: Binding session not found" }],
    });

    const owner = await getPluginClient(
      orgOwnerContext("mcp-binding-owner", "org-mcp-binding", "mcp-binding-owner.near"),
    );
    await owner.createActivitySource({
      sourceId: "mcp-project",
      displayName: "MCP Project",
      nearAccountId: "mcp-binding-owner.near",
      eventTypes,
    });
    await linkSourceOnChain(owner, "mcp-project");
    await owner.completeActivityBindingSession({ sessionToken, sourceId: "mcp-project" });

    const ready = await callTool("check_activity_registration", check);
    expect(ready.structuredContent).toMatchObject({
      status: "ready",
      sourceId: "mcp-project",
      secret: expect.stringMatching(/^act_/),
    });
    await expect(callTool("check_activity_registration", check)).resolves.toMatchObject({
      structuredContent: { status: "claimed", sourceId: "mcp-project" },
    });

    const apiKey = String(ready.structuredContent?.secret);
    await expect(
      callTool("submit_activity_event", {
        apiKey,
        eventType: "activity.test",
        actor: "mcp-binding-owner.near",
        idempotencyKey: "mcp:test",
      }),
    ).resolves.toMatchObject({
      structuredContent: { eventId: expect.stringMatching(/^[a-f0-9]{64}$/), test: true },
    });
    await expect(
      callTool("submit_activity_event", {
        apiKey,
        eventType: "mcp.task.completed",
        actor: "mcp-binding-owner.near",
        idempotencyKey: "mcp:first",
        payload: { task: "integrate" },
      }),
    ).resolves.toMatchObject({
      structuredContent: { eventId: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
  });

  it("reports tool failures as tool errors and bad requests as JSON-RPC errors", async () => {
    await expect(
      callTool("submit_activity_event", {
        apiKey: "act_unknown",
        eventType: "activity.test",
        actor: "alice.near",
        idempotencyKey: "mcp:unknown-key",
      }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringMatching(/^UNAUTHORIZED: /) }],
    });

    await expect(
      rpc("tools/call", { name: "submit_activity_event", arguments: { apiKey: "act_x" } }),
    ).resolves.toMatchObject({
      error: { code: -32602, message: expect.stringContaining("eventType") },
    });
    await expect(
      rpc("tools/call", {
        name: "check_activity_registration",
        arguments: { sessionId: "7VQ-9SP", pollToken: "abp_x" },
      }),
    ).resolves.toMatchObject({
      error: { code: -32602, message: expect.stringContaining("sessionId") },
    });
    await expect(rpc("tools/call", { name: "delete_everything" })).resolves.toMatchObject({
      error: { code: -32602, message: "Unknown tool: delete_everything" },
    });
    await expect(rpc("resources/list")).resolves.toMatchObject({
      error: { code: -32601, message: "Method not found: resources/list" },
    });

    const invalid = await post({ id: 1, method: "ping" });
    expect(await invalid.json()).toMatchObject({ id: null, error: { code: -32600 } });
    const batch = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(await batch.json()).toMatchObject({ error: { code: -32600 } });
    const clientResponse = await post({ jsonrpc: "2.0", id: 9, result: {} });
    expect(clientResponse.status).toBe(202);
    const empty = await post({ jsonrpc: "2.0", id: 10 });
    expect(await empty.json()).toMatchObject({ error: { code: -32600 } });
  });

  it("answers a stream request with 405", async () => {
    const response = await fetch(`${await getPluginBaseUrl()}/v1/mcp`, {
      headers: { accept: "text/event-stream" },
    });
    expect(response.status).toBe(405);
  });
});
