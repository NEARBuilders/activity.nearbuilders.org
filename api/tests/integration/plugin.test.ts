import { describe, expect, it } from "vitest";
import {
  adminContext,
  authedContext,
  getPluginClient,
  orgContext,
  orgMemberContext,
  orgOwnerContext,
} from "../setup";

describe("API Plugin Integration Tests", () => {
  describe("ping", () => {
    it("returns healthy status", async () => {
      const client = await getPluginClient();
      const result = await client.ping();

      expect(result).toEqual({
        status: "ok",
        timestamp: expect.any(String),
      });
    });
  });

  describe("authHealth", () => {
    it("rejects unauthenticated requests", async () => {
      const client = await getPluginClient();
      await expect(client.authHealth()).rejects.toThrow("Authentication required");
    });

    it("returns status when authenticated", async () => {
      const client = await getPluginClient(authedContext());
      const result = await client.authHealth();

      expect(result.status).toBe("ok");
      expect(result.emailConfigured).toEqual(expect.any(Boolean));
      expect(result.smsConfigured).toEqual(expect.any(Boolean));
    });
  });

  describe("resolveTenant", () => {
    it("returns null for an unknown account", async () => {
      const client = await getPluginClient();
      const result = await client.resolveTenant({ accountId: "nobody.near" });
      expect(result).toBeNull();
    });

    it("resolves a tenant created by its owning organization", async () => {
      const client = await getPluginClient(orgContext());

      const created = await client.createTenant({
        subdomain: "acme",
        name: "Acme Corp",
        accountId: "acme.example.near",
        status: "active",
      });
      expect(created).toMatchObject({
        subdomain: "acme",
        name: "Acme Corp",
        accountId: "acme.example.near",
        orgId: "org-1",
        status: "active",
      });

      const resolved = await client.resolveTenant({ accountId: "acme.example.near" });
      expect(resolved?.id).toBe(created.id);
    });

    it("rejects invalid accountId format on create", async () => {
      const client = await getPluginClient(orgContext());
      await expect(
        client.createTenant({
          subdomain: "acme",
          name: "Acme Corp",
          accountId: "NOT-A-VALID-ACCOUNT",
        }),
      ).rejects.toThrow("Invalid accountId format");
    });
  });

  describe("tenantPreflight", () => {
    it("reports availability for a fresh subdomain", async () => {
      const client = await getPluginClient(authedContext());
      const result = await client.tenantPreflight({
        subdomain: "acmename",
        parentAccount: "example.near",
      });

      expect(result.subdomain.available).toBe(true);
      expect(result.subdomain.reserved).toBe(false);
      expect(result.accountId.format).toBe("valid");
      expect(result.accountId.available).toBe(true);
    });

    it("flags reserved subdomains", async () => {
      const client = await getPluginClient(authedContext());
      const result = await client.tenantPreflight({
        subdomain: "admin",
        parentAccount: "example.near",
      });

      expect(result.subdomain.reserved).toBe(true);
      expect(result.subdomain.available).toBe(false);
    });
  });

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
  });

  describe("testError", () => {
    it("maps error kinds to client-visible failures", async () => {
      const client = await getPluginClient();

      await expect(client.testError({ kind: "unauthorized" })).rejects.toThrow(
        "test unauthorized error",
      );
      await expect(client.testError({ kind: "forbidden" })).rejects.toThrow("test forbidden error");
      await expect(client.testError({ kind: "not_found" })).rejects.toThrow("test not found error");
      await expect(client.testError({ kind: "conflict" })).rejects.toThrow("test conflict error");
      await expect(client.testError({ kind: "bad_request" })).rejects.toThrow(
        "test bad request error",
      );
      await expect(client.testError({ kind: "internal" as never })).rejects.toThrow(
        "Internal server error",
      );
    });
  });
});
