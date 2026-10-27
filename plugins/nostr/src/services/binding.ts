import { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { verifyEvent } from "nostr-tools/pure";
import { type KvBindingEntry, readKvBindingEntry } from "../lib/fastnear-kv";
import { NostrConfigTag, type NostrResolvedConfig } from "../lib/nostr-config";
import type { NostrProfile } from "../lib/schemas";
import type { NostrEvent } from "../nostr-core/types";

export type BindingEntry = KvBindingEntry;

export interface Identity {
  nearAccountId: string;
  nostrPubkey: string;
  relay: string;
  proof: string;
  boundAt: number;
  profile?: NostrProfile | null;
}

export interface BindingWriteArgs {
  contractId: string;
  methodName: "__fastdata_kv";
  key: string;
  value: string;
  args: Record<string, string>;
  gas: string;
  attachedDeposit: string;
}

export interface Challenge {
  challenge: string;
  expiresAt: number;
}

export interface VerifiedChallenge {
  valid: boolean;
  nostrPubkey: string;
  proof: string;
}

export interface BindingServiceShape {
  readonly getBinding: (nearAccountId: string) => Effect.Effect<BindingEntry | null, never>;
  readonly getBindingOutput: (
    nearAccountId: string,
  ) => Effect.Effect<
    { npub: string; relay: string; proof: string; boundAt: number } | null,
    ORPCError<"BAD_REQUEST", unknown>
  >;
  readonly getIdentity: (
    nearAccountId: string,
    enrichProfile?: boolean,
  ) => Effect.Effect<Identity | null, ORPCError<"BAD_REQUEST", unknown>>;
  readonly getProfile: (pubkey: string) => Effect.Effect<Identity["profile"] | null, never>;
  readonly createChallenge: (nearAccountId: string) => Effect.Effect<Challenge, never>;
  readonly verifyChallenge: (
    event: Omit<NostrEvent, "kind">,
    nearAccountId: string,
  ) => Effect.Effect<VerifiedChallenge, ORPCError<"BAD_REQUEST", unknown>>;
  readonly prepareBindingWrite: (params: {
    nostrPubkey: string;
    relay: string;
    proof: string;
    nearAccountId: string;
  }) => Effect.Effect<BindingWriteArgs, never>;
}

export class BindingService extends Context.Service<BindingService, BindingServiceShape>()(
  "nostr/BindingService",
) {}

const readKv = (
  cfg: NostrResolvedConfig,
  nearAccountId: string,
): Effect.Effect<BindingEntry | null, never> => readKvBindingEntry(cfg, nearAccountId);

const readProfile = (relays: string[], pubkey: string): Effect.Effect<NostrProfile | null, never> =>
  Effect.tryPromise({
    try: async () => {
      const relay = relays[0];
      if (!relay) return null;
      const res = await fetch(relay, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(["REQ", "profile", { kinds: [0], authors: [pubkey], limit: 1 }]),
      });
      if (!res.ok) return null;
      const text = await res.text();
      const line = text.split("\n").find((l) => l.startsWith('["EVENT"'));
      if (!line) return null;
      const event = JSON.parse(line) as { content?: string };
      if (!event.content) return null;
      const parsed = JSON.parse(event.content) as Omit<NostrProfile, "pubkey">;
      return { pubkey, ...parsed };
    },
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed(null)));

const badRequest = (message: string): ORPCError<"BAD_REQUEST", unknown> =>
  new ORPCError("BAD_REQUEST", { message, data: {} });

export const BindingServiceLive = Layer.effect(
  BindingService,
  Effect.gen(function* () {
    const cfg = yield* NostrConfigTag;

    const getBinding = (nearAccountId: string) => readKv(cfg, nearAccountId);

    const getBindingOutput: BindingServiceShape["getBindingOutput"] = (nearAccountId) =>
      Effect.gen(function* () {
        const entry = yield* getBinding(nearAccountId);
        if (!entry) return null;
        return {
          npub: entry.npub,
          relay: entry.relay,
          proof: entry.proof,
          boundAt: entry.bound_at,
        };
      });

    const getIdentity: BindingServiceShape["getIdentity"] = (nearAccountId, enrichProfile = true) =>
      Effect.gen(function* () {
        const binding = yield* getBinding(nearAccountId);
        if (!binding) return null;
        const result: Identity = {
          nearAccountId,
          nostrPubkey: binding.npub,
          relay: binding.relay,
          proof: binding.proof,
          boundAt: binding.bound_at,
        };
        if (enrichProfile) {
          result.profile = yield* readProfile(cfg.standardRelays, binding.npub);
        }
        return result;
      });

    const getProfile = (pubkey: string) => readProfile(cfg.standardRelays, pubkey);

    const createChallenge: BindingServiceShape["createChallenge"] = (nearAccountId) =>
      Effect.sync(() => {
        const expiresAt = Math.floor(Date.now() / 1000) + cfg.challengeExpirySeconds;
        return {
          challenge: `bind:${nearAccountId}:${expiresAt}:near-nostr-bindings`,
          expiresAt,
        };
      });

    const verifyChallenge: BindingServiceShape["verifyChallenge"] = (event, nearAccountId) =>
      Effect.gen(function* () {
        const kind27235: NostrEvent = { ...event, kind: 27235 };
        if (!verifyEvent(kind27235)) {
          return yield* Effect.fail(badRequest("Invalid Nostr event signature"));
        }
        const challenge = event.content;
        if (!challenge?.startsWith("bind:")) {
          return yield* Effect.fail(badRequest("No binding challenge found in event content"));
        }
        const parts = challenge.split(":");
        if (parts.length !== 4 || parts[0] !== "bind" || parts[1] !== nearAccountId) {
          return yield* Effect.fail(
            badRequest("Challenge does not match the authenticated account"),
          );
        }
        const expiresAt = parseInt(parts[2]!, 10);
        if (Number.isNaN(expiresAt) || Math.floor(Date.now() / 1000) > expiresAt) {
          return yield* Effect.fail(badRequest("Challenge expired"));
        }
        const proof = JSON.stringify({
          nostrPubkey: event.pubkey,
          challenge,
          eventId: event.id,
          verifiedBy: nearAccountId,
          verifiedAt: Math.floor(Date.now() / 1000),
        });
        return {
          valid: true,
          nostrPubkey: event.pubkey,
          proof,
        };
      });

    const prepareBindingWrite: BindingServiceShape["prepareBindingWrite"] = (params) =>
      Effect.sync(() => {
        const key = `nostr/${params.nearAccountId}`;
        const value = JSON.stringify({
          npub: params.nostrPubkey,
          relay: params.relay,
          proof: params.proof,
          bound_at: Math.floor(Date.now() / 1000),
        });
        return {
          contractId: cfg.bindingContract,
          methodName: "__fastdata_kv",
          key,
          value,
          args: { [key]: value },
          gas: "300000000000000",
          attachedDeposit: "10000000000000000000000",
        };
      });

    return {
      getBinding,
      getBindingOutput,
      getIdentity,
      getProfile,
      createChallenge,
      verifyChallenge,
      prepareBindingWrite,
    } as const;
  }),
);
