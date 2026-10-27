import { Context, Effect, Layer } from "effect";
import { NostrConfigTag } from "../../lib/nostr-config";
import { StandardAdapter } from "./standard";

export class StandardAdapterService extends Context.Service<
  StandardAdapterService,
  StandardAdapter
>()("nostr/StandardAdapter") {}

export const StandardAdapterLive = Layer.effect(
  StandardAdapterService,
  Effect.acquireRelease(
    Effect.gen(function* () {
      const { standardRelays } = yield* NostrConfigTag;
      return new StandardAdapter(standardRelays);
    }),
    (adapter) => Effect.sync(() => adapter.close()),
  ),
);
