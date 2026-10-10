import { vi } from "vitest";
import { adminContext, getPluginClient, orgOwnerContext } from "../setup";

export async function provisionIngestionSource(input: {
  sourceId: string;
  ownerId: string;
  organizationId: string;
  eventType: string;
  eventTypeEnabled?: boolean;
  approve?: boolean;
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
  if (input.approve ?? true) {
    const administrator = await getPluginClient(adminContext());
    await administrator.reviewActivitySource({
      sourceId: input.sourceId,
      decision: "approved",
      reason: "Ingestion test source",
    });
  }
  await linkSourceOnChain(owner, input.sourceId);
  const created = await owner.createActivitySourceApiKey({
    sourceId: input.sourceId,
    name: "Ingestion test",
  });
  return { owner, ...created };
}

export async function linkSourceOnChain(
  owner: Awaited<ReturnType<typeof getPluginClient>>,
  sourceId: string,
) {
  await owner.createActivitySigningIdentity({ sourceId });
  const prepared = await owner.prepareActivitySigningIdentityBinding({ sourceId });
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
    await owner.confirmActivitySigningIdentityBinding({ sourceId });
  } finally {
    fetchSpy.mockRestore();
  }
}
