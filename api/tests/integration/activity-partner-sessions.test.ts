import { afterAll, describe, expect, it, vi } from "vitest";
import {
  adminContext,
  getPluginClient,
  getTestRelayEvents,
  orgOwnerContext,
  resetTestRelayEvents,
  teardown,
} from "../setup";
import { linkSourceOnChain, provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

const realFetch = globalThis.fetch;

const eventTypes = [{ name: "listing.published", description: "", enabled: true, pointValue: 10 }];

function mockProjects(projects: Record<string, { ownerId: string }>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
    const match = String(request).match(
      /^https:\/\/nearbuilders\.org\/api\/v1\/projects\/([^/?]+)$/,
    );
    const project = match ? projects[decodeURIComponent(match[1] ?? "")] : undefined;
    if (match && project) {
      const id = decodeURIComponent(match[1] ?? "");
      return new Response(
        JSON.stringify({
          data: { id, slug: `${id}-a1b2c3`, title: id, domain: null, apps: [], ...project },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (match) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return realFetch(request, init);
  });
}

async function trustedPartnerKey(sourceId: string) {
  const partner = await provisionIngestionSource({
    sourceId,
    ownerId: `${sourceId}-owner`,
    organizationId: `org-${sourceId}`,
    eventType: "partner.event",
  });
  const administrator = await getPluginClient(adminContext());
  await administrator.updateActivitySourceTrust({
    sourceId,
    trustStatus: "trusted",
    scoreMultiplier: 1,
    reason: "Partner test",
  });
  return partner.secret;
}

describe("Partner binding sessions", () => {
  it("lets a trusted partner start a session whose key is shown once on the page", async () => {
    const partnerSecret = await trustedPartnerKey("nb-partner");
    const projects = mockProjects({ proj_partner: { ownerId: "partner-owner.near" } });
    try {
      const partner = await getPluginClient(undefined, {
        authorization: `Bearer ${partnerSecret}`,
      });

      await expect(
        partner.createActivityBindingSession({ displayName: "No project", eventTypes }),
      ).rejects.toThrow("A partner binding session must name a nearbuilders.org project");
      await expect(
        partner.createActivityBindingSession({
          project: { id: "proj_partner" },
          eventTypes: [{ name: "too.many", description: "", enabled: true, pointValue: 101 }],
        }),
      ).rejects.toThrow();

      const session = await partner.createActivityBindingSession({
        project: { id: "proj_partner" },
        eventTypes,
      });
      expect(session.delivery).toBe("page");
      expect(session.pollToken).toBeUndefined();
      expect(session.draft).toMatchObject({ nearAccountId: "partner-owner.near" });
      const sessionToken = new URL(session.url).searchParams.get("sessionToken") ?? "";

      const owner = await getPluginClient(
        orgOwnerContext("partner-owner", "org-partner-owner", "partner-owner.near"),
      );
      await expect(owner.getActivityBindingSession({ sessionToken })).resolves.toMatchObject({
        delivery: "page",
        status: "waiting",
      });
      await expect(owner.revealActivityBindingSessionKey({ sessionToken })).rejects.toThrow(
        "Finish linking the Activity Source before showing its key",
      );

      await owner.createActivitySource({
        sourceId: "partner-project",
        displayName: "Partner Project",
        nearAccountId: "partner-owner.near",
        nearbuildersProjectId: "proj_partner",
        eventTypes,
      });
      projects.mockRestore();
      await linkSourceOnChain(owner, "partner-project");
      await owner.completeActivityBindingSession({ sessionToken, sourceId: "partner-project" });

      const anonymous = await getPluginClient();
      await expect(
        anonymous.getNearbuildersProjectActivity({ projectId: "proj_partner" }),
      ).resolves.toMatchObject({ status: "connected", sourceId: "partner-project" });

      const outsider = await getPluginClient(
        orgOwnerContext("partner-outsider", "org-partner-outsider", "partner-outsider.near"),
      );
      await expect(outsider.revealActivityBindingSessionKey({ sessionToken })).rejects.toThrow(
        "Finish linking the Activity Source before showing its key",
      );

      const revealed = await owner.revealActivityBindingSessionKey({ sessionToken });
      expect(revealed).toMatchObject({
        sourceId: "partner-project",
        secret: expect.stringMatching(/^act_/),
      });
      await expect(owner.revealActivityBindingSessionKey({ sessionToken })).rejects.toThrow(
        "This key was already shown",
      );

      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${revealed.secret}`,
      });
      resetTestRelayEvents();
      await expect(
        gateway.submitActivityEvent({
          eventType: "activity.test",
          actor: "partner-owner.near",
          idempotencyKey: "connection-test",
          payload: {},
        }),
      ).resolves.toEqual({ eventId: expect.stringMatching(/^[a-f0-9]{64}$/), test: true });
      expect(getTestRelayEvents()).toHaveLength(0);
      await expect(
        owner.getActivitySourceTestStatus({ sourceId: "partner-project" }),
      ).resolves.toMatchObject({ lastTestEventAt: expect.any(String) });
      await expect(
        anonymous.getNearbuildersProjectActivity({ projectId: "proj_partner" }),
      ).resolves.toMatchObject({ status: "connected" });

      await gateway.submitActivityEvent({
        eventType: "listing.published",
        actor: "partner-owner.near",
        idempotencyKey: "first-listing",
        payload: {},
      });
      expect(getTestRelayEvents()).toHaveLength(1);
      await expect(
        anonymous.getNearbuildersProjectActivity({ projectId: "proj_partner" }),
      ).resolves.toMatchObject({ status: "tracked" });
    } finally {
      projects.mockRestore();
    }
  });

  it("refuses partner sessions from untrusted or unknown keys", async () => {
    const untrusted = await provisionIngestionSource({
      sourceId: "nb-untrusted",
      ownerId: "nb-untrusted-owner",
      organizationId: "org-nb-untrusted",
      eventType: "partner.event",
    });
    const standard = await getPluginClient(undefined, {
      authorization: `Bearer ${untrusted.secret}`,
    });
    await expect(
      standard.createActivityBindingSession({ project: { id: "proj_any" }, eventTypes }),
    ).rejects.toThrow("Only approved, trusted Activity Sources can start partner binding sessions");

    const unknown = await getPluginClient(undefined, { authorization: "Bearer act_unknown" });
    await expect(
      unknown.createActivityBindingSession({ project: { id: "proj_any" }, eventTypes }),
    ).rejects.toThrow();
  });

  it("reports none and rejected project statuses", async () => {
    const projects = mockProjects({ proj_rejected: { ownerId: "rejected-owner.near" } });
    try {
      const anonymous = await getPluginClient();
      await expect(
        anonymous.getNearbuildersProjectActivity({ projectId: "proj_nothing" }),
      ).resolves.toEqual({
        status: "none",
        sourceId: null,
        displayName: null,
        approvalStatus: null,
        reviewReason: null,
      });

      const owner = await getPluginClient(
        orgOwnerContext("rejected-owner", "org-rejected-owner", "rejected-owner.near"),
      );
      await owner.createActivitySource({
        sourceId: "rejected-project",
        displayName: "Rejected Project",
        nearAccountId: "rejected-owner.near",
        nearbuildersProjectId: "proj_rejected",
        eventTypes,
      });
      const administrator = await getPluginClient(adminContext());
      await administrator.reviewActivitySource({
        sourceId: "rejected-project",
        decision: "rejected",
        reason: "Events do not match the project",
      });
      await expect(
        anonymous.getNearbuildersProjectActivity({ projectId: "proj_rejected" }),
      ).resolves.toMatchObject({
        status: "rejected",
        approvalStatus: "rejected",
        reviewReason: "Events do not match the project",
      });
    } finally {
      projects.mockRestore();
    }
  });
});
