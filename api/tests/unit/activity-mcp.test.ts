import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getOpenAPIMeta } from "@orpc/openapi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contract } from "@/contract";
import { ActivityMcpServer } from "@/services/activity-mcp";

const REQUEST = { origin: "https://activity.test", clientKey: "203.0.113.9" };

function server(overrides: { submit?: () => Promise<{ eventId: string }> } = {}) {
  return new ActivityMcpServer(
    {
      create: vi.fn(async () => {
        throw new Error("unused");
      }),
      claim: vi.fn(async () => ({ status: "waiting" as const })),
    },
    { getSourceForIngestion: vi.fn() },
    { submit: vi.fn(overrides.submit ?? (async () => ({ eventId: "e".repeat(64) }))) },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Activity MCP server", () => {
  it("hides unexpected failures behind a generic tool error and logs them", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await server({
      submit: async () => {
        throw new Error("database password leaked in message");
      },
    }).handle(
      {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "submit_activity_event",
          arguments: {
            apiKey: "act_x",
            eventType: "activity.test",
            actor: "alice.near",
            idempotencyKey: "k",
          },
        },
      },
      REQUEST,
    );

    expect(response).toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: "call-1",
        result: {
          content: [
            { type: "text", text: "Activity could not complete the request; try again later" },
          ],
          isError: true,
        },
      },
    });
    expect(logged).toHaveBeenCalledWith(
      "[ActivityMcp] submit_activity_event failed",
      expect.any(Error),
    );
  });

  it("defaults an omitted payload to an empty object", async () => {
    const submit = vi.fn(async () => ({ eventId: "e".repeat(64) }));
    const mcp = new ActivityMcpServer(
      { create: vi.fn(), claim: vi.fn() },
      { getSourceForIngestion: vi.fn() },
      { submit },
    );

    await mcp.handle(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "submit_activity_event",
          arguments: {
            apiKey: "act_x",
            eventType: "activity.test",
            actor: "alice.near",
            idempotencyKey: "k",
          },
        },
      },
      REQUEST,
    );

    expect(submit).toHaveBeenCalledWith("act_x", {
      eventType: "activity.test",
      actor: "alice.near",
      idempotencyKey: "k",
      payload: {},
    });
  });

  it("rejects a request id that is neither a string nor a number", async () => {
    await expect(
      server().handle({ jsonrpc: "2.0", id: { nested: true }, method: "ping" }, REQUEST),
    ).resolves.toMatchObject({ status: 200, body: { id: null, error: { code: -32600 } } });
  });

  it("keeps the UI's copyable prompt in step with the server's tools and path", async () => {
    const listed = await server().handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, REQUEST);
    const tools =
      listed.status === 200 && "result" in listed.body
        ? (listed.body.result as { tools: { name: string }[] }).tools
        : [];
    const prompt = readFileSync(
      join(import.meta.dirname, "../../../ui/src/lib/activity-mcp-prompt.ts"),
      "utf8",
    );

    expect(tools).toHaveLength(3);
    for (const { name } of tools) expect(prompt).toContain(name);
    expect(prompt).toContain(`/api${getOpenAPIMeta(contract.handleActivityMcpRequest)?.path}`);
  });

  it("keeps the key when the approved Event Types cannot be loaded", async () => {
    const mcp = new ActivityMcpServer(
      {
        create: vi.fn(),
        claim: vi.fn(async () => ({
          status: "ready" as const,
          sourceId: "s1",
          secret: "act_once",
          apiKeyId: "k1",
        })),
      },
      {
        getSourceForIngestion: vi.fn(async () => {
          throw new Error("lookup failed");
        }),
      },
      { submit: vi.fn() },
    );

    await expect(
      mcp.handle(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "check_activity_registration",
            arguments: { sessionId: "00000000-0000-4000-8000-000000000000", pollToken: "abp_x" },
          },
        },
        REQUEST,
      ),
    ).resolves.toMatchObject({
      body: {
        result: {
          structuredContent: { status: "ready", secret: "act_once", sourceId: "s1" },
        },
      },
    });
  });
});
