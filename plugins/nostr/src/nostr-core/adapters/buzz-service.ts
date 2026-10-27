import { createHash } from "node:crypto";
import { Context, Effect, Layer, Option } from "effect";
import { NostrConfigTag } from "../../lib/nostr-config";
import { BuzzAdapter } from "./buzz";

/**
 * Single BuzzAdapter instance per plugin lifetime. Previously `getAdapter("buzz")`
 * in NostrCommentService constructed a fresh adapter on every call (each with
 * its own WebSocket connections) and never closed the per-call instances. The
 * layer-scoped service here constructs ONCE and the framework's scope cleanup
 * closes it on plugin shutdown.
 *
 * Service value is Option<BuzzAdapter>: None when BUZZ_NSEC/BUZZ_RELAYS are not
 * configured. The plugin still initializes cleanly in standard-only mode; the
 * NostrCommentService.getAdapter helper short-circuits with a BAD_REQUEST in
 * that case.
 */
export class BuzzAdapterService extends Context.Service<
  BuzzAdapterService,
  Option.Option<BuzzAdapter>
>()("nostr/BuzzAdapter") {}

const resolveChannel = (target: string): string =>
  createHash("sha256").update(target).digest("hex").slice(0, 16);

export const BuzzAdapterLive = Layer.effect(
  BuzzAdapterService,
  Effect.gen(function* () {
    const { buzzRelays, buzzSecretKey } = yield* NostrConfigTag;
    if (!buzzRelays.length || !buzzSecretKey) {
      return Option.none();
    }
    const adapter = new BuzzAdapter({
      relays: buzzRelays,
      secretKey: buzzSecretKey,
      resolveChannel,
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => adapter.close()));
    return Option.some(adapter);
  }),
);
