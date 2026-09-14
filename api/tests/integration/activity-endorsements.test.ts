import { afterAll, describe, expect, it } from "vitest";
import { authedContext, getPluginClient, teardown } from "../setup";
import { withTestTimeout } from "./activity-stream-test-helpers";
import { provisionIngestionSource } from "./activity-test-helpers";

afterAll(teardown);

describe("Activity event endorsements", () => {
  it("enforces authentication and keeps counts, batching, idempotency, and live state consistent", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "endorsement-source",
      ownerId: "endorsement-owner",
      organizationId: "org-endorsement",
      eventType: "feedback.submitted",
    });
    const gateway = await getPluginClient(undefined, { authorization: `Bearer ${secret}` });
    const submitted = await gateway.submitActivityEvent({
      eventType: "feedback.submitted",
      actor: "alice.near",
      idempotencyKey: "endorsement:event",
      payload: { rating: 5 },
    });
    const publicClient = await getPluginClient();
    const alice = await getPluginClient(authedContext("endorsement-alice"));
    const bob = await getPluginClient(authedContext("endorsement-bob"));

    await expect(publicClient.endorseActivityEvent({ eventId: submitted.eventId })).rejects.toThrow(
      "Authentication required",
    );
    await expect(alice.endorseActivityEvent({ eventId: "f".repeat(64) })).rejects.toThrow(
      "Activity event not found",
    );
    await expect(
      publicClient.getActivityEventEndorsements({ eventIds: [submitted.eventId] }),
    ).resolves.toEqual({
      [submitted.eventId]: {
        eventId: submitted.eventId,
        totalCount: 0,
        endorsedByCurrentUser: false,
      },
    });

    const controller = new AbortController();
    const stream = await alice.streamActivityEventEndorsements({}, { signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();
    const liveUpdate = withTestTimeout(iterator.next());
    const first = await alice.endorseActivityEvent({ eventId: submitted.eventId });
    const repeated = await alice.endorseActivityEvent({ eventId: submitted.eventId });

    expect(first).toEqual({
      eventId: submitted.eventId,
      totalCount: 1,
      endorsedByCurrentUser: true,
    });
    expect(repeated).toEqual(first);
    await expect(liveUpdate).resolves.toMatchObject({
      done: false,
      value: {
        operation: "endorsed",
        eventId: submitted.eventId,
        totalCount: 1,
        changedByCurrentUser: true,
      },
    });
    controller.abort();

    await expect(bob.endorseActivityEvent({ eventId: submitted.eventId })).resolves.toMatchObject({
      totalCount: 2,
      endorsedByCurrentUser: true,
    });
    await expect(
      alice.getActivityEventEndorsements({
        eventIds: [submitted.eventId, "e".repeat(64), submitted.eventId],
      }),
    ).resolves.toEqual({
      [submitted.eventId]: {
        eventId: submitted.eventId,
        totalCount: 2,
        endorsedByCurrentUser: true,
      },
      ["e".repeat(64)]: {
        eventId: "e".repeat(64),
        totalCount: 0,
        endorsedByCurrentUser: false,
      },
    });

    await expect(alice.unendorseActivityEvent({ eventId: submitted.eventId })).resolves.toEqual({
      eventId: submitted.eventId,
      totalCount: 1,
      endorsedByCurrentUser: false,
    });
    await expect(alice.unendorseActivityEvent({ eventId: submitted.eventId })).resolves.toEqual({
      eventId: submitted.eventId,
      totalCount: 1,
      endorsedByCurrentUser: false,
    });
  });
});
