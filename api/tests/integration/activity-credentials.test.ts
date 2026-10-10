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
  it("creates a Signing Identity for a pending source but not a rejected one", async () => {
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

    await owner.createActivitySource({
      sourceId: "rejected-credential-source",
      displayName: "Rejected Credential Source",
      nearAccountId: "rejected-credential.near",
      eventTypes: [
        {
          name: "credential.event",
          description: "An event authenticated with source credentials",
          enabled: true,
          pointValue: 1,
        },
      ],
    });
    const administrator = await getPluginClient(adminContext());
    await administrator.reviewActivitySource({
      sourceId: "rejected-credential-source",
      decision: "rejected",
      reason: "Credential test rejection",
    });
    await expect(
      owner.createActivitySigningIdentity({ sourceId: "rejected-credential-source" }),
    ).rejects.toThrow("Activity Source was rejected");
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
    ).rejects.toThrow(/^Only .+ can link this source\. Link that NEAR account/);

    const ownerWithSecondaryAccount = orgOwnerContext(
      "binding-owner-secondary",
      "org-binding",
      "primary-owner.near",
    );
    const secondaryNear = ownerWithSecondaryAccount.near as {
      linkedAccounts: Array<Record<string, unknown>>;
    };
    secondaryNear.linkedAccounts.push({
      accountId: "binding-source.near",
      network: "mainnet",
      publicKey: `ed25519:${"2".repeat(64)}`,
      isPrimary: false,
    });
    const secondaryOwner = await getPluginClient(ownerWithSecondaryAccount);
    await expect(
      secondaryOwner.prepareActivitySigningIdentityBinding({ sourceId: "binding-source" }),
    ).resolves.toMatchObject({ key: "activity/binding-source" });

    const prepared = await owner.prepareActivitySigningIdentityBinding({
      sourceId: "binding-source",
    });
    const bindingValue = JSON.parse(prepared.value);
    const proof = JSON.parse(bindingValue.proof);

    expect(prepared).toMatchObject({
      contractId: "contextual.near",
      methodName: "__fastdata_kv",
      key: "activity/binding-source",
      args: { "activity/binding-source": prepared.value },
      gas: "20000000000000",
      attachedDeposit: "0",
    });
    expect(bindingValue).toMatchObject({
      sourceId: "binding-source",
      npub: identity.publicKey,
      relay: expect.stringMatching(/^wss:\/\//),
      proof: expect.any(String),
      bound_at: expect.any(Number),
    });
    expect(proof).toMatchObject({
      nostrPubkey: identity.publicKey,
      challenge: expect.stringMatching(
        /^bind:binding-source\.near:binding-source:\d+:activity-source$/,
      ),
      sourceId: "binding-source",
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

  it("reveals source API keys once, keeps pending keys working, and rejects revoked or rejected keys", async () => {
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
    await expect(credentials.authenticateEventWriteKey(pendingKey.secret)).resolves.toMatchObject({
      sourceId: "api-key-source",
    });

    await administrator.reviewActivitySource({
      sourceId: "api-key-source",
      decision: "rejected",
      reason: "API key test rejection",
    });
    await expect(credentials.authenticateEventWriteKey(pendingKey.secret)).rejects.toThrow(
      "Activity Source was rejected",
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

  it("binds several sources on one NEAR account through their own on-chain slots", async () => {
    const owner = await getPluginClient(orgOwnerContext("multi-owner", "org-multi"));
    const eventTypes = [{ name: "multi.event", description: "", enabled: true, pointValue: 1 }];
    for (const sourceId of ["multi-a", "multi-b"]) {
      await owner.createActivitySource({
        sourceId,
        displayName: sourceId,
        nearAccountId: "multi-owner.near",
        eventTypes,
      });
      await owner.createActivitySigningIdentity({ sourceId });
    }
    const preparedA = await owner.prepareActivitySigningIdentityBinding({ sourceId: "multi-a" });
    const preparedB = await owner.prepareActivitySigningIdentityBinding({ sourceId: "multi-b" });
    expect(preparedA.key).toBe("activity/multi-a");
    expect(preparedB.key).toBe("activity/multi-b");

    const slots = new Map<string, unknown>([
      ["/contextual.near/multi-owner.near/activity/multi-a", JSON.parse(preparedA.value)],
      ["/contextual.near/multi-owner.near/activity/multi-b", JSON.parse(preparedB.value)],
    ]);
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://kv.main.fastnear.com/")) {
        requested.push(url);
        const path = new URL(url).pathname.replace(/^\/v0\/latest/, "");
        const value = slots.get(path);
        return new Response(JSON.stringify({ entries: value ? [{ value }] : [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    });
    try {
      await expect(
        owner.confirmActivitySigningIdentityBinding({ sourceId: "multi-a" }),
      ).resolves.toMatchObject({ bindingStatus: "bound", boundNearAccountId: "multi-owner.near" });
      await expect(
        owner.confirmActivitySigningIdentityBinding({ sourceId: "multi-b" }),
      ).resolves.toMatchObject({ bindingStatus: "bound", boundNearAccountId: "multi-owner.near" });
    } finally {
      fetchSpy.mockRestore();
    }
    expect(requested).toContain(
      "https://kv.main.fastnear.com/v0/latest/contextual.near/multi-owner.near/activity/multi-a",
    );
    expect(requested.some((url) => url.endsWith("/nostr/multi-owner.near"))).toBe(false);
  });

  it("accepts a legacy account-level binding but rejects a slot claiming another source", async () => {
    const owner = await getPluginClient(orgOwnerContext("legacy-owner", "org-legacy"));
    await owner.createActivitySource({
      sourceId: "legacy-source",
      displayName: "Legacy Source",
      nearAccountId: "legacy-owner.near",
      eventTypes: [{ name: "legacy.event", description: "", enabled: true, pointValue: 1 }],
    });
    const identity = await owner.createActivitySigningIdentity({ sourceId: "legacy-source" });

    const respondWith = (slots: Record<string, unknown>) => {
      const originalFetch = globalThis.fetch;
      return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.startsWith("https://kv.main.fastnear.com/")) {
          const path = new URL(url).pathname.replace(/^\/v0\/latest/, "");
          const value = slots[path];
          return new Response(JSON.stringify({ entries: value ? [{ value }] : [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return originalFetch(input, init);
      });
    };

    const wrongSource = respondWith({
      "/contextual.near/legacy-owner.near/activity/legacy-source": {
        sourceId: "someone-else",
        npub: identity.publicKey,
      },
    });
    try {
      await expect(
        owner.confirmActivitySigningIdentityBinding({ sourceId: "legacy-source" }),
      ).rejects.toThrow("The NEAR-to-Nostr binding does not match this signing identity");
    } finally {
      wrongSource.mockRestore();
    }

    const unnamedSlot = respondWith({
      "/contextual.near/legacy-owner.near/activity/legacy-source": { npub: identity.publicKey },
    });
    try {
      await expect(
        owner.confirmActivitySigningIdentityBinding({ sourceId: "legacy-source" }),
      ).rejects.toThrow("The NEAR-to-Nostr binding does not match this signing identity");
    } finally {
      unnamedSlot.mockRestore();
    }

    const otherAccount = respondWith({
      "/contextual.near/attacker.near/activity/legacy-source": {
        sourceId: "legacy-source",
        npub: identity.publicKey,
      },
    });
    try {
      await expect(
        owner.confirmActivitySigningIdentityBinding({ sourceId: "legacy-source" }),
      ).rejects.toThrow("The NEAR-to-Nostr binding is not available yet");
    } finally {
      otherAccount.mockRestore();
    }

    const legacy = respondWith({
      "/contextual.near/legacy-owner.near/nostr/legacy-owner.near": {
        npub: identity.publicKey,
        bound_at: 1_790_000_000,
      },
    });
    try {
      await expect(
        owner.confirmActivitySigningIdentityBinding({ sourceId: "legacy-source" }),
      ).resolves.toMatchObject({ bindingStatus: "bound" });
    } finally {
      legacy.mockRestore();
    }
  });
});
