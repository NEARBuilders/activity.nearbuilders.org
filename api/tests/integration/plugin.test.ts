import { getEventMeta } from "every-plugin/orpc";
import { verifyEvent } from "nostr-tools/pure";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  adminContext,
  authedContext,
  getActivityCredentialsService,
  getPluginBaseUrl,
  getPluginClient,
  getTestRelayEvents,
  getTestRelaySubscriptionCount,
  loseNextTestRelayAcknowledgement,
  orgContext,
  orgMemberContext,
  orgOwnerContext,
  resetTestRelayEvents,
  teardown,
} from "../setup";

afterAll(teardown);

async function provisionIngestionSource(input: {
  sourceId: string;
  ownerId: string;
  organizationId: string;
  eventType: string;
  eventTypeEnabled?: boolean;
}) {
  const owner = await getPluginClient(
    orgOwnerContext(input.ownerId, input.organizationId, `${input.ownerId}.near`),
  );
  await owner.createActivitySource({
    sourceId: input.sourceId,
    displayName: `${input.sourceId} Source`,
    nearAccountId: `${input.ownerId}.near`,
    eventTypes: [
      {
        name: input.eventType,
        description: `Events for ${input.sourceId}`,
        enabled: input.eventTypeEnabled ?? true,
        pointValue: 5,
      },
    ],
  });
  const administrator = await getPluginClient(adminContext());
  await administrator.reviewActivitySource({
    sourceId: input.sourceId,
    decision: "approved",
    reason: "Ingestion test source",
  });
  await owner.createActivitySigningIdentity({ sourceId: input.sourceId });
  const prepared = await owner.prepareActivitySigningIdentityBinding({
    sourceId: input.sourceId,
  });
  const bindingValue = JSON.parse(prepared.value);
  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
    if (String(request).startsWith("https://kv.main.fastnear.com/")) {
      return new Response(JSON.stringify({ entries: [{ value: bindingValue }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(request, init);
  });
  try {
    await owner.confirmActivitySigningIdentityBinding({ sourceId: input.sourceId });
  } finally {
    fetchSpy.mockRestore();
  }
  const created = await owner.createActivitySourceApiKey({
    sourceId: input.sourceId,
    name: "Ingestion test",
  });
  return { owner, ...created };
}

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
      const credential = await credentials.authenticateEventWriteKey(created.secret);
      expect(credential).toMatchObject({
        sourceId: "api-key-source",
        organizationId: "org-api-key",
        publicKey: bindingValue.npub,
        permissions: ["event:write"],
      });
      const signedEvent = await credentials.signActivityEvent(credential, {
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

    it("requires a new Binding Proof after the Activity Source NEAR account changes", async () => {
      const { owner, secret } = await provisionIngestionSource({
        sourceId: "rebound-source",
        ownerId: "rebound-owner",
        organizationId: "org-rebound",
        eventType: "binding.changed",
      });
      await owner.updateActivitySource({
        sourceId: "rebound-source",
        nearAccountId: "replacement-owner.near",
      });
      await expect(
        owner.getActivitySigningIdentity({ sourceId: "rebound-source" }),
      ).resolves.toMatchObject({
        bindingStatus: "pending",
        boundNearAccountId: null,
        boundAt: null,
      });
      const administrator = await getPluginClient(adminContext());
      await administrator.reviewActivitySource({
        sourceId: "rebound-source",
        decision: "approved",
        reason: "Replacement source account reviewed",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      resetTestRelayEvents();

      await expect(
        gateway.submitActivityEvent({
          eventType: "binding.changed",
          actor: "replacement-owner.near",
          idempotencyKey: "binding:changed",
          payload: { rebound: false },
        }),
      ).rejects.toThrow("Activity Source signing identity is not bound");
      expect(getTestRelayEvents()).toHaveLength(0);
    });
  });

  describe("Activity event ingestion", () => {
    it("rejects a submission without a Source API Key", async () => {
      const gateway = await getPluginClient();
      resetTestRelayEvents();

      await expect(
        gateway.submitActivityEvent({
          eventType: "feedback.submitted",
          actor: "alice.near",
          idempotencyKey: "feedback:unauthorized",
          payload: { rating: 5 },
        }),
      ).rejects.toThrow("Source API Key required");
      expect(getTestRelayEvents()).toHaveLength(0);
    });

    it("publishes a valid event and returns its immutable event ID", async () => {
      const owner = await getPluginClient(orgOwnerContext("ingestion-owner", "org-ingestion"));
      await owner.createActivitySource({
        sourceId: "ingestion-source",
        displayName: "Ingestion Source",
        nearAccountId: "ingestion-owner.near",
        eventTypes: [
          {
            name: "feedback.submitted",
            description: "Feedback submitted to a round",
            enabled: true,
            pointValue: 5,
          },
        ],
      });
      const administrator = await getPluginClient(adminContext());
      await administrator.reviewActivitySource({
        sourceId: "ingestion-source",
        decision: "approved",
        reason: "Ingestion test source",
      });
      await owner.createActivitySigningIdentity({ sourceId: "ingestion-source" });
      const prepared = await owner.prepareActivitySigningIdentityBinding({
        sourceId: "ingestion-source",
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
        await owner.confirmActivitySigningIdentityBinding({ sourceId: "ingestion-source" });
      } finally {
        fetchSpy.mockRestore();
      }
      const { secret } = await owner.createActivitySourceApiKey({
        sourceId: "ingestion-source",
        name: "Ingestion test",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      resetTestRelayEvents();

      const result = await gateway.submitActivityEvent({
        eventType: "feedback.submitted",
        actor: "alice.near",
        idempotencyKey: "feedback:round-1:alice.near",
        payload: { rating: 5 },
      });

      expect(result).toEqual({ eventId: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(getTestRelayEvents()).toEqual([
        expect.objectContaining({
          id: result.eventId,
          kind: 1701,
          content: JSON.stringify({ rating: 5 }),
          tags: [
            ["s", "ingestion-source"],
            ["t", "feedback.submitted"],
            ["n", "alice.near"],
            ["i", "feedback:round-1:alice.near"],
          ],
        }),
      ]);
    });

    it("returns the original event without republishing an identical retry", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "retry-source",
        ownerId: "retry-owner",
        organizationId: "org-retry",
        eventType: "build.completed",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      const submission = {
        eventType: "build.completed",
        actor: "builder.near",
        idempotencyKey: "build:42",
        payload: { result: "success" },
      };
      resetTestRelayEvents();

      const first = await gateway.submitActivityEvent(submission);
      const retried = await gateway.submitActivityEvent(submission);

      expect(retried).toEqual(first);
      expect(getTestRelayEvents()).toHaveLength(1);
    });

    it("treats reordered JSON object properties as the same retried payload", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "canonical-source",
        ownerId: "canonical-owner",
        organizationId: "org-canonical",
        eventType: "feedback.rated",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      resetTestRelayEvents();

      const first = await gateway.submitActivityEvent({
        eventType: "feedback.rated",
        actor: "reviewer.near",
        idempotencyKey: "rating:42",
        payload: { rating: 5, note: "great" },
      });
      const retried = await gateway.submitActivityEvent({
        eventType: "feedback.rated",
        actor: "reviewer.near",
        idempotencyKey: "rating:42",
        payload: { note: "great", rating: 5 },
      });

      expect(retried).toEqual(first);
      expect(getTestRelayEvents()).toHaveLength(1);
    });

    it("rejects payloads larger than 16 KiB without publishing", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "payload-limit-source",
        ownerId: "payload-limit-owner",
        organizationId: "org-payload-limit",
        eventType: "payload.received",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      resetTestRelayEvents();

      await expect(
        gateway.submitActivityEvent({
          eventType: "payload.received",
          actor: "payload.near",
          idempotencyKey: "payload:oversized",
          payload: { content: "x".repeat(16 * 1_024) },
        }),
      ).rejects.toThrow("Activity event payload exceeds 16 KiB");
      expect(getTestRelayEvents()).toHaveLength(0);
    });

    it("publishes only once when identical requests arrive concurrently", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "concurrent-source",
        ownerId: "concurrent-owner",
        organizationId: "org-concurrent",
        eventType: "release.published",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      const submission = {
        eventType: "release.published",
        actor: "release.near",
        idempotencyKey: "release:v1",
        payload: { version: "1.0.0" },
      };
      resetTestRelayEvents();

      const [first, concurrent] = await Promise.all([
        gateway.submitActivityEvent(submission),
        gateway.submitActivityEvent(submission),
      ]);

      expect(concurrent).toEqual(first);
      expect(getTestRelayEvents()).toHaveLength(1);
    });

    it("publishes canonically identical concurrent requests only once", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "canonical-concurrent-source",
        ownerId: "canonical-concurrent-owner",
        organizationId: "org-canonical-concurrent",
        eventType: "feedback.submitted",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      resetTestRelayEvents();

      const [first, concurrent] = await Promise.all([
        gateway.submitActivityEvent({
          eventType: "feedback.submitted",
          actor: "alice.near",
          idempotencyKey: "feedback:canonical-concurrent",
          payload: { rating: 5, note: "useful" },
        }),
        gateway.submitActivityEvent({
          eventType: "feedback.submitted",
          actor: "alice.near",
          idempotencyKey: "feedback:canonical-concurrent",
          payload: { note: "useful", rating: 5 },
        }),
      ]);

      expect(concurrent).toEqual(first);
      expect(getTestRelayEvents()).toHaveLength(1);
      expect(getTestRelayEvents()[0]?.id).toBe(first.eventId);
    });

    it("rejects a reused idempotency key with different event content", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "conflict-source",
        ownerId: "conflict-owner",
        organizationId: "org-conflict",
        eventType: "task.completed",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      resetTestRelayEvents();
      await gateway.submitActivityEvent({
        eventType: "task.completed",
        actor: "worker.near",
        idempotencyKey: "task:42",
        payload: { points: 5 },
      });

      await expect(
        gateway.submitActivityEvent({
          eventType: "task.completed",
          actor: "worker.near",
          idempotencyKey: "task:42",
          payload: { points: 10 },
        }),
      ).rejects.toThrow("Idempotency key was already used for a different Activity event");
      expect(getTestRelayEvents()).toHaveLength(1);
    });

    it("rejects a revoked Source API Key without publishing", async () => {
      const { owner, secret, apiKey } = await provisionIngestionSource({
        sourceId: "revoked-source",
        ownerId: "revoked-owner",
        organizationId: "org-revoked",
        eventType: "vote.cast",
      });
      await owner.revokeActivitySourceApiKey({
        sourceId: "revoked-source",
        apiKeyId: apiKey.id,
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      resetTestRelayEvents();

      await expect(
        gateway.submitActivityEvent({
          eventType: "vote.cast",
          actor: "voter.near",
          idempotencyKey: "vote:42",
          payload: { choice: "yes" },
        }),
      ).rejects.toThrow("Invalid Source API Key");
      expect(getTestRelayEvents()).toHaveLength(0);
    });

    it("rejects an Event Type that is disabled for the authenticated source", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "disabled-type-source",
        ownerId: "disabled-type-owner",
        organizationId: "org-disabled-type",
        eventType: "reward.claimed",
        eventTypeEnabled: false,
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      resetTestRelayEvents();

      await expect(
        gateway.submitActivityEvent({
          eventType: "reward.claimed",
          actor: "claimer.near",
          idempotencyKey: "reward:42",
          payload: { amount: 10 },
        }),
      ).rejects.toThrow("Event Type is not enabled for this Activity Source");
      expect(getTestRelayEvents()).toHaveLength(0);
    });

    it("retries an unacknowledged relay publish with the same signed event ID", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "relay-retry-source",
        ownerId: "relay-retry-owner",
        organizationId: "org-relay-retry",
        eventType: "session.recorded",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      const submission = {
        eventType: "session.recorded",
        actor: "speaker.near",
        idempotencyKey: "session:42",
        payload: { durationMinutes: 30 },
      };
      resetTestRelayEvents();
      loseNextTestRelayAcknowledgement();

      await expect(gateway.submitActivityEvent(submission)).rejects.toThrow(
        "Activity relay did not acknowledge the event",
      );
      const unacknowledgedEvent = getTestRelayEvents()[0];
      expect(unacknowledgedEvent).toBeDefined();

      const retried = await gateway.submitActivityEvent(submission);

      expect(retried.eventId).toBe(unacknowledgedEvent?.id);
      expect(getTestRelayEvents().map(({ id }) => id)).toEqual([
        unacknowledgedEvent?.id,
        unacknowledgedEvent?.id,
      ]);
    });
  });

  describe("Activity event feed", () => {
    it("publicly filters and cursor-paginates trusted Activity events without overlap", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "feed-source",
        ownerId: "feed-owner",
        organizationId: "org-feed",
        eventType: "feedback.submitted",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      resetTestRelayEvents();
      const firstSubmitted = await gateway.submitActivityEvent({
        eventType: "feedback.submitted",
        actor: "alice.near",
        idempotencyKey: "feed:alice",
        payload: { rating: 5 },
      });
      const secondSubmitted = await gateway.submitActivityEvent({
        eventType: "feedback.submitted",
        actor: "bob.near",
        idempotencyKey: "feed:bob",
        payload: { rating: 4 },
      });
      const publicClient = await getPluginClient();

      const firstPage = await publicClient.listActivityEvents({
        source: "feed-source",
        type: "feedback.submitted",
        limit: 1,
      });
      const secondPage = await publicClient.listActivityEvents({
        source: "feed-source",
        type: "feedback.submitted",
        limit: 1,
        cursor: firstPage.meta.nextCursor ?? undefined,
      });

      expect(firstPage.meta.hasMore).toBe(true);
      expect(firstPage.meta.nextCursor).toEqual(expect.any(String));
      expect(secondPage.meta).toEqual({
        hasMore: false,
        nextCursor: null,
        skippedInvalid: 0,
      });
      expect([...firstPage.data, ...secondPage.data].map(({ id }) => id).sort()).toEqual(
        [firstSubmitted.eventId, secondSubmitted.eventId].sort(),
      );
      expect(new Set([...firstPage.data, ...secondPage.data].map(({ id }) => id)).size).toBe(2);

      const actorFiltered = await publicClient.listActivityEvents({ actor: "alice.near" });
      expect(actorFiltered.data).toEqual([
        expect.objectContaining({
          id: firstSubmitted.eventId,
          source: "feed-source",
          type: "feedback.submitted",
          actor: "alice.near",
          payload: { rating: 5 },
        }),
      ]);

      const rawResponse = await fetch(
        `${await getPluginBaseUrl()}/v1/events?source=feed-source&limit=1`,
      );
      const rawFeed = (await rawResponse.json()) as { data: unknown[] };
      expect(rawResponse.status).toBe(200);
      expect(rawFeed.data).toHaveLength(1);
    });

    it("rejects a malformed public feed cursor", async () => {
      const publicClient = await getPluginClient();

      await expect(publicClient.listActivityEvents({ cursor: "invalid" })).rejects.toThrow(
        "Activity cursor is invalid",
      );
    });

    it("streams newly submitted events that match all public feed filters", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "stream-source",
        ownerId: "stream-owner",
        organizationId: "org-stream",
        eventType: "feedback.submitted",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      const publicClient = await getPluginClient();
      const stream = await publicClient.streamActivityEvents({
        source: "stream-source",
        type: "feedback.submitted",
        actor: "alice.near",
      });

      try {
        const nextEvent = stream.next();
        await gateway.submitActivityEvent({
          eventType: "feedback.submitted",
          actor: "bob.near",
          idempotencyKey: "stream:bob",
          payload: { rating: 3 },
        });
        const submitted = await gateway.submitActivityEvent({
          eventType: "feedback.submitted",
          actor: "alice.near",
          idempotencyKey: "stream:alice",
          payload: { rating: 5 },
        });

        await expect(withTestTimeout(nextEvent)).resolves.toEqual({
          done: false,
          value: expect.objectContaining({
            id: submitted.eventId,
            source: "stream-source",
            type: "feedback.submitted",
            actor: "alice.near",
            payload: { rating: 5 },
          }),
        });
      } finally {
        await stream.return?.();
      }

      await expect.poll(() => getTestRelaySubscriptionCount()).toBe(0);
    });

    it("replays events after Last-Event-ID before continuing live with stable SSE IDs", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "resume-source",
        ownerId: "resume-owner",
        organizationId: "org-resume",
        eventType: "session.recorded",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      const first = await gateway.submitActivityEvent({
        eventType: "session.recorded",
        actor: "speaker.near",
        idempotencyKey: "resume:first",
        payload: { sequence: 1 },
      });
      await new Promise((resolve) => setTimeout(resolve, 1_050));
      const second = await gateway.submitActivityEvent({
        eventType: "session.recorded",
        actor: "speaker.near",
        idempotencyKey: "resume:second",
        payload: { sequence: 2 },
      });
      const resumedClient = await getPluginClient(undefined, {
        "last-event-id": first.eventId,
      });
      const stream = await resumedClient.streamActivityEvents({ source: "resume-source" });

      try {
        const replayed = await withTestTimeout(stream.next());
        expect(replayed).toEqual({
          done: false,
          value: expect.objectContaining({ id: second.eventId, payload: { sequence: 2 } }),
        });
        expect(replayed.done ? undefined : getEventMeta(replayed.value)?.id).toBe(second.eventId);
      } finally {
        await stream.return?.();
      }

      const response = await withTestTimeout(
        fetch(`${await getPluginBaseUrl()}/v1/events/stream?source=resume-source`, {
          headers: { "last-event-id": first.eventId },
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      try {
        const frame = await readSseEventFrame(reader!);
        expect(frame).toMatch(new RegExp(`^id:\\s*${second.eventId}$`, "m"));
        expect(frame).toContain('"sequence":2');
      } finally {
        await reader?.cancel();
      }
    });

    it("replays an event stored during a relay disconnect after reconnecting", async () => {
      const { secret } = await provisionIngestionSource({
        sourceId: "reconnect-source",
        ownerId: "reconnect-owner",
        organizationId: "org-reconnect",
        eventType: "build.completed",
      });
      const gateway = await getPluginClient(undefined, {
        authorization: `Bearer ${secret}`,
      });
      const publicClient = await getPluginClient();
      const stream = await publicClient.streamActivityEvents({ source: "reconnect-source" });

      try {
        const replayedEvent = stream.next();
        loseNextTestRelayAcknowledgement();
        await expect(
          gateway.submitActivityEvent({
            eventType: "build.completed",
            actor: "builder.near",
            idempotencyKey: "reconnect:stored",
            payload: { result: "success" },
          }),
        ).rejects.toThrow("Activity relay did not acknowledge the event");
        const storedEvent = getTestRelayEvents().at(-1);

        await expect(withTestTimeout(replayedEvent, 5_000)).resolves.toEqual({
          done: false,
          value: expect.objectContaining({
            id: storedEvent?.id,
            source: "reconnect-source",
            payload: { result: "success" },
          }),
        });
      } finally {
        await stream.return?.();
      }
    });

    it("rejects malformed and unavailable Last-Event-ID values", async () => {
      for (const lastEventId of ["not-an-event-id", "f".repeat(64)]) {
        const client = await getPluginClient(undefined, { "last-event-id": lastEventId });
        const stream = await client.streamActivityEvents({ source: "resume-source" });
        await expect(stream.next()).rejects.toThrow(
          "Last-Event-ID is invalid or is not available in relay history",
        );
      }
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

async function withTestTimeout<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for streamed Activity event")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readSseEventFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let body = "";
  while (true) {
    let boundary = body.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = body.slice(0, boundary);
      body = body.slice(boundary + 2);
      if (/^id:/m.test(frame) && /^data:/m.test(frame)) return frame;
      boundary = body.indexOf("\n\n");
    }
    const chunk = await withTestTimeout(reader.read());
    if (chunk.done) throw new Error("Activity SSE stream ended before an event frame arrived");
    body += decoder.decode(chunk.value, { stream: true });
  }
}
