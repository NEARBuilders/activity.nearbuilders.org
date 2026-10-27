import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { NostrConfigLive, type NostrResolvedConfig } from "../src/lib/nostr-config";
import {
  BuzzAdapterLive,
  BuzzAdapterService,
  StandardAdapterLive,
} from "../src/nostr-core/adapters";
import { NostrCommentService, NostrCommentServiceLive } from "../src/services/nostr";

const baseCfg: NostrResolvedConfig = {
  relays: [],
  clientName: "test",
  kvApiUrl: "https://kv.test",
  bindingContract: "contextual.near",
  standardRelays: ["wss://relay.invalid"],
  buzzRelays: [],
  buzzSecretKey: undefined,
  challengeExpirySeconds: 300,
};

const cfgWithBuzz: NostrResolvedConfig = {
  ...baseCfg,
  buzzRelays: ["wss://relay.invalid"],
  buzzSecretKey: new Uint8Array(32).fill(7),
};

const CommentLiveTestLayer = (cfg: NostrResolvedConfig) =>
  NostrCommentServiceLive.pipe(
    Layer.provide(BuzzAdapterLive),
    Layer.provide(StandardAdapterLive),
    Layer.provide(NostrConfigLive(cfg)),
  );

const runCommentsWith = <A, E>(
  cfg: NostrResolvedConfig,
  build: (svc: typeof NostrCommentService.Service) => Effect.Effect<A, E, never>,
) =>
  Effect.runPromiseExit(
    Effect.flatMap(NostrCommentService, build).pipe(Effect.provide(CommentLiveTestLayer(cfg))),
  );

describe("BuzzAdapterService", () => {
  it("yields None when buzz is not configured", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(BuzzAdapterService, (svc) => Effect.succeed(svc)).pipe(
        Effect.provide(Layer.provide(BuzzAdapterLive, NostrConfigLive(baseCfg))),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const value = exit.value;
      expect(Option.isNone(value)).toBe(true);
    }
  });

  it("constructs exactly one BuzzAdapter instance per service scope", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const first = yield* BuzzAdapterService;
        const second = yield* BuzzAdapterService;
        return { first, second };
      }).pipe(Effect.provide(Layer.provide(BuzzAdapterLive, NostrConfigLive(cfgWithBuzz)))),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { first, second } = exit.value;
      expect(Option.isSome(first)).toBe(true);
      expect(Option.isSome(second)).toBe(true);
      if (Option.isSome(first) && Option.isSome(second)) {
        expect(second.value).toBe(first.value);
      }
    }
  });
});

describe("NostrCommentService failure modes", () => {
  it("returns BAD_REQUEST asking for buzz when buzz is not configured", async () => {
    const exit = await runCommentsWith(baseCfg, (svc) =>
      svc.listComments({
        target: "test-nostr-page",
        targetType: "project",
        adapterType: "buzz",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const squashed = Cause.squash(exit.cause);
      expect(squashed).toMatchObject({ code: "BAD_REQUEST" });
      expect(String((squashed as Error).message)).toMatch(/buzz.*not configured/);
    }
  });

  it("listComments returns an empty list without throwing when the relay query is unhealthy", async () => {
    const exit = await runCommentsWith(baseCfg, (svc) =>
      svc.listComments({
        target: "test-nostr-page",
        targetType: "project",
        adapterType: "standard",
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([]);
    }
  });
});
