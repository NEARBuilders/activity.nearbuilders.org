import { getOpenAPIMeta } from "@orpc/openapi";
import { afterAll, describe, expect, it } from "vitest";
import { contract } from "@/contract";
import { getPluginBaseUrl, getPluginClient, orgOwnerContext, teardown } from "../setup";
import { readSseEventFrame, withTestTimeout } from "./activity-stream-test-helpers";
import { provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

const PUBLIC_ROUTES = [
  "GET /v1/events",
  "POST /v1/events",
  "GET /v1/events/stream",
  "POST /v1/events/endorsements",
  "POST /v1/events/{eventId}/endorsement",
  "DELETE /v1/events/{eventId}/endorsement",
  "POST /v1/events/{eventId}/retract",
  "POST /v1/binding-sessions",
  "POST /v1/binding-sessions/{sessionId}/claim",
  "GET /v1/projects/{projectId}/activity",
  "GET /v1/leaderboard",
  "GET /v1/leaderboard/status",
  "GET /v1/health",
  "POST /internal/activity/events/stream",
  "GET /internal/activity/events/endorsements/stream",
];

function contractRoutes(): string[] {
  return Object.values(contract).map((procedure) => {
    const meta = getOpenAPIMeta(procedure);
    return `${meta?.method ?? "POST"} ${meta?.path}`;
  });
}

describe("Activity v1 consumer surface", () => {
  it("keeps every public /v1 and internal stream route at its published method and path", () => {
    expect(contractRoutes()).toEqual(expect.arrayContaining(PUBLIC_ROUTES));
  });

  it("serves the detailed SSE response with event-stream headers and stable ids", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "surface-sse-source",
      ownerId: "surface-sse-owner",
      organizationId: "org-surface-sse",
      eventType: "surface.recorded",
    });
    const response = await withTestTimeout(
      fetch(`${await getPluginBaseUrl()}/v1/events/stream?source=surface-sse-source`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    try {
      const submitted = await withTestTimeout(
        fetch(`${await getPluginBaseUrl()}/v1/events`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({
            eventType: "surface.recorded",
            actor: "surface.near",
            idempotencyKey: "surface:sse",
            payload: { step: 1 },
          }),
        }),
      );
      expect(submitted.status).toBe(200);
      const { eventId } = (await submitted.json()) as { eventId: string };
      const frame = await readSseEventFrame(reader!);
      expect(frame).toMatch(new RegExp(`^id:\\s*${eventId}$`, "m"));
      expect(frame).toContain('"step":1');
    } finally {
      await reader?.cancel();
    }
  });

  it("delivers no events for an unusable Last-Event-ID on the public SSE route", async () => {
    const outcome = await withTestTimeout(
      fetch(`${await getPluginBaseUrl()}/v1/events/stream?source=surface-sse-source`, {
        headers: { "last-event-id": "not-an-event-id" },
      }).then(
        async (response) => response.text().catch(() => ""),
        () => "",
      ),
    );
    expect(outcome).not.toMatch(/^id:/m);
  });

  it("accepts a Bearer act_ Source API Key on POST /v1/events and rejects missing or unknown keys", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "surface-key-source",
      ownerId: "surface-key-owner",
      organizationId: "org-surface-key",
      eventType: "surface.keyed",
    });
    expect(secret).toMatch(/^act_/);
    const base = await getPluginBaseUrl();
    const submit = (authorization?: string) =>
      fetch(`${base}/v1/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({
          eventType: "surface.keyed",
          actor: "surface.near",
          idempotencyKey: `surface:key:${authorization ?? "none"}`,
          payload: {},
        }),
      });

    expect((await submit()).status).toBe(401);
    expect((await submit(`Bearer act_${"0".repeat(40)}`)).status).toBe(401);
    expect((await submit(`Bearer ${secret}`)).status).toBe(200);
  });

  it("gates binding-session claims on the poll token", async () => {
    const agent = await getPluginClient();
    const session = await agent.createActivityBindingSession({
      project: { title: "Surface Project" },
      sourceId: "surface-binding",
      displayName: "Surface Project",
      eventTypes: [
        { name: "surface.bound", description: "Surface binding", enabled: true, pointValue: 1 },
      ],
    });
    expect(session.pollToken).toMatch(/^abp_/);
    const base = await getPluginBaseUrl();
    const claim = (authorization?: string) =>
      fetch(`${base}/v1/binding-sessions/${session.sessionId}/claim`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({}),
      });

    expect((await claim()).status).toBe(401);
    const waiting = await claim(`Bearer ${session.pollToken}`);
    expect(waiting.status).toBe(200);
    expect(await waiting.json()).toMatchObject({ status: "waiting" });
  });

  it("requires platform session auth on the organization source surface", async () => {
    const anonymous = await getPluginClient();
    await expect(anonymous.listActivitySources()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const owner = await getPluginClient(
      orgOwnerContext("surface-session-owner", "org-surface-session"),
    );
    await expect(owner.listActivitySources()).resolves.toEqual(expect.any(Array));
  });
});
