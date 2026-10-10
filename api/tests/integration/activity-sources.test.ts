import { afterAll, describe, expect, it, vi } from "vitest";
import {
  adminContext,
  getPluginClient,
  orgMemberContext,
  orgOwnerContext,
  teardown,
} from "../setup";

afterAll(teardown);

describe("Activity sources", () => {
  it("requires an organization owner to be authenticated with NEAR", async () => {
    const emailOnlyOwner = await getPluginClient(
      orgOwnerContext("email-owner", "org-email-owner", null),
    );

    await expect(
      emailOnlyOwner.createActivitySource({
        sourceId: "email-only-source",
        displayName: "Email-only Source",
        nearAccountId: "email-only-source.near",
        eventTypes: [
          {
            name: "email.action",
            description: "An action submitted without NEAR authentication",
            enabled: true,
            pointValue: 1,
          },
        ],
      }),
    ).rejects.toThrow("NEAR authentication required");
  });

  it("names the conflicting Source ID and lets one NEAR account own several sources", async () => {
    const client = await getPluginClient(orgOwnerContext("conflict-owner", "org-conflict"));
    const eventTypes = [
      { name: "conflict.action", description: "A conflict test", enabled: true, pointValue: 1 },
    ];
    await client.createActivitySource({
      sourceId: "conflict-source",
      displayName: "Conflict Source",
      nearAccountId: "conflict-source.near",
      eventTypes,
    });

    await expect(
      client.createActivitySource({
        sourceId: "conflict-source",
        displayName: "Duplicate ID",
        nearAccountId: "another-conflict.near",
        eventTypes,
      }),
    ).rejects.toMatchObject({
      message: "The Source ID conflict-source is already taken",
      data: { field: "sourceId" },
    });
    await expect(
      client.createActivitySource({
        sourceId: "conflict-source-two",
        displayName: "Second source on the same account",
        nearAccountId: "conflict-source.near",
        eventTypes,
      }),
    ).resolves.toMatchObject({ sourceId: "conflict-source-two" });
  });

  it("caps how many sources one NEAR account can own", async () => {
    const client = await getPluginClient(orgOwnerContext("cap-owner", "org-cap"));
    const eventTypes = [{ name: "cap.action", description: "", enabled: true, pointValue: 1 }];
    for (let index = 0; index < 10; index += 1) {
      await client.createActivitySource({
        sourceId: `cap-source-${index}`,
        displayName: `Cap Source ${index}`,
        nearAccountId: "cap-owner.near",
        eventTypes,
      });
    }

    await expect(
      client.createActivitySource({
        sourceId: "cap-source-10",
        displayName: "One too many",
        nearAccountId: "cap-owner.near",
        eventTypes,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "The NEAR account cap-owner.near already owns the maximum of 10 Activity Sources",
      ),
      data: { field: "nearAccountId" },
    });
    await expect(
      client.createActivitySource({
        sourceId: "cap-source-other-account",
        displayName: "Different account",
        nearAccountId: "cap-other.near",
        eventTypes,
      }),
    ).resolves.toMatchObject({ sourceId: "cap-source-other-account" });
  });

  it("lets an organization owner register and retrieve a pending source", async () => {
    const client = await getPluginClient(orgOwnerContext());

    const organizationMember = await getPluginClient(orgMemberContext("member-1", "org-owner-1"));
    await expect(
      organizationMember.createActivitySource({
        sourceId: "member-source",
        displayName: "Member Source",
        nearAccountId: "member-source.near",
        eventTypes: [
          {
            name: "member.action",
            description: "A member action",
            enabled: true,
            pointValue: 1,
          },
        ],
      }),
    ).rejects.toThrow("Requires organization role: owner");

    const source = await client.createActivitySource({
      sourceId: "near-catalog",
      displayName: "NEAR Catalog",
      nearAccountId: "catalog.near",
      eventTypes: [
        {
          name: "catalog.project.published",
          description: "A project was published to the catalog",
          enabled: true,
          pointValue: 25,
        },
      ],
    });
    const sources = await client.listActivitySources();

    expect(source).toMatchObject({
      sourceId: "near-catalog",
      displayName: "NEAR Catalog",
      nearAccountId: "catalog.near",
      organizationId: "org-owner-1",
      approvalStatus: "pending",
      canIngest: true,
      eventTypes: [
        {
          name: "catalog.project.published",
          description: "A project was published to the catalog",
          enabled: true,
          pointValue: 25,
        },
      ],
    });
    expect(sources).toEqual([source]);
  });

  it("lets only the owning organization update source configuration", async () => {
    const owner = await getPluginClient(orgOwnerContext("owner-2", "org-owner-2"));
    await owner.createActivitySource({
      sourceId: "builder-directory",
      displayName: "Builder Directory",
      nearAccountId: "builders.near",
      eventTypes: [
        {
          name: "builder.profile.created",
          description: "A builder created a profile",
          enabled: true,
          pointValue: 10,
        },
      ],
    });
    const otherOrganization = await getPluginClient(orgOwnerContext("owner-3", "org-owner-3"));

    await expect(
      otherOrganization.updateActivitySource({
        sourceId: "builder-directory",
        displayName: "Taken over",
      }),
    ).rejects.toThrow("Activity Source not found");
    await expect(otherOrganization.listActivitySources()).resolves.toEqual([]);
    await expect(owner.updateActivitySource({ sourceId: "builder-directory" })).rejects.toThrow(
      "At least one source field must be updated",
    );

    const updated = await owner.updateActivitySource({
      sourceId: "builder-directory",
      displayName: "NEAR Builder Directory",
      eventTypes: [
        {
          name: "builder.profile.created",
          description: "A builder created a public profile",
          enabled: true,
          pointValue: 15,
        },
        {
          name: "builder.project.added",
          description: "A builder added a project",
          enabled: false,
          pointValue: 20,
        },
      ],
    });

    expect(updated).toMatchObject({
      sourceId: "builder-directory",
      displayName: "NEAR Builder Directory",
      organizationId: "org-owner-2",
      approvalStatus: "pending",
      canIngest: true,
      eventTypes: [
        {
          name: "builder.profile.created",
          description: "A builder created a public profile",
          enabled: true,
          pointValue: 15,
        },
        {
          name: "builder.project.added",
          description: "A builder added a project",
          enabled: false,
          pointValue: 20,
        },
      ],
    });
  });

  it("lets only a platform administrator approve or reject pending sources with a reason", async () => {
    const owner = await getPluginClient(orgOwnerContext("owner-4", "org-owner-4"));
    await owner.createActivitySource({
      sourceId: "governance-hub",
      displayName: "Governance Hub",
      nearAccountId: "governance.near",
      eventTypes: [
        {
          name: "governance.vote.cast",
          description: "A member cast a governance vote",
          enabled: true,
          pointValue: 5,
        },
      ],
    });
    await owner.createActivitySource({
      sourceId: "unverified-source",
      displayName: "Unverified Source",
      nearAccountId: "unverified.near",
      eventTypes: [
        {
          name: "unverified.action",
          description: "An unverified action",
          enabled: true,
          pointValue: 1,
        },
      ],
    });

    await expect(
      owner.reviewActivitySource({
        sourceId: "governance-hub",
        decision: "approved",
        reason: "Owner cannot self-approve",
      }),
    ).rejects.toThrow("Requires role: admin");

    const administrator = await getPluginClient(adminContext());
    const pending = await administrator.listActivitySourcesForReview({
      approvalStatus: "pending",
    });
    const approved = await administrator.reviewActivitySource({
      sourceId: "governance-hub",
      decision: "approved",
      reason: "Ownership and event types verified",
    });
    const rejected = await administrator.reviewActivitySource({
      sourceId: "unverified-source",
      decision: "rejected",
      reason: "NEAR account ownership could not be verified",
    });
    await expect(
      administrator.reviewActivitySource({
        sourceId: "governance-hub",
        decision: "rejected",
        reason: "A completed review cannot be replaced",
      }),
    ).rejects.toThrow("Only pending Activity Sources can be reviewed");

    expect(pending.map(({ sourceId }) => sourceId)).toEqual(
      expect.arrayContaining(["governance-hub", "unverified-source"]),
    );
    expect(approved).toMatchObject({
      approvalStatus: "approved",
      canIngest: true,
      reviewHistory: [
        {
          decision: "approved",
          administratorId: "platform-admin-1",
          reason: "Ownership and event types verified",
          reviewedAt: expect.any(String),
        },
      ],
    });
    expect(rejected).toMatchObject({
      approvalStatus: "rejected",
      canIngest: false,
      reviewedBy: "platform-admin-1",
      reviewReason: "NEAR account ownership could not be verified",
      reviewedAt: expect.any(String),
    });

    const resubmitted = await owner.updateActivitySource({
      sourceId: "governance-hub",
      displayName: "Governance Hub Updated",
    });
    expect(resubmitted).toMatchObject({
      approvalStatus: "pending",
      canIngest: true,
      reviewHistory: [
        {
          decision: "approved",
          administratorId: "platform-admin-1",
          reason: "Ownership and event types verified",
          reviewedAt: expect.any(String),
        },
      ],
    });

    await expect(
      owner.updateActivitySource({
        sourceId: "unverified-source",
        displayName: "Unverified Source Updated",
      }),
    ).resolves.toMatchObject({
      approvalStatus: "rejected",
      canIngest: false,
      reviewReason: "NEAR account ownership could not be verified",
    });
  });

  it("lets only a platform administrator designate source trust without changing approval", async () => {
    const owner = await getPluginClient(orgOwnerContext("trust-owner", "org-trust"));
    await owner.createActivitySource({
      sourceId: "trust-source",
      displayName: "Trust Source",
      nearAccountId: "trust-owner.near",
      eventTypes: [
        {
          name: "trust.event",
          description: "An event with separately administered trust",
          enabled: true,
          pointValue: 4,
        },
      ],
    });

    await expect(
      owner.updateActivitySourceTrust({
        sourceId: "trust-source",
        trustStatus: "trusted",
        scoreMultiplier: 1.5,
        reason: "Owner cannot designate their own source as trusted",
      }),
    ).rejects.toThrow("Requires role: admin");

    const administrator = await getPluginClient(adminContext());
    const trusted = await administrator.updateActivitySourceTrust({
      sourceId: "trust-source",
      trustStatus: "trusted",
      scoreMultiplier: 1.5,
      reason: "Source operating history reviewed",
    });

    expect(trusted).toMatchObject({
      approvalStatus: "pending",
      canIngest: true,
      trustStatus: "trusted",
      scoreMultiplier: 1.5,
      trustHistory: [
        {
          trustStatus: "trusted",
          scoreMultiplier: 1.5,
          reason: "Source operating history reviewed",
          administratorId: "platform-admin-1",
          changedAt: expect.any(String),
        },
      ],
    });
  });

  it("accepts event types without a description", async () => {
    const owner = await getPluginClient(
      orgOwnerContext("no-description-owner", "org-no-description", "no-description.near"),
    );
    const source = await owner.createActivitySource({
      sourceId: "no-description-source",
      displayName: "No Description Source",
      nearAccountId: "no-description.near",
      eventTypes: [{ name: "plain.event", enabled: true, pointValue: 1 }],
    });

    expect(source.eventTypes).toEqual([
      expect.objectContaining({ name: "plain.event", description: "" }),
    ]);
  });

  it("links a source to one nearbuilders.org project at most", async () => {
    const projects = mockNearbuildersProjects({
      proj_linked_example: { ownerId: "project-link.near", apps: ["project-copy.near"] },
    });
    try {
      const first = await getPluginClient(
        orgOwnerContext("project-link-owner", "org-project-link", "project-link.near"),
      );
      const linked = await first.createActivitySource({
        sourceId: "project-link-source",
        displayName: "Project Link Source",
        nearAccountId: "project-link.near",
        nearbuildersProjectId: "proj_linked_example",
        eventTypes: [{ name: "linked.event", enabled: true, pointValue: 1 }],
      });
      expect(linked.nearbuildersProjectId).toBe("proj_linked_example");

      const second = await getPluginClient(
        orgOwnerContext("project-copy-owner", "org-project-copy", "project-copy.near"),
      );
      await expect(
        second.createActivitySource({
          sourceId: "project-copy-source",
          displayName: "Project Copy Source",
          nearAccountId: "project-copy.near",
          nearbuildersProjectId: "proj_linked_example",
          eventTypes: [{ name: "copy.event", enabled: true, pointValue: 1 }],
        }),
      ).rejects.toMatchObject({
        message:
          "This nearbuilders.org project already has an Activity Source: project-link-source",
        data: { field: "project" },
      });
    } finally {
      projects.mockRestore();
    }
  });

  it("refuses to let anyone but the project owner claim a nearbuilders.org project", async () => {
    const projects = mockNearbuildersProjects({
      proj_owned: { ownerId: "real-owner.near", apps: [] },
    });
    try {
      const squatter = await getPluginClient(
        orgOwnerContext("squatter", "org-squatter", "squatter.near"),
      );
      await expect(
        squatter.createActivitySource({
          sourceId: "squatted-source",
          displayName: "Squatted",
          nearAccountId: "squatter.near",
          nearbuildersProjectId: "proj_owned",
          eventTypes: [{ name: "squat.event", enabled: true, pointValue: 1 }],
        }),
      ).rejects.toThrow(
        "Only the project owner's NEAR account (real-owner.near) can register this nearbuilders.org project",
      );
      await expect(
        squatter.createActivitySource({
          sourceId: "squatted-source-two",
          displayName: "Squatted with the owner's name",
          nearAccountId: "real-owner.near",
          nearbuildersProjectId: "proj_owned",
          eventTypes: [{ name: "squat.event", enabled: true, pointValue: 1 }],
        }),
      ).rejects.toMatchObject({
        message: "Sign in with real-owner.near to register this nearbuilders.org project",
        data: { field: "nearAccountId" },
      });
      await expect(
        squatter.createActivitySource({
          sourceId: "missing-project-source",
          displayName: "Missing",
          nearAccountId: "squatter.near",
          nearbuildersProjectId: "proj_missing",
          eventTypes: [{ name: "squat.event", enabled: true, pointValue: 1 }],
        }),
      ).rejects.toThrow('No nearbuilders.org project matches "proj_missing"');

      const owner = await getPluginClient(
        orgOwnerContext("real-owner", "org-real-owner", "real-owner.near"),
      );
      await expect(
        owner.createActivitySource({
          sourceId: "real-owner-source",
          displayName: "Real Owner",
          nearAccountId: "real-owner.near",
          nearbuildersProjectId: "proj_owned",
          eventTypes: [{ name: "owner.event", enabled: true, pointValue: 1 }],
        }),
      ).resolves.toMatchObject({ nearbuildersProjectId: "proj_owned" });
      await expect(
        owner.updateActivitySource({
          sourceId: "real-owner-source",
          nearAccountId: "squatter.near",
        }),
      ).rejects.toThrow(
        "Only the project owner's NEAR account (real-owner.near) can register this nearbuilders.org project",
      );
    } finally {
      projects.mockRestore();
    }
  });
});

function mockNearbuildersProjects(
  projects: Record<string, { ownerId: string | null; apps: string[] }>,
) {
  const originalFetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const match = url.match(/^https:\/\/nearbuilders\.org\/api\/v1\/projects\/([^/?]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1] ?? "");
      const project = projects[id];
      if (!project) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      return new Response(
        JSON.stringify({
          data: {
            id,
            slug: id,
            title: id,
            domain: null,
            ownerId: project.ownerId,
            apps: project.apps.map((accountId) => ({ accountId })),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  });
}
