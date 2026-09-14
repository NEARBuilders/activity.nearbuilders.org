import { afterAll, describe, expect, it } from "vitest";
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
      canIngest: false,
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
      canIngest: false,
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
      canIngest: false,
      reviewHistory: [
        {
          decision: "approved",
          administratorId: "platform-admin-1",
          reason: "Ownership and event types verified",
          reviewedAt: expect.any(String),
        },
      ],
    });
  });

  it("lets only a platform administrator designate source trust without granting ingestion", async () => {
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
      canIngest: false,
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
});
