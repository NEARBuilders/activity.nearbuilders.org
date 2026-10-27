import { Effect } from "effect";
import type { NostrResolvedConfig } from "./nostr-config";

const KV_TIMEOUT_MS = 5_000;

export type KvBindingEntry = {
  npub: string;
  relay: string;
  proof: string;
  bound_at: number;
};

export const readKvBindingEntry = (
  cfg: NostrResolvedConfig,
  nearAccountId: string,
): Effect.Effect<KvBindingEntry | null, never> =>
  Effect.tryPromise({
    try: async () => {
      const url = `${cfg.kvApiUrl}/v0/latest/${cfg.bindingContract}/${nearAccountId}/nostr/${nearAccountId}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(KV_TIMEOUT_MS) });
      if (!res.ok || res.status === 404) return null;
      const data = (await res.json()) as { entries?: Array<{ value?: unknown }> };
      const entry = data?.entries?.[0];
      if (!entry?.value) return null;
      return typeof entry.value === "string"
        ? (JSON.parse(entry.value) as KvBindingEntry)
        : (entry.value as KvBindingEntry);
    },
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed(null)));
