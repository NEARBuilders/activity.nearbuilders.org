import { ORPCError } from "@orpc/server";
import { Predicate } from "effect";
import { z } from "zod";
import { ActivityBindingDraftSchema, ActivityEventSubmissionSchema } from "../contract";
import type { ActivityBindingSessionsService } from "./activity-binding-sessions";
import type { ActivityIngestionService } from "./activity-ingestion";
import type { ActivitySourcesService } from "./activity-sources";

const ACTIVITY_MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const ACTIVITY_MCP_SERVER_VERSION = "1.0.0";

const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;

const CheckRegistrationSchema = z.object({
  sessionId: z.uuid(),
  pollToken: z.string().trim().min(1).max(200),
});

const SubmitEventSchema = ActivityEventSubmissionSchema.extend({
  apiKey: z.string().trim().min(1).max(200),
  payload: z.unknown().optional().describe("Any JSON value, up to 16 KiB; defaults to {}"),
});

type JsonRpcId = string | number | null;

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

type ActivityMcpResponse = { status: 202 } | { status: 200; body: JsonRpcResponse };

type ActivityMcpRequestContext = { origin: string; clientKey: string | null };

type ActivityMcpTool = {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (args: unknown, request: ActivityMcpRequestContext) => Promise<unknown>;
};

function defineTool<Schema extends z.ZodType>(tool: {
  name: string;
  description: string;
  schema: Schema;
  call: (input: z.output<Schema>, request: ActivityMcpRequestContext) => Promise<unknown>;
}): ActivityMcpTool {
  return {
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    run: (args, request) => {
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) {
        throw new JsonRpcError(
          JSON_RPC_INVALID_PARAMS,
          `Invalid arguments for ${tool.name}: ${z.prettifyError(parsed.error)}`,
        );
      }
      return tool.call(parsed.data, request);
    },
  };
}

class JsonRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export class ActivityMcpServer {
  readonly #tools: ReadonlyMap<string, ActivityMcpTool>;

  constructor(
    bindingSessions: Pick<ActivityBindingSessionsService, "create" | "claim">,
    sources: Pick<ActivitySourcesService, "getSourceForIngestion">,
    ingestion: Pick<ActivityIngestionService, "submit">,
  ) {
    const tools = [
      defineTool({
        name: "start_activity_registration",
        description:
          "Start registering this project as an Activity Source. Send the nearbuilders.org project reference and the proposed Event Types. Show the returned url and matchCode to the person: they open the link, sign in with their NEAR wallet, check the match code, and approve one transaction. Keep sessionId and pollToken private, then call check_activity_registration every 5 seconds.",
        schema: ActivityBindingDraftSchema,
        call: (draft, request) => bindingSessions.create(draft, request.origin, request.clientKey),
      }),
      defineTool({
        name: "check_activity_registration",
        description:
          "Check a registration started with start_activity_registration. Status waiting: call again in 5 seconds. Status ready: the response holds the Source API Key (secret) and sourceId exactly once; store the key as the ACTIVITY_API_KEY server-side secret and never print it. Ready and claimed also list the Event Types the person approved, which may differ from the proposal; report only those. Status expired: start again.",
        schema: CheckRegistrationSchema,
        call: async ({ sessionId, pollToken }) => {
          const claim = await bindingSessions.claim(sessionId, pollToken);
          if (claim.status !== "ready" && claim.status !== "claimed") return claim;
          const eventTypes = await sources
            .getSourceForIngestion(claim.sourceId)
            .then((source) => source.eventTypes)
            .catch(() => undefined);
          return eventTypes ? { ...claim, eventTypes } : claim;
        },
      }),
      defineTool({
        name: "submit_activity_event",
        description:
          "Submit one Activity event with the source's API key and return its eventId. Use eventType activity.test to check the connection: it is accepted for every source and never published or scored. Set occurredAt to import a past event. Production code should call POST /api/v1/events directly instead.",
        schema: SubmitEventSchema,
        call: ({ apiKey, payload, ...event }) =>
          ingestion.submit(apiKey, { ...event, payload: payload ?? {} }),
      }),
    ];
    this.#tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  async handle(message: unknown, request: ActivityMcpRequestContext): Promise<ActivityMcpResponse> {
    if (!Predicate.isObject(message) || message.jsonrpc !== "2.0") {
      return errorResponse(null, JSON_RPC_INVALID_REQUEST, "Expected one JSON-RPC 2.0 message");
    }
    if (typeof message.method !== "string") {
      return "method" in message || !("result" in message || "error" in message)
        ? errorResponse(null, JSON_RPC_INVALID_REQUEST, "Expected a JSON-RPC request or response")
        : { status: 202 };
    }
    if (!("id" in message)) return { status: 202 };
    const id = toJsonRpcId(message.id);
    if (id === undefined) {
      return errorResponse(null, JSON_RPC_INVALID_REQUEST, "Request id must be a string or number");
    }
    try {
      const result = await this.#dispatch(message.method, message.params, request);
      return { status: 200, body: { jsonrpc: "2.0", id, result } };
    } catch (error) {
      if (error instanceof JsonRpcError) return errorResponse(id, error.code, error.message);
      throw error;
    }
  }

  async #dispatch(
    method: string,
    params: unknown,
    request: ActivityMcpRequestContext,
  ): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.#initialize(params);
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: [...this.#tools.values()].map(({ name, description, schema }) => ({
            name,
            description,
            inputSchema: publishedSchema(schema),
          })),
        };
      case "tools/call":
        return this.#callTool(params, request);
      default:
        throw new JsonRpcError(JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  #initialize(params: unknown) {
    const requested = Predicate.isObject(params) ? params.protocolVersion : undefined;
    const protocolVersion = ACTIVITY_MCP_PROTOCOL_VERSIONS.find((version) => version === requested);
    return {
      protocolVersion: protocolVersion ?? ACTIVITY_MCP_PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "activity.nearbuilders.org", version: ACTIVITY_MCP_SERVER_VERSION },
      instructions:
        "Register a project as an Activity Source and report events. Call start_activity_registration, show the person the link and match code, poll check_activity_registration until it returns the Source API Key, store the key as a server-side secret, then confirm the connection with submit_activity_event and eventType activity.test. Full guide: /skill.md",
    };
  }

  async #callTool(params: unknown, request: ActivityMcpRequestContext) {
    const name = Predicate.isObject(params) ? params.name : undefined;
    const tool = typeof name === "string" ? this.#tools.get(name) : undefined;
    if (!tool) {
      throw new JsonRpcError(JSON_RPC_INVALID_PARAMS, `Unknown tool: ${String(name)}`);
    }
    try {
      const result = await tool.run(
        Predicate.isObject(params) ? (params.arguments ?? {}) : {},
        request,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error) {
      if (error instanceof JsonRpcError) throw error;
      if (error instanceof ORPCError) return toolError(`${error.code}: ${error.message}`);
      console.error(`[ActivityMcp] ${tool.name} failed`, error);
      return toolError("Activity could not complete the request; try again later");
    }
  }
}

function publishedSchema(schema: z.ZodType) {
  const { $schema: _, ...inputSchema } = z.toJSONSchema(schema, { io: "input" });
  return inputSchema;
}

function toolError(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

function errorResponse(id: JsonRpcId, code: number, message: string): ActivityMcpResponse {
  return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

function toJsonRpcId(value: unknown): JsonRpcId | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}
