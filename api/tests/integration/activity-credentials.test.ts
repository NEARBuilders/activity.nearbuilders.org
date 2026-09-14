import { verifyEvent } from "nostr-tools/pure";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  adminContext,
  getActivityCredentialsService,
  getPluginClient,
  getTestRelayEvents,
  orgOwnerContext,
  resetTestRelayEvents,
  teardown,
} from "../setup";
import { provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

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
      createdBy: "credential-owner",
      createdAt: expect.any(String),
      retiredBy: null,
      retirementReason: null,
      retiredAt: null,
    });
    expect(Object.keys(identity).sort()).toEqual([
      "bindingStatus",
      "boundAt",
      "boundNearAccountId",
      "createdAt",
      "createdBy",
      "keyVersion",
      "publicKey",
      "retiredAt",
      "retiredBy",
      "retirementReason",
    ]);

    const rotated = await owner.rotateActivitySigningIdentity({
      sourceId: "credential-source",
      reason: "Routine credential rotation",
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
          retiredBy: "credential-owner",
          retirementReason: "Routine credential rotation",
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
