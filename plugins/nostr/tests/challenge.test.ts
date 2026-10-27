import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { expectBadRequest, makeBindingEvent, withBinding } from "./helpers";

const NEAR = "alice.near";

describe("BindingService.createChallenge", () => {
  it("issues a challenge string of the expected shape", () => {
    const exit = Effect.runSyncExit(withBinding((svc) => svc.createChallenge(NEAR)));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.challenge).toMatch(/^bind:alice\.near:\d+:near-nostr-bindings$/);
      expect(exit.value.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }
  });

  it("uses challengeExpirySeconds=300 by default", () => {
    const exit = Effect.runSyncExit(withBinding((svc) => svc.createChallenge(NEAR)));
    if (Exit.isSuccess(exit)) {
      const ttl = exit.value.expiresAt - Math.floor(Date.now() / 1000);
      expect(ttl).toBeGreaterThanOrEqual(295);
      expect(ttl).toBeLessThanOrEqual(300);
    }
  });
});

describe("BindingService.verifyChallenge", () => {
  it("verifies a valid challenge for the matching account", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const content = `bind:${NEAR}:${expiresAt}:near-nostr-bindings`;
    const event = makeBindingEvent(content);
    const exit = await Effect.runPromiseExit(
      withBinding((svc) => svc.verifyChallenge(event, NEAR)),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.valid).toBe(true);
      expect(exit.value.nostrPubkey).toBe(event.pubkey);
      const proof = JSON.parse(exit.value.proof) as Record<string, unknown>;
      expect(proof.nostrPubkey).toBe(event.pubkey);
      expect(proof.challenge).toBe(content);
    }
  });

  it("rejects when content does not start with 'bind:'", async () => {
    const event = makeBindingEvent("garbage-content");
    await expectBadRequest((svc) => svc.verifyChallenge(event, NEAR));
  });

  it("rejects when the challenge belongs to a different account", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const content = `bind:bob.near:${expiresAt}:near-nostr-bindings`;
    const event = makeBindingEvent(content);
    await expectBadRequest((svc) => svc.verifyChallenge(event, NEAR));
  });

  it("rejects expired challenges", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) - 10;
    const content = `bind:${NEAR}:${expiresAt}:near-nostr-bindings`;
    const event = makeBindingEvent(content);
    await expectBadRequest((svc) => svc.verifyChallenge(event, NEAR));
  });

  it("rejects when expiresAt parses to NaN", async () => {
    const content = `bind:${NEAR}:NaN:near-nostr-bindings`;
    const event = makeBindingEvent(content);
    await expectBadRequest((svc) => svc.verifyChallenge(event, NEAR));
  });

  it("rejects when the challenge has fewer than 4 segments", async () => {
    const content = `bind:${NEAR}:1234`;
    const event = makeBindingEvent(content);
    await expectBadRequest((svc) => svc.verifyChallenge(event, NEAR));
  });
});

describe("BindingService.prepareBindingWrite", () => {
  it("builds tx args for the KV write with current timestamp", () => {
    const exit = Effect.runSyncExit(
      withBinding((svc) =>
        svc.prepareBindingWrite({
          nostrPubkey: "npub1abc",
          relay: "wss://relay.test",
          proof: "proof-json",
          nearAccountId: NEAR,
        }),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.contractId).toBe("contextual.near");
      expect(exit.value.methodName).toBe("__fastdata_kv");
      expect(exit.value.key).toBe(`nostr/${NEAR}`);
      expect(exit.value.attachedDeposit).toBe("10000000000000000000000");
      expect(exit.value.gas).toBe("300000000000000");
      const parsed = JSON.parse(exit.value.value);
      expect(parsed.npub).toBe("npub1abc");
      expect(parsed.relay).toBe("wss://relay.test");
      expect(parsed.bound_at).toBeGreaterThan(Math.floor(Date.now() / 1000) - 5);
    }
  });
});
