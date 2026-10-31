import { afterAll, describe, expect, it } from "vitest";
import {
  adminContext,
  getPluginBaseUrl,
  getPluginClient,
  orgOwnerContext,
  teardown,
} from "../setup";
import { confirmBindingOnChain, provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

async function activeKeyOf(owner: Awaited<ReturnType<typeof getPluginClient>>, sourceId: string) {
  const identity = await owner.getActivitySigningIdentity({ sourceId });
  if (!identity) throw new Error(`No active Signing Identity for ${sourceId}`);
  return identity.publicKey;
}

async function signingKeysFor(sourceId: string) {
  const publicClient = await getPluginClient();
  const { data } = await publicClient.listActivitySigningKeys();
  return data.filter((key) => key.sourceId === sourceId);
}

describe("Activity signing keys", () => {
  it("publicly lists only the source id and public key of a bound Signing Identity", async () => {
    const { owner } = await provisionIngestionSource({
      sourceId: "signing-keys-source",
      ownerId: "signing-keys-owner",
      organizationId: "org-signing-keys",
      eventType: "keys.listed",
    });
    const publicKey = await activeKeyOf(owner, "signing-keys-source");

    const response = await fetch(`${await getPluginBaseUrl()}/v1/signing-keys`);
    const body = (await response.json()) as { data: Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(body.data.filter((key) => key.sourceId === "signing-keys-source")).toEqual([
      { sourceId: "signing-keys-source", publicKey },
    ]);
    expect(body.data.every((key) => Object.keys(key).sort().join() === "publicKey,sourceId")).toBe(
      true,
    );
  });

  it("keeps the retired key after rotation and adds the new key once it is bound", async () => {
    const { owner } = await provisionIngestionSource({
      sourceId: "signing-keys-rotation",
      ownerId: "signing-keys-rotation-owner",
      organizationId: "org-signing-keys-rotation",
      eventType: "keys.rotated",
    });
    const retiredKey = await activeKeyOf(owner, "signing-keys-rotation");

    const rotated = await owner.rotateActivitySigningIdentity({
      sourceId: "signing-keys-rotation",
      reason: "Signing key rotation test",
    });
    expect(await signingKeysFor("signing-keys-rotation")).toEqual([
      { sourceId: "signing-keys-rotation", publicKey: retiredKey },
    ]);

    await confirmBindingOnChain(owner, "signing-keys-rotation");
    expect(await signingKeysFor("signing-keys-rotation")).toEqual(
      [retiredKey, rotated.publicKey]
        .sort()
        .map((publicKey) => ({ sourceId: "signing-keys-rotation", publicKey })),
    );
  });

  it("includes pending sources and excludes rejected sources and unbound identities", async () => {
    await provisionIngestionSource({
      sourceId: "signing-keys-pending",
      ownerId: "signing-keys-pending-owner",
      organizationId: "org-signing-keys-pending",
      eventType: "keys.pending",
      approve: false,
    });
    await provisionIngestionSource({
      sourceId: "signing-keys-rejected",
      ownerId: "signing-keys-rejected-owner",
      organizationId: "org-signing-keys-rejected",
      eventType: "keys.rejected",
      approve: false,
    });
    const administrator = await getPluginClient(adminContext());
    await administrator.reviewActivitySource({
      sourceId: "signing-keys-rejected",
      decision: "rejected",
      reason: "Signing key rejection test",
    });
    const unboundOwner = await getPluginClient(
      orgOwnerContext(
        "signing-keys-unbound-owner",
        "org-signing-keys-unbound",
        "signing-keys-unbound-owner.near",
      ),
    );
    await unboundOwner.createActivitySource({
      sourceId: "signing-keys-unbound",
      displayName: "Unbound Source",
      nearAccountId: "signing-keys-unbound-owner.near",
      eventTypes: [
        { name: "keys.unbound", description: "Unbound events", enabled: true, pointValue: 1 },
      ],
    });
    await unboundOwner.createActivitySigningIdentity({ sourceId: "signing-keys-unbound" });

    expect(await signingKeysFor("signing-keys-pending")).toHaveLength(1);
    expect(await signingKeysFor("signing-keys-rejected")).toEqual([]);
    expect(await signingKeysFor("signing-keys-unbound")).toEqual([]);
  });
});
