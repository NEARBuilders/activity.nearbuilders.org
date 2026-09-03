# Activity event relay `503` investigation

Date: 2026-09-03

## Executive conclusion

The local `POST /api/v1/events` failure had **two separate causes in sequence**:

1. The public gateway loaded `activityRelayUrl` from `bos.config.json`, where it is
   `wss://relay.nearbuilders.org`. That hostname currently has no DNS record. The standalone API's
   `plugin.dev.ts` default of `ws://127.0.0.1:7447` does not configure the API remote after it is
   loaded by the gateway. The new `resolveActivityRelayUrl()` runtime override correctly fixes this
   configuration split for local gateway testing and should remain.
2. Once `ACTIVITY_RELAY_URL=ws://127.0.0.1:7447` made the gateway reach the local relay, the
   Module Federation API bundle crashed while masking the Nostr `EVENT` frame:
   `TypeError: bufferUtil.mask is not a function`. `every-plugin@2.10.1` configures Rspack's
   `resolve.fallback` with `bufferutil: false`. Rspack therefore bundles an empty ignored module;
   `ws@8.21.3` treats the successful import of that empty object as the optional native addon and
   calls its nonexistent `mask()` function for payloads of at least 48 bytes.

The immediate, deterministic repository fix is to compile the API bundle with
`process.env.WS_NO_BUFFER_UTIL` (and defensively `WS_NO_UTF_8_VALIDATE`) defined as a truthy string
using Rspack's `DefinePlugin`. The durable ecosystem fix belongs in `EveryPluginDevServer`: remove
the `false` fallbacks and disable these optional accelerators with `DefinePlugin` instead. A runtime
`WS_NO_BUFFER_UTIL=1` is a proven temporary workaround, but relying on a host environment variable
forever is weaker than fixing the bundle.

No Xcode installation and no native `bufferutil` installation are required.

## What the client-visible error means

