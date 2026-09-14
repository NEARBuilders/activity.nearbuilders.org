# Nostr plugin integration: surfaces available to Activity

Date: 2026-09-14. Researched for issue #33, to ground RFC #32 (Nostr publish-auth model) in the
plugin's actual capabilities rather than assumption. Distinct from
[`shared-nostr-activity-gaps.md`](./shared-nostr-activity-gaps.md), which covers the app-actor,
gateway-signed transport Activity events use (kind 1701 raw publish/query — RFC #32's option B/C
side). This document covers the user-actor, client-side-signed surfaces the plugin exposes for
identity and social content (option A), studied from
[nearbuilders.org PR #225](https://github.com/NEARBuilders/nearbuilders.org/pull/225) (open,
not yet merged, branch `nostr-remote-plugin`) — the one proven integration of this plugin pattern
in the NEARBuilders ecosystem. Both transports coexist against the same plugin; they are not
alternatives to each other.

## Plugin client surface

The plugin is already remote-loaded in this repo's `bos.config.json`
([wiring commit 49d4816](../../.bos/generated/plugins/nostr/contract.d.ts)), and the generated
contract at `.bos/generated/plugins/nostr/contract.d.ts` types the full `apiClient.nostr` surface —
13 procedures, more than PR #225 uses:

| Procedure | Used by PR #225 | Notes |
| --- | --- | --- |
| `createChallenge` | yes | Issues the kind-27235 binding challenge string. |
| `verifyBinding` | yes | Validates a signed challenge event, returns `{ valid, nearAccountId, nostrPubkey, proof }`. |
| `prepareBindingWrite` | yes | Returns the `__fastdata_kv` transaction args for the binding write. |
| `getBinding` | yes | Reads back `{ npub, relay, proof, boundAt }` by NEAR account — used both to check existing binding and to poll after a write. |
| `listRelays` | yes | Returns `{ relays: string[] }`; PR #225 uses `relays[0]` as the binding relay. |
| `listComments` | yes | `{ target, targetType, adapterType, enrich, requireBound, limit }` → paginated, enriched comment list. |
| `createComment` | yes | `{ event, target, targetType, adapterType }` → per-relay publish statuses. |
| `getIdentity` | no | `{ nearAccountId, enrichProfile }` → binding plus optional kind-0 profile in one call — likely a better fit than separate `getBinding` + `getProfile` calls for feed/leaderboard enrichment. |
| `getProfile` | no | Raw kind-0 profile lookup by pubkey — the primitive issue #33 flags for leaderboard/feed npub enrichment. |
| `listChannels` | no | Buzz-channel listing; unrelated to Activity's candidate surfaces. |
| `queryEvents` | no | Raw filtered query — this is the primitive `shared-nostr-activity-gaps.md` documents for Activity's own kind-1701 reads. |
| `publishEvent` | no | Raw signed publish — the app-actor primitive, not used by PR #225's user-actor flows. |
| `ping` | no | Health check. |

## Client-side signing layer

PR #225 adds `ui/src/lib/nostr/` (7 files, ~340 lines total), built on `nostr-tools` — already an
`api/` dependency in this repo (`nostr-tools@2.24.1`) but **absent from `ui/package.json`**, so
porting this layer requires adding it there first.

- **`keys.ts`** — `NostrSession = { mode: "extension" | "local"; pubkey; secretKeyHex? }`, persisted
  to `localStorage` under `nostr:session:<nearAccountId>` (scoped per NEAR account, not global).
  `generateAndStore`, `importAndStore` (nsec via `nip19Decode`), `connectExtensionAndStore`
  (NIP-07, pubkey-only — the extension always signs). `detectNostrExtension()` gates whether the UI
  offers the extension option at all.
- **`relay.ts`** — the `Signer` union (`{ mode: "local"; secretKey } | { mode: "extension" }`) and
  `signCommentEvent`, which builds the kind-1 comment event (tag contract below).
- **`bind.ts`** — `signBindingEvent` (kind 27235), `submitBindingWrite` (wallet tx, asserts the
  connected wallet account matches the account the challenge was issued for), `pollBinding`
  (2 s interval, 45 s default deadline, returns `null` on timeout rather than throwing).
- **`types.ts`**, **`nip19.ts`**, **`env.d.ts`**, **`index.ts`** — target-string helpers, bech32
  decode, `window.nostr` ambient type, barrel export.

None of this talks to a host-side proxy. Every `apiClient.nostr.*` call in PR #225 goes straight
from the browser to the plugin; signing never leaves the client. The only exception is the on-chain
KV write, which goes through the user's own wallet connector (`@hot-labs/near-connect`, already a
dependency in this repo's `ui/package.json`) — no server proxy for that either. `requireAuth` inside
the plugin (not this app) is what enforces authorization for the mutating comment/binding calls.

## Binding flow

```
createChallenge()                              → { challenge, expiresAt }
signBindingEvent(challenge, nearAccountId, signer)   → kind-27235 event, tags: [["p", nearAccountId]]
verifyBinding({ event })                        → { valid, nearAccountId, nostrPubkey, proof }
listRelays()                                     → pick relays[0]
prepareBindingWrite({ nostrPubkey, relay, proof }) → NEAR tx args for __fastdata_kv
submitBindingWrite(wallet, tx, nearAccountId)   → wallet.signAndSendTransaction, asserts account match
pollBinding(apiClient, nearAccountId)           → poll getBinding every 2s / up to 45s, null on timeout
```

