import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { describe, expect, it } from "vitest";
import { contract } from "@/contract";

type Operation = {
  operationId?: string;
  parameters?: Array<{ schema?: unknown }>;
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { content?: Record<string, unknown> }>;
};

function findRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) findRefs(item, refs);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") refs.push(child);
      else findRefs(child, refs);
    }
  }
  return refs;
}

function streamsEvents(operation: Operation): boolean {
  return Object.values(operation.responses ?? {}).some(
    (response) => response.content !== undefined && "text/event-stream" in response.content,
  );
}

describe("OpenAPI spec as host MCP tools", () => {
  it("gives every tool operation a self-contained input schema", async () => {
    const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });
    const spec = await generator.generate(contract, {
      version: "3.1.1",
      base: { info: { title: "activity", version: "1.0.0" } },
    });

    const unresolvable: Record<string, string[]> = {};
    for (const methods of Object.values(spec.paths ?? {})) {
      for (const operation of Object.values(methods as Record<string, Operation>)) {
        if (!operation.operationId) continue;
        if (streamsEvents(operation)) continue;
        const refs = findRefs([
          operation.parameters?.map((parameter) => parameter.schema),
          operation.requestBody?.content?.["application/json"]?.schema,
        ]);
        if (refs.length > 0) unresolvable[operation.operationId] = refs;
      }
    }

    expect(unresolvable).toEqual({});
  });
});