The ingestion service intentionally catches every relay-publish error and maps it to the public
`503 Service Unavailable` response, “Activity relay did not acknowledge the event”
([local source](../../api/src/services/activity-ingestion.ts#L140-L146)). That message correctly
states that publication did not complete, but it hides whether the cause was DNS, connection,
protocol acknowledgement, or a client-library exception. The underlying gateway exception in this
incident was `TypeError: bufferUtil.mask is not a function`.

The database reservation and signed event are created before publication. A relay failure therefore
leaves the reservation retryable; retrying the same request must reuse the same signed event rather
than minting another event.

## Confirmed evidence

### 1. The URL override solved the first failure

- `bos.config.json` configures both the binding relay and publication relay as
  `wss://relay.nearbuilders.org` ([local config](../../bos.config.json#L22-L27)).
- `plugin.dev.ts` defaults the standalone API to `ws://127.0.0.1:7447`, but this configuration file
  is not the gateway runtime's source of API variables
  ([local config](../../api/plugin.dev.ts#L18-L29)).
- A DNS lookup on 2026-09-03 returned `ENOTFOUND` for `relay.nearbuilders.org`. An HTTPS request to
  the same hostname likewise failed before connection. In contrast,
  `https://nostr.nearbuilders.org` returned an HTML application response; that is evidence of the
  existing Nostr app, not evidence that the hostname is a NIP-01 relay endpoint.
- The in-progress `resolveActivityRelayUrl(configuredUrl, runtimeOverride)` trims and prefers
  `ACTIVITY_RELAY_URL`, then falls back to the typed BOS variable
  ([resolver](../../api/src/activity/activity-config.ts),
  [use in initialization](../../api/src/index.ts#L105-L113)). Its unit tests cover the override and
  blank/absent fallback cases ([tests](../../api/tests/activity-config.test.ts)).
- Starting the gateway with `ACTIVITY_RELAY_URL=ws://127.0.0.1:7447` changed the failure from DNS to
  an attempted local WebSocket publish. This proves the override is active in the gateway-loaded API
  remote.

### 2. `ws` has a correct JavaScript fallback before bundling

`bufferutil` is an optional peer dependency of `ws`, used only as a performance accelerator. The
`ws` documentation explicitly supports disabling it with `WS_NO_BUFFER_UTIL`
([official `ws` documentation](https://github.com/websockets/ws/blob/c791e707eab3c13dd9a261d2479c3cc4a49a6fed/README.md#opt-in-for-performance)).

In `ws@8.21.3`, `lib/buffer-util.js` first exports JavaScript implementations of `mask` and
`unmask`. Unless `WS_NO_BUFFER_UTIL` is set, it then tries `require("bufferutil")`. A normal missing
module throws inside the surrounding `try/catch`, leaving the JavaScript implementations intact.
If the import succeeds, `ws` installs wrappers that call the addon's `mask` for payloads of 48 bytes
or more and `unmask` for payloads of 32 bytes or more
([tagged `ws` source](https://github.com/websockets/ws/blob/c791e707eab3c13dd9a261d2479c3cc4a49a6fed/lib/buffer-util.js#L106-L130)).

Client-to-server WebSocket frames must be masked, so this code path is expected during a Nostr
publish, not an unusual relay behavior
([RFC 6455 sections 5.3 and 6.1](https://www.rfc-editor.org/rfc/rfc6455.html#section-5.3)).

### 3. The API bundle changes “missing module” into “empty module”

The installed and current upstream `EveryPluginDevServer` sets these fallbacks:

```ts
compiler.options.resolve.fallback = {
  ...compiler.options.resolve.fallback,
  bufferutil: false,
  "utf-8-validate": false,
};
```

([immutable upstream source](https://github.com/NEARBuilders/everything-dev/blob/129de64ea817b32a01b4026bbdbada71cca99d41/packages/every-plugin/src/build/rspack/plugin.ts#L242-L246))

Rspack documents `resolve.fallback` as a redirect used when normal resolution fails; a `false`
fallback means do not include that module/polyfill
([webpack-compatible resolve documentation](https://webpack.js.org/configuration/resolve/#resolvefallback)).
In the generated API bundle, that becomes an ignored module with no exports. The transformed
`ws` code is effectively:

```js
const bufferUtil = __webpack_require__("?dd62");
// module ?dd62: /* (ignored) */
```

The require no longer throws, so the `ws` catch block does not run. `bufferUtil` is `{}`, the wrapper
replaces the working JavaScript `mask`, and a Nostr `EVENT` frame is large enough to execute
`bufferUtil.mask(...)`. The crash occurs before the frame reaches the relay.

### 4. Controlled reproduction distinguishes the fixes

A minimal Rspack build of the installed `ws@8.21.3` was tested against the already-running local
relay with a 100-byte client message:

| Bundle/runtime configuration | Result |
| --- | --- |
| `resolve.fallback: { bufferutil: false }` | `TypeError: bufferUtil.mask is not a function` |
| Same bundle with runtime `WS_NO_BUFFER_UTIL=1` | message sent |
| `bufferutil` externalized as CommonJS, package absent | message sent using `ws`'s JavaScript fallback |

The real gateway was then restarted with only `WS_NO_BUFFER_UTIL=1`. The same authenticated event
request changed from `503` to `200`, and an identical retry returned the same event ID. That proves
all of the following at once:

- the source key, source approval, event-type allowlist, signing, database reservation, and local
  relay are valid;
- the bundled `bufferutil` branch was the remaining local publication failure; and
- idempotent retry reused the stored signed event as designed.

No credential values were recorded in this report.

## Why Vitest and the direct integration test pass

The API Vitest configuration tests source files and explicitly excludes `dist`
([local config](../../api/vitest.config.ts)). Those tests resolve the installed Node `ws` package
directly. This workspace does not have `bufferutil` installed, so Node's real
`require("bufferutil")` throws and `ws` keeps its built-in JavaScript mask implementation.

The gateway takes a different execution path: it loads the Rspack/Module Federation artifact in
which the missing optional package was replaced by an empty module. The existing integration test
therefore validates the relay protocol and unbundled adapter, but cannot catch this packaging defect.

`nostr-tools` is being used as its maintainers document for Node: install `ws`, pass it to
`useWebSocketImplementation`, and use `SimplePool`
([tagged `nostr-tools` guidance](https://github.com/nbd-wtf/nostr-tools/blob/fed4a5561398a93dfae0663089b7196e4d6e534f/README.md#L123-L130)).
The adapter choice is not the root cause.

## Recommended exact changes

### A. Repository-level fix now

In `api/rspack.config.js`, import `rspack` from `@rspack/core` and add this plugin to the shared
`baseConfig.plugins` array so it applies to both development and deployed builds:

```js
import { rspack } from "@rspack/core";

new rspack.DefinePlugin({
  "process.env.WS_NO_BUFFER_UTIL": JSON.stringify("1"),
  "process.env.WS_NO_UTF_8_VALIDATE": JSON.stringify("1"),
});
```

Rspack's `DefinePlugin` performs exact compile-time replacement and recommends defining individual
`process.env.KEY` names rather than replacing the whole `process` object
([official Rspack documentation](https://rspack.dev/plugins/webpack/define-plugin)). This causes the
optional-addon branches to be false in every environment and preserves `ws`'s built-in JavaScript
implementation. It requires no native addon, compiler toolchain, or host runtime flag.

This repository file warns that `bos sync`/`bos upgrade` can overwrite it, so this is a necessary
local guard, not the final ecosystem repair.

### B. Upstream `every-plugin` fix

Open an issue/PR in `NEARBuilders/everything-dev` for `EveryPluginDevServer.configureDefaults()`:

1. Remove the `bufferutil: false` and `utf-8-validate: false` `resolve.fallback` entries.
2. If the intended policy is to avoid optional native addons, add the same two exact
   `DefinePlugin` constants through `compiler.webpack.DefinePlugin`. That expresses the intent in
   the mechanism supported by `ws` instead of impersonating a successfully loaded addon.
3. Add a bundle-level regression test that loads `ws` from the emitted artifact and sends a client
   frame longer than 48 bytes.
4. Release `every-plugin`, upgrade this repository, then remove the repository-level duplicate once
   the emitted bundle is verified.

No matching open or closed issue was found in `NEARBuilders/everything-dev` on 2026-09-03, and its
current `main` branch still contains the faulty fallbacks.

### C. Keep the Activity relay URL override

Keep `api/src/activity/activity-config.ts`, its tests, and the call from API initialization. It fixes
a separate real problem: `plugin.dev.ts` configures the standalone API, while the public gateway
loads the API remote with BOS runtime variables. Without this override, local requests on port 3000
return to the nonexistent production relay hostname.

The production behavior remains controlled: if `ACTIVITY_RELAY_URL` is absent or blank, the code
uses `config.variables.activityRelayUrl`. Deployment configuration should ensure an accidental host
environment value cannot redirect production publication. Longer term, everything.dev could expose
environment-specific non-secret API variables so this override can live entirely in resolved BOS
configuration.

### D. Temporary runtime workaround

Until a rebuilt API bundle contains the repository guard, start the host with:

```bash
WS_NO_BUFFER_UTIL=1
```

This workaround is proven, but must be present in the **host process that evaluates the remote**.
Setting it only for a standalone API process does not protect requests served by the port-3000
gateway.

## Alternatives assessed

| Option | Assessment |
| --- | --- |
| Externalize `bufferutil` and `utf-8-validate` as CommonJS | Technically valid and reproduced successfully. Rspack emits runtime `require()` calls; when packages are absent, `ws` catches the error and uses JavaScript. Rspack documents CommonJS externalization as preserving a runtime `require()` ([official docs](https://rspack.dev/config/externals)). Less deterministic for a remotely loaded plugin because behavior depends on packages visible to the host. |
| Install `bufferutil` | Not required and not recommended as the incident fix. It adds a native binary/deployment concern merely to compensate for a bundler stub. Rspack notes that native `.node` addons need explicit asset/runtime handling ([Node application guide](https://rspack.dev/guide/integrations/node)). |
| `resolve.alias: { bufferutil: false }` | Not a fix. It has the same empty/ignored-module problem: the import succeeds rather than throwing. |
| Use `globalThis.WebSocket` | Viable only after raising and enforcing the runtime floor. This repo permits Node `>=20.11`, where WebSocket is experimental and flag-gated; it becomes unflagged in Node 22.0 and stable in 22.4 ([Node documentation](https://nodejs.org/download/release/latest-v20.x/docs/api/globals.html#class-websocket)). It also diverges from `nostr-tools`' documented Node setup. |
| Patch `node_modules/every-plugin` | Not durable; reinstalling dependencies removes it. The correction belongs upstream. |

Disabling the optional accelerator changes performance, not WebSocket or Nostr semantics. For this
API's small event frames, correctness and portable deployment outweigh the optional native masking
optimization. Load testing should still be performed before high-volume production rollout.

## Verification plan after implementation

1. Add a focused bundle regression test: build with the real API Rspack configuration, load the
   emitted remote, and send a WebSocket client frame larger than 48 bytes to a local server. This is
   the seam the current Vitest suite misses.
2. Inspect the emitted development and production bundles. The `ws` optional-addon branch should be
   compiled false or absent; there must be no live ignored `bufferutil` stub feeding the wrapper.
3. Run API unit/integration tests, typecheck, lint, and build.
4. Start local infrastructure, then start the public gateway on port 3000 with
   `ACTIVITY_RELAY_URL=ws://127.0.0.1:7447`. The compile-time fix should make
   `WS_NO_BUFFER_UTIL` unnecessary.
5. Retry the already-reserved request with the exact same body and idempotency key. Expect `200` and
   the same event ID; retry once more and expect that ID again.
6. Query the local relay by event ID/tags and confirm one immutable event is present.
7. Repeat the gateway test against a production-mode local build, because development-only source
   tests do not exercise the deployed artifact.

## External blockers and non-blockers

### Local issue #4 testing

There is no external blocker after applying the bundle guard. The local relay is already available
on port 7447, the runtime environment workaround produced `200`, and idempotency was verified.

### Production deployment

There is an external infrastructure blocker: `relay.nearbuilders.org` does not currently resolve.
Before production publication can work, the team must either:

- deploy the planned durable Nostr relay and create the DNS/TLS/WebSocket endpoint; or
- approve a different operational relay URL and update both `activityRelayUrl` and, where binding
  metadata should advertise the same relay, `activityNostrBindingRelay`.

The production checklist already requires durable storage, backups, health checks, rate limits,
kind/tag indexing, and monitoring ([protocol requirements](../activity-protocol.md#production-requirements)).
`nostr.nearbuilders.org` being an existing repository/application does not by itself satisfy those
relay-service requirements.

The upstream `every-plugin` release is **not** a blocker for this repository once the local
`DefinePlugin` guard is committed. It is required to prevent the same class of failure in other
every-plugin API remotes and to make the guard survive future template synchronization.
