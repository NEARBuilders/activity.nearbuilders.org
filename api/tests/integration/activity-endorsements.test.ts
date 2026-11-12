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

function nearCaller(userId: string, accounts: string[]) {
  return {
    ...authedContext(userId),
    near: {
      primaryAccountId: accounts[0] ?? null,
      linkedAccounts: accounts.map((accountId, index) => ({
        accountId,
        network: "mainnet",
        publicKey: "",
        isPrimary: index === 0,
      })),
      hasNearAccount: accounts.length > 0,
    },
  };
}

describe("Activity endorsements keyed on the canonical owner id (#103)", () => {
  it("follows the endorser across a primary switch, a NEAR link and a reissued user id", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "endorsement-identity-source",
      ownerId: "endorsement-identity-owner",
      organizationId: "org-endorsement-identity",
      eventType: "feedback.submitted",
    });
    const gateway = await getPluginClient(undefined, { authorization: `Bearer ${secret}` });
    const submit = async (key: string) =>
      (
        await gateway.submitActivityEvent({
          eventType: "feedback.submitted",
          actor: "carol.near",
          idempotencyKey: `endorsement-identity:${key}`,
          payload: { rating: 4 },
        })
      ).eventId;
    const switchEvent = await submit("switch");
    const linkEvent = await submit("link");

    // Endorsed as carol.near, then the primary moves to a linked account.
    const carol = await getPluginClient(nearCaller("carol-user", ["carol.near", "carol-alt.near"]));
    await carol.endorseActivityEvent({ eventId: switchEvent });
    const switched = await getPluginClient(
      nearCaller("carol-user", ["carol-alt.near", "carol.near"]),
    );
    await expect(switched.endorseActivityEvent({ eventId: switchEvent })).resolves.toEqual({
      eventId: switchEvent,
      totalCount: 1,
      endorsedByCurrentUser: true,
    });

    // The shared auth DB reissues the user id; the account still owns the endorsement.
    const reissued = await getPluginClient(nearCaller("carol-user-new", ["carol.near"]));
    await expect(
      reissued.getActivityEventEndorsements({ eventIds: [switchEvent] }),
    ).resolves.toMatchObject({ [switchEvent]: { totalCount: 1, endorsedByCurrentUser: true } });
    await expect(reissued.unendorseActivityEvent({ eventId: switchEvent })).resolves.toMatchObject({
      totalCount: 0,
      endorsedByCurrentUser: false,
    });

    // Endorsed before linking NEAR (keyed on the user id), then a NEAR account is linked.
    const dave = await getPluginClient(authedContext("dave-user"));
    await dave.endorseActivityEvent({ eventId: linkEvent });
    const daveLinked = await getPluginClient(nearCaller("dave-user", ["dave.near"]));
    await expect(daveLinked.endorseActivityEvent({ eventId: linkEvent })).resolves.toEqual({
      eventId: linkEvent,
      totalCount: 1,
      endorsedByCurrentUser: true,
    });
    // Once claimed onto the account, it survives a reissued user id too.
    const daveReissued = await getPluginClient(nearCaller("dave-user-new", ["dave.near"]));
    await expect(
      daveReissued.getActivityEventEndorsements({ eventIds: [linkEvent] }),
    ).resolves.toMatchObject({ [linkEvent]: { totalCount: 1, endorsedByCurrentUser: true } });

    // Someone else holding none of these ids is unaffected.
    const erin = await getPluginClient(nearCaller("erin-user", ["erin.near"]));
    await expect(
      erin.getActivityEventEndorsements({ eventIds: [linkEvent] }),
    ).resolves.toMatchObject({ [linkEvent]: { totalCount: 1, endorsedByCurrentUser: false } });
  });
});

describe("Activity endorsements after unlinking the endorsing account (#103)", () => {
  it("lets the user endorse again under a new primary account", async () => {
    const { secret } = await provisionIngestionSource({
      sourceId: "endorsement-unlink-source",
      ownerId: "endorsement-unlink-owner",
      organizationId: "org-endorsement-unlink",
      eventType: "feedback.submitted",
    });
    const gateway = await getPluginClient(undefined, { authorization: `Bearer ${secret}` });
    const { eventId } = await gateway.submitActivityEvent({
      eventType: "feedback.submitted",
      actor: "frank.near",
      idempotencyKey: "endorsement-unlink:event",
      payload: { rating: 3 },
    });

    const before = await getPluginClient(nearCaller("frank-user", ["frank-old.near"]));
    await before.endorseActivityEvent({ eventId });

    // frank-old.near is unlinked and frank-new.near becomes primary for the same user. The
    // old endorsement stays with frank-old.near; the user can endorse again as frank-new.near.
    const after = await getPluginClient(nearCaller("frank-user", ["frank-new.near"]));
    await expect(after.getActivityEventEndorsements({ eventIds: [eventId] })).resolves.toEqual({
      [eventId]: { eventId, totalCount: 1, endorsedByCurrentUser: false },
    });
    await expect(after.endorseActivityEvent({ eventId })).resolves.toEqual({
      eventId,
      totalCount: 2,
      endorsedByCurrentUser: true,
    });
    await expect(after.unendorseActivityEvent({ eventId })).resolves.toEqual({
      eventId,
      totalCount: 1,
      endorsedByCurrentUser: false,
    });
    await expect(
      before.getActivityEventEndorsements({ eventIds: [eventId] }),
    ).resolves.toMatchObject({ [eventId]: { totalCount: 1, endorsedByCurrentUser: true } });
  });
});
