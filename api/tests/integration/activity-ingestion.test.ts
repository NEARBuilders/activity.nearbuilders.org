import { afterAll, describe, expect, it, vi } from "vitest";
import {
  adminContext,
  getPluginClient,
  getTestRelayEvents,
  loseNextTestRelayAcknowledgement,
  orgOwnerContext,
  resetTestRelayEvents,
  teardown,
} from "../setup";
import { provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

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
