import { afterAll, describe, expect, it, vi } from "vitest";
import {
  getPluginClient,
  getTestRelayEvents,
  orgOwnerContext,
  resetTestRelayEvents,
  teardown,
} from "../setup";
import { linkSourceOnChain } from "./activity-test-helpers";

afterAll(teardown);

const eventTypes = [
  {
    name: "agent.task.completed",
    description: "An agent-reported task was completed",
    enabled: true,
    pointValue: 3,
  },
];

describe("Activity binding sessions", () => {
  it("hands the Source API Key to the agent exactly once after the person links the source", async () => {
    const agent = await getPluginClient();
    const session = await agent.createActivityBindingSession({
      project: { title: "Agent Project" },
      sourceId: "agent-project",
      displayName: "Agent Project",
      eventTypes,
    });

    expect(session.matchCode).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(session.pollToken).toMatch(/^abp_/);
    const sessionToken = new URL(session.url).searchParams.get("sessionToken");
    expect(new URL(session.url).pathname).toBe("/binding");
    expect(sessionToken).toMatch(/^abs_/);
    if (!sessionToken) throw new Error("Binding session URL has no session token");

    const poller = await getPluginClient(undefined, {
      authorization: `Bearer ${session.pollToken}`,
    });
    await expect(
      agent.claimActivityBindingSession({ sessionId: session.sessionId }),
    ).rejects.toThrow("Binding session poll token required");
    const impostor = await getPluginClient(undefined, { authorization: "Bearer abp_wrong" });
    await expect(
      impostor.claimActivityBindingSession({ sessionId: session.sessionId }),
    ).rejects.toThrow("Binding session not found");
    await expect(
      poller.claimActivityBindingSession({ sessionId: session.sessionId }),
    ).resolves.toEqual({ status: "waiting" });

    const owner = await getPluginClient(
      orgOwnerContext("agent-binding-owner", "org-agent-binding", "agent-binding-owner.near"),
    );
    await expect(owner.getActivityBindingSession({ sessionToken })).resolves.toMatchObject({
      matchCode: session.matchCode,
      status: "waiting",
      sourceId: null,
      draft: { sourceId: "agent-project", displayName: "Agent Project", eventTypes },
    });

    await owner.createActivitySource({
      sourceId: "agent-project",
      displayName: "Agent Project",
      nearAccountId: "agent-binding-owner.near",
      eventTypes,
    });
    await expect(
      owner.completeActivityBindingSession({ sessionToken, sourceId: "agent-project" }),
    ).rejects.toThrow("Link the Activity Source on-chain before completing the binding session");

    await linkSourceOnChain(owner, "agent-project");
    await expect(
      owner.completeActivityBindingSession({ sessionToken, sourceId: "agent-project" }),
    ).resolves.toMatchObject({ status: "ready", sourceId: "agent-project" });
    await expect(
      owner.completeActivityBindingSession({ sessionToken, sourceId: "agent-project" }),
    ).rejects.toThrow("Binding session is already complete");

    const claimed = await poller.claimActivityBindingSession({ sessionId: session.sessionId });
    expect(claimed).toMatchObject({
      status: "ready",
      sourceId: "agent-project",
      secret: expect.stringMatching(/^act_/),
    });
    await expect(
      poller.claimActivityBindingSession({ sessionId: session.sessionId }),
    ).resolves.toEqual({ status: "claimed", sourceId: "agent-project" });

    if (claimed.status !== "ready") throw new Error("Expected a claimed Source API Key");
    const gateway = await getPluginClient(undefined, {
      authorization: `Bearer ${claimed.secret}`,
    });
    resetTestRelayEvents();
    await expect(
      gateway.submitActivityEvent({
        eventType: "agent.task.completed",
        actor: "agent-binding-owner.near",
        idempotencyKey: "agent:first",
        payload: { task: "integrate" },
      }),
    ).resolves.toMatchObject({ eventId: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(getTestRelayEvents()).toHaveLength(1);
    await expect(owner.listActivitySourceApiKeys({ sourceId: "agent-project" })).resolves.toEqual([
      expect.objectContaining({ id: claimed.apiKeyId, name: "Agent binding key" }),
    ]);
  });

  it("only lets the owning organization complete a session with its own source", async () => {
    const agent = await getPluginClient();
    const session = await agent.createActivityBindingSession({ displayName: "Other Project" });
    const sessionToken = new URL(session.url).searchParams.get("sessionToken") ?? "";
    const outsider = await getPluginClient(
      orgOwnerContext("binding-outsider", "org-binding-outsider", "binding-outsider.near"),
    );

    await expect(
      outsider.completeActivityBindingSession({ sessionToken, sourceId: "agent-project" }),
    ).rejects.toThrow("Activity Source not found");
    await expect(
      outsider.getActivityBindingSession({ sessionToken: "abs_unknown" }),
    ).rejects.toThrow("Binding session not found");
  });

  it("prefills a session from a nearbuilders.org project link, keeping the agent's own fields", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      if (
        String(request) ===
        "https://nearbuilders.org/api/v1/projects/by-slug/activity-nearbuilders-org-2erd1k"
      ) {
        return new Response(
          JSON.stringify({
            data: {
              id: "proj_1791152600182_r4z661r",
              slug: "activity-nearbuilders-org-2erd1k",
              title: "activity.nearbuilders.org",
              ownerId: "nearbuilding.near",
              domain: null,
              apps: [],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(request, init);
    });
    try {
      const agent = await getPluginClient();
      const session = await agent.createActivityBindingSession({
        project: {
          reference: "https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k",
        },
        displayName: "Activity",
        eventTypes,
      });

      expect(session.draft).toEqual({
        project: {
          id: "proj_1791152600182_r4z661r",
          slug: "activity-nearbuilders-org-2erd1k",
          title: "activity.nearbuilders.org",
          url: "https://nearbuilders.org/projects/activity-nearbuilders-org-2erd1k",
        },
        sourceId: "activity.nearbuilders.org",
        displayName: "Activity",
        nearAccountId: "nearbuilding.near",
        eventTypes,
      });

      await expect(
        agent.lookupNearbuildersProject({ reference: "activity-nearbuilders-org-2erd1k" }),
      ).rejects.toThrow();
      const member = await getPluginClient(
        orgOwnerContext("project-lookup-user", "org-project-lookup", "project-lookup-user.near"),
      );
      await expect(
        member.lookupNearbuildersProject({ reference: "activity-nearbuilders-org-2erd1k" }),
      ).resolves.toMatchObject({
        sourceId: "activity.nearbuilders.org",
        nearAccountId: "nearbuilding.near",
      });
      await expect(
        agent.createActivityBindingSession({
          project: { reference: "https://example.com/projects/elsewhere" },
        }),
      ).rejects.toThrow("Paste a project link like https://nearbuilders.org/projects/<slug>");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("limits how many binding sessions one caller can start", async () => {
    const caller = await getPluginClient(undefined, {
      "x-forwarded-for": "198.51.100.1, 203.0.113.7",
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await caller.createActivityBindingSession({ displayName: `Limited ${attempt.toString()}` });
    }

    await expect(
      caller.createActivityBindingSession({ displayName: "One too many" }),
    ).rejects.toThrow("Too many binding sessions started");
    const spoofed = await getPluginClient(undefined, {
      "x-forwarded-for": "192.0.2.99, 203.0.113.7",
    });
    await expect(
      spoofed.createActivityBindingSession({ displayName: "Spoofed first hop" }),
    ).rejects.toThrow("Too many binding sessions started");
    const otherCaller = await getPluginClient(undefined, { "x-forwarded-for": "203.0.113.8" });
    await expect(
      otherCaller.createActivityBindingSession({ displayName: "Another caller" }),
    ).resolves.toMatchObject({ matchCode: expect.any(String) });
  });

  it("refuses to complete a project session with a source registered for something else", async () => {
    const originalFetch = globalThis.fetch;
    const project = {
      id: "proj_session_owned",
      slug: "session-owned-project-a1b2c3",
      title: "Session Owned Project",
      ownerId: "session-owner.near",
      domain: null,
      apps: [],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const url = String(request);
      if (
        url === `https://nearbuilders.org/api/v1/projects/by-slug/${project.slug}` ||
        url === `https://nearbuilders.org/api/v1/projects/${project.id}`
      ) {
        return new Response(JSON.stringify({ data: project }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(request, init);
    });
    try {
      const agent = await getPluginClient();
      const session = await agent.createActivityBindingSession({
        project: { reference: `https://nearbuilders.org/projects/${project.slug}` },
        eventTypes,
      });
      const sessionToken = new URL(session.url).searchParams.get("sessionToken") ?? "";
      const owner = await getPluginClient(
        orgOwnerContext("session-owner", "org-session-owner", "session-owner.near"),
      );
      await owner.createActivitySource({
        sourceId: "session-unrelated-source",
        displayName: "Unrelated",
        nearAccountId: "session-owner.near",
        eventTypes,
      });

      await expect(
        owner.completeActivityBindingSession({
          sessionToken,
          sourceId: "session-unrelated-source",
        }),
      ).rejects.toThrow(
        "This Activity Source was not registered for the project this session is for",
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
