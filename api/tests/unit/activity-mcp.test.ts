import { afterEach, describe, expect, it, vi } from "vitest";
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
    const mcp = new ActivityMcpServer({ create: vi.fn(), claim: vi.fn() }, { submit });

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
});