The wallet-account-matches-challenge-account assertion in `submitBindingWrite` is the one binding
integrity check worth carrying over verbatim — it stops a signed challenge for account A from being
submitted under a wallet connected as account B.

## Tag contract (kind-1 comment events)

`signCommentEvent` in `relay.ts` builds exactly this tag set, which the plugin's `createComment`
validator checks server-side:

```
["t", <targetType>]           // e.g. "project" — enables relay #t filtering
["t", <clientName>]           // this app's client tag — see failure mode below
["client", <clientName>]      // NIP-24
["near_target", "<targetType>:<id>"]   // composite, validated server-side
["near_account", <nearAccountId>]      // makes requireBound/requireVerified possible
["e", <parentEventId>, "", "reply"]    // NIP-10, only when replying
```

`near_target` uses a composite `type:id` string (see `types.ts`'s `formatTargetString`/
`parseTargetString`) — Activity's own event model already has an analogous composite key shape in
its `s`/`t`/`n`/`i` filter tags (`shared-nostr-activity-gaps.md`), so this convention is at least
internally consistent across both integration points, not something PR #225 invented in isolation.

## The `clientName` failure mode

Confirmed first-hand in this repo, not just from the PR: the plugin's feed reads filter by `#t`
against the configured `clientName`. This app's `bos.config.json` sets
`plugins.nostr.variables.clientName = "activity.nearbuilders.org"`
([commit 49d4816](../../.bos/generated/plugins/nostr/contract.d.ts)) precisely because a mismatch
here doesn't error — `listComments`/`queryEvents` just come back empty, which looks identical to "no
comments yet" and is easy to misdiagnose as a relay or auth problem instead of a config typo. Any
future surface built on this plugin (comments, identity, anything using `#t`) must set `clientName`
to this app's own tag, not copy nearbuilders.org's `"nearbuilders.org"` value.

## Verification pattern

PR #225's own verification section: `bun install` regenerates plugin types from the live remote
contract, so typecheck runs against whatever is actually deployed, not a stale local copy. The
equivalent check in this repo is `bun run types:gen` followed by `bun run typecheck` — worth running
after any future plugin variable change here, since a broken `clientName` wouldn't fail typecheck,
only a broken *call shape* would. A live round-trip (publish a signed event through the exact
plugin filter, read it back, confirm tags survive) is the only way to catch the `clientName` class
of failure; typecheck alone won't.

## Surface map (documented, not built)

- **Comments on Activity events** — would need `target=<eventId>`, an Activity-specific
  `targetType` (e.g. `"activity-event"`), and a `requireBound` policy decision. Direct port of
  `nostr-feed.tsx`'s query/mutation shape; no server changes needed on Activity's side since
  everything routes through the plugin. RFC #32 axis: orthogonal to how Activity's own events are
  signed — this is a separate, optional social layer on top.
- **Nostr identity binding in settings** — a port of `NostrLink` (PR #225's actual component name;
  issue #33 called it `NostrIdentitySection`, which does not exist as written — worth using the real
  name if this gets its own ticket). This is a **prerequisite** for `requireBound` on comments
  regardless of which other surface ships, since `requireBound` reads the same binding this flow
  writes.
- **kind-0 profile enrichment** — `getProfile` (or `getIdentity` with `enrichProfile: true`, which
  does binding + profile in one round trip) to show real names/avatars next to npubs in the
  feed/leaderboard. Demo value only; feeds #31's UI work. `getIdentity` is likely the better
  primitive than PR #225's separate `getBinding`/profile-lookup pattern, since Activity would be
  doing both lookups together anyway.
- **Relay topology** — explicitly out of scope here per issue #33; RFC #32 Axis 2 decides whether
  the plugin's relay(s) (from `listRelays`) and Activity's own durable relay (`ACTIVITY_RELAY_URL`,
  currently `ws://127.0.0.1:7447` locally / the unresolvable `relay.nearbuilders.org` in
  production — see `activity-relay-503.md`) converge or stay separate. Nothing above assumes either
  answer.

## Recommendations for RFC #32

- The plugin's user-actor surfaces (comments, identity binding) are independent of whichever
  app-actor model (A/B/C) #32 picks for Activity's own signed events — they can ship on their own
  timeline without blocking or being blocked by that decision.
- If Activity adds any plugin-backed surface, `clientName` must be set correctly from the start;
  the failure mode is silent, not loud, and is the single most likely first bug.
- `getIdentity` is worth using over separately calling `getBinding` and a profile lookup, if/when
  profile enrichment is built.
- No implementation should start on any of these surfaces until #32 converges or a surface is
  green-lit independently, per issue #33's acceptance criteria.

## References

- [PR #225 (the pattern)](https://github.com/NEARBuilders/nearbuilders.org/pull/225) — head commit
  `0f23072`, branch `nostr-remote-plugin`, fork `Kampouse/nearbuilders.org`, open/unmerged.
- [Plugin repo](https://github.com/NEARBuilders/nostr.nearbuilders.org) · plugin PR #26.
- [`.bos/generated/plugins/nostr/contract.d.ts`](../../.bos/generated/plugins/nostr/contract.d.ts) —
  this repo's live typed surface.
- [`shared-nostr-activity-gaps.md`](./shared-nostr-activity-gaps.md) — the app-actor transport side.
- Issues #32 (primary — this study feeds it), #31, #12.
- Wiring commit `49d4816`.
