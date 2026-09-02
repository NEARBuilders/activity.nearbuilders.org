import { verifyEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import {
  adminContext,
  authedContext,
  getActivityCredentialsService,
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

  describe("Activity source credentials", () => {
    it("creates a Signing Identity only for an approved Source Owner", async () => {
      const owner = await getPluginClient(orgOwnerContext("credential-owner", "org-credentials"));
      await owner.createActivitySource({
        sourceId: "credential-source",
        displayName: "Credential Source",
        nearAccountId: "credential-owner.near",
        eventTypes: [
          {
            name: "credential.event",
            description: "An event authenticated with source credentials",
            enabled: true,
            pointValue: 1,
          },
        ],
      });

      await expect(
        owner.createActivitySigningIdentity({ sourceId: "credential-source" }),
      ).rejects.toThrow("Activity Source is not approved");

      const administrator = await getPluginClient(adminContext());
      await administrator.reviewActivitySource({
        sourceId: "credential-source",
        decision: "approved",
        reason: "Credential test source",
      });

      const identity = await owner.createActivitySigningIdentity({
        sourceId: "credential-source",
      });

      expect(identity).toEqual({
        publicKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        bindingStatus: "pending",
        boundNearAccountId: null,
        boundAt: null,
        keyVersion: "v1",
        createdAt: expect.any(String),
        retiredAt: null,
      });
      expect(Object.keys(identity).sort()).toEqual([
        "bindingStatus",
        "boundAt",
        "boundNearAccountId",
        "createdAt",
        "keyVersion",
        "publicKey",
        "retiredAt",
      ]);

      const rotated = await owner.rotateActivitySigningIdentity({
        sourceId: "credential-source",
      });
      const history = await owner.listActivitySigningIdentities({
        sourceId: "credential-source",
      });

      expect(rotated).toMatchObject({
        publicKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        bindingStatus: "pending",
        retiredAt: null,
      });
      expect(rotated.publicKey).not.toBe(identity.publicKey);
      expect(history).toHaveLength(2);
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            publicKey: identity.publicKey,
            retiredAt: expect.any(String),
          }),
          rotated,
        ]),
      );
    });

    it("prepares a NEAR-authorized binding only for the source account", async () => {
      const owner = await getPluginClient(orgOwnerContext("binding-source", "org-binding"));
      await owner.createActivitySource({
        sourceId: "binding-source",
        displayName: "Binding Source",
        nearAccountId: "binding-source.near",
        eventTypes: [
          {
            name: "binding.event",
            description: "An event from a bound source",
            enabled: true,
            pointValue: 1,
          },
        ],
      });
      const administrator = await getPluginClient(adminContext());
      await administrator.reviewActivitySource({
        sourceId: "binding-source",
        decision: "approved",
        reason: "Binding test source",
      });
      const identity = await owner.createActivitySigningIdentity({ sourceId: "binding-source" });
      const otherNearAccount = await getPluginClient(
        orgOwnerContext("other-binding-owner", "org-binding"),
      );

      await expect(
        otherNearAccount.prepareActivitySigningIdentityBinding({ sourceId: "binding-source" }),
      ).rejects.toThrow("Connect the Activity Source NEAR account");

      const prepared = await owner.prepareActivitySigningIdentityBinding({
        sourceId: "binding-source",
      });
      const bindingValue = JSON.parse(prepared.value);
      const proof = JSON.parse(bindingValue.proof);

      expect(prepared).toMatchObject({
        contractId: "contextual.near",
        methodName: "__fastdata_kv",
        key: "nostr/binding-source.near",
        args: { "nostr/binding-source.near": prepared.value },
        gas: "300000000000000",
        attachedDeposit: "10000000000000000000000",
      });
      expect(bindingValue).toMatchObject({
        npub: identity.publicKey,
        relay: expect.stringMatching(/^wss:\/\//),
        proof: expect.any(String),
        bound_at: expect.any(Number),
      });
      expect(proof).toMatchObject({
        nostrPubkey: identity.publicKey,
        challenge: expect.stringMatching(/^bind:binding-source\.near:/),
        eventId: expect.stringMatching(/^[a-f0-9]{64}$/),
        verifiedBy: "binding-source.near",
        verifiedAt: expect.any(Number),
      });

      const originalFetch = globalThis.fetch;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input).startsWith("https://kv.main.fastnear.com/")) {
          return new Response(JSON.stringify({ entries: [{ value: bindingValue }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return originalFetch(input, init);
      });
      try {
        const confirmed = await owner.confirmActivitySigningIdentityBinding({
          sourceId: "binding-source",
        });
        const retrieved = await owner.getActivitySigningIdentity({ sourceId: "binding-source" });

        expect(confirmed).toMatchObject({
          publicKey: identity.publicKey,
          bindingStatus: "bound",
          boundNearAccountId: "binding-source.near",
          boundAt: expect.any(String),
        });
        expect(retrieved).toEqual(confirmed);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("reveals source API keys once and rejects revoked or unapproved keys", async () => {
      const owner = await getPluginClient(orgOwnerContext("api-key-source", "org-api-key"));
      await owner.createActivitySource({
        sourceId: "api-key-source",
        displayName: "API Key Source",
        nearAccountId: "api-key-source.near",
        eventTypes: [
          {
            name: "api-key.event",
            description: "An API-key-authenticated event",
            enabled: true,
            pointValue: 1,
          },
        ],
      });
      const administrator = await getPluginClient(adminContext());
      await administrator.reviewActivitySource({
        sourceId: "api-key-source",
        decision: "approved",
        reason: "API key test source",
      });
      await owner.createActivitySigningIdentity({ sourceId: "api-key-source" });
      const prepared = await owner.prepareActivitySigningIdentityBinding({
        sourceId: "api-key-source",
      });
      const bindingValue = JSON.parse(prepared.value);
      const originalFetch = globalThis.fetch;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input).startsWith("https://kv.main.fastnear.com/")) {
          return new Response(JSON.stringify({ entries: [{ value: bindingValue }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return originalFetch(input, init);
      });
      try {
        await owner.confirmActivitySigningIdentityBinding({ sourceId: "api-key-source" });
      } finally {
        fetchSpy.mockRestore();
      }

      const created = await owner.createActivitySourceApiKey({
        sourceId: "api-key-source",
        name: "Production gateway",
      });
      const listed = await owner.listActivitySourceApiKeys({ sourceId: "api-key-source" });

      expect(created).toEqual({
        secret: expect.stringMatching(/^act_[A-Za-z0-9_-]{43}$/),
        apiKey: {
          id: expect.any(String),
          sourceId: "api-key-source",
          name: "Production gateway",
          prefix: expect.stringMatching(/^act_[A-Za-z0-9_-]{8}$/),
          permissions: ["event:write"],
          createdAt: expect.any(String),
          lastUsedAt: null,
          revokedAt: null,
        },
      });
      expect(listed).toEqual([created.apiKey]);
      expect(JSON.stringify(listed)).not.toContain(created.secret);

      const credentials = await getActivityCredentialsService();
      await expect(credentials.authenticateEventWriteKey(created.secret)).resolves.toMatchObject({
        sourceId: "api-key-source",
        organizationId: "org-api-key",
        publicKey: bindingValue.npub,
        permissions: ["event:write"],
      });
      const signedEvent = await credentials.signActivityEvent("api-key-source", {
        kind: 1701,
        created_at: 1_788_400_000,
        tags: [
          ["s", "api-key-source"],
          ["t", "api-key.event"],
          ["n", "tester.near"],
          ["i", "api-key:test"],
        ],
        content: JSON.stringify({ accepted: true }),
      });
      expect(signedEvent.pubkey).toBe(bindingValue.npub);
      expect(verifyEvent(signedEvent)).toBe(true);

      const revoked = await owner.revokeActivitySourceApiKey({
        sourceId: "api-key-source",
        apiKeyId: created.apiKey.id,
      });
      expect(revoked.revokedAt).toEqual(expect.any(String));
      await expect(credentials.authenticateEventWriteKey(created.secret)).rejects.toThrow(
        "Invalid Source API Key",
      );

      const pendingKey = await owner.createActivitySourceApiKey({
        sourceId: "api-key-source",
        name: "Pending-source key",
      });
      await owner.updateActivitySource({
        sourceId: "api-key-source",
        displayName: "API Key Source Updated",
      });
      await expect(credentials.authenticateEventWriteKey(pendingKey.secret)).rejects.toThrow(
        "Activity Source is not approved for ingestion",
      );
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
