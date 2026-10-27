# @every-plugin/template

## 1.1.0

### Minor Changes

- 67e2959: Comments UI integration: server-owned near_target convention + createComment tag validation. Behaviour changes called out below.

  ## near_target convention

  Previously the plugin echoed target raw into the near_target tag while the deployed testbench publishes a composite "type:id" key, so each reader sees its own events but not the other. The plugin now composes nearTargetKey(targetType, target) as "type:id" in one helper (nostr-core/types.ts), consumed by:

  - standard.ts buildTags near_target value
  - standard.ts query and subscribe client-side near_target filter
  - buzz.ts buildTags near_target value (channel derivation unchanged)

  Callers still pass separate target and targetType inputs to createComment and listComments; the convention is enforced server-side. UI testbench events (already composite) remain visible; plugin-published events become composite too.

  ## clientName for listComments

  listComments was hardcoding "near-nostr-sdk" as the clientName query argument. Now reads cfg.clientName (default nostr.nearbuilders.org), consistent with the t-tag value clients sign.

  ## createComment validate-before-publish

  createComment now rejects (400) signed events whose near_target tag is absent or does not match composite(targetType, target). Previously it would publish the mismatched event and clients would silently never see it back in listComments.

  Helper exported as assertCommentTagsMatchRequest for direct unit testing; 7 new tests cover the validator.

  ## Route renames (procedure keys; HTTP paths unchanged)

  The legacy V1 suffix on four procedure keys is dropped now that the legacy DB-backed names it was avoiding collisions with were deleted (PR #8). Renamed:

  - `getBindingV1` -> `getBinding`
  - `getIdentityV1` -> `getIdentity`
  - `listCommentsV1` -> `listComments`
  - `getProfileV1` -> `getProfile`

  HTTP paths under `/v1/*` stay as-is: the `v1` prefix is honest API versioning, and PR #8 confirmed `nearbuilders.org` UI consumes these paths in production (e.g. `nostr-feed.tsx` hitting `/v1/comments`). External raw-fetch consumers are unaffected; typed oRPC clients that imported these procedures must update the method name.

  ## Out of scope

  The kind assertion is intentionally permissive (any kind preserves existing kind 1 + 1111 compatibility). Buzz channel derivation via resolveChannel keeps hashing the raw target so existing buzz channel ids are unchanged.

  UI wiring (ticket 12) lands in a follow-up PR consuming the convention.

- 5374425: Plugin hardening: scoped buzz adapter, auth on mutations, removal of the unsound derived-key path. Breaking changes documented below.

  ## Adapter lifecycle

  `getAdapter("buzz")` previously constructed a fresh BuzzAdapter (own WebSocket connections) on every call and never closed it; the service finalizer created and closed a brand-new instance (a no-op). The adapter is now a single scoped resource: new `BuzzAdapterLive` layer (`nostr-core/adapters/buzz-service.ts`) builds one instance at plugin initialize and closes it on shutdown, exposed as `Option<BuzzAdapter>` so the plugin still initializes in standard-only mode when BUZZ_NSEC is unset.

  ## Error channels

  `getAdapter` now returns an Effect and call sites `yield*` it. A synchronous `throw` inside `Effect.gen` is converted by the runtime into an untyped defect (Die), which bypasses `catchAll`/`flattenError` — "buzz not configured" surfaced as 500 instead of the intended 400; it is now a typed `ORPCError<"BAD_REQUEST">` (400), and the `listChannels` contract route declares `.errors({ BAD_REQUEST })` accordingly.

  ## Read-path fail-soft, observable

  The `tryPromise` catch + `orElseSucceed` double-fallback on `listComments`, `listChannels`, `rawQuery`, `getProfile` and the profile-enrich loop collapses into a single `Effect.catchAll` that logs the swallowed error at WARNING before returning the empty fallback.

  ## Breaking: auth required on mutations

  `createComment` now requires an authenticated session with a connected NEAR account (`requireAuth` + `requireNearAccount`); `publishEvent` requires an authenticated session. Unauthenticated calls receive 401. This closes the open-relay-proxy spam vector flagged when the parity routes landed (PR #6). Reads (`listComments`, `getBinding`, `queryEvents`, `listChannels`, `getProfile`, `listRelays`, `ping`) remain open. The first-party UI is unaffected (cookie-based session, publish already required a NEAR sign-in).

  ## Breaking: getPublicKey route removed

  `GET /nostr/keys` and the underlying `key-derivation.ts` are removed. The derivation hashed a guessable seed — `sha256(accountId + userId)` — so anyone could reconstruct any account's derived Nostr secret key offline (impersonation). The route was unused by the first-party UI; the identity mechanism is the browser-generated key linked via the binding challenge flow (challenge → verify → on-chain FastNear KV write). Consumers of this route must generate keys client-side instead.

  ## Dead code removed

  `nostr-core/core.ts` + `core-service.ts` (unwired since the StandardAdapterService consolidation) and `nostr-core/signers/` (server-side signer class; signing belongs to the client). The `NostrSubscription` type moved to `nostr-core/types.ts`.

  ## Test suite

  40 tests: +4 (comment-service: scoped adapter stability, buzz-unconfigured 400, fail-soft empty on relay failure), −9 (key-derivation removed with its module).

### Patch Changes

- d643396: Add Vitest coverage to close out #3 (the kind-27235 binding primitives shipped via #6 + #8 + #9).

  - New `plugins/nostr/vitest.config.ts` (Node env, scoped to `tests/**/*.test.ts`).
  - Four new test files under `plugins/nostr/tests/`:
    - `key-derivation.test.ts` — `deriveNostrPubkey` determinism, account isolation, parity with `nostr-tools/getPublicKey`; `deriveNostrSecretKey` shape; hex-input parity.
    - `event-verification.test.ts` — kind-27235 signing & `verifyEvent` regressions. Uses a `cloneMinus` helper that strips the `verifiedSymbol` cache so tamper tests actually exercise the recomputation path.
    - `challenge.test.ts` — `BindingService.createChallenge` shape and TTL; `verifyChallenge` happy path + five rejection paths (no `bind:` prefix, wrong account, expired, NaN expiry, fewer than 4 segments); `prepareBindingWrite` tx-arg shape.
    - `binding-read.test.ts` — `BindingService.getBinding` & `getBindingOutput` against a mocked `fetch`: stringified/object values, empty entries, missing value, 404, 500, malformed JSON, network error, abort, URL shape, plus the camelCase mapping done by `getBindingOutput`.

  Tests run via the plugin's existing `vitest run --passWithNoTests` script (39/39 pass locally, no network required).

- da2a683: Refactor services to Effect `Context.Tag` pattern (`BindingService`, `NostrCommentService`), align auth middleware with `createAuthMiddleware` factory, and clean up orphans left by [#8](https://github.com/NEARBuilders/nostr.nearbuilders.org/pull/8).

  - `binding.ts`: rewrite as `BindingService` service with `Effect.tryPromise` for KV reads, `Effect.fail(ORPCError)` for verification failures, configurable via `NostrConfigTag`
  - `nostr.ts`: rewrite as `NostrCommentService` service with `Effect.scoped` + `Effect.acquireRelease` for relay pool lifecycle and `Effect.forEach` for parallel relay publishing
  - `nostr-config.ts`: consolidate KV binding, standard relays, Buzz relays, nsec decoding into a single resolved config layer (was spread across constructor args in services)
  - nsec decoding now uses `nostr-tools/nip19.decode` (drops the inline bech32 parser)
  - `verifyEvent` hoisted to a static top-level import (no longer dynamically imported per-request)
  - `index.ts`: hand-rolled `requireAuth` middleware replaced with `createAuthMiddleware(builder).requireAuth`; binding flows now chain `requireAuth → requireNearAccount` so handlers read `context.nearAccountId` directly (typed). UNAUTHORIZED responses now include `data: { hint: "Sign in to continue" }`
  - `bos.config.json`: drop empty `NOSTR_DATABASE_URL` secret for the nostr plugin (was orphaned by #8)
  - `.env.example`: drop `NOSTR_DATABASE_URL=...` (orphaned by #8)
  - `plugins/nostr/rspack.config.js`: drop `DrizzleORMMigrations` plugin load and `pg`/`pglite` webpack externals (dead code after #8)
  - `plugins/nostr/src/global.d.ts`: replace the `virtual:drizzle-migrations.sql` ambient module declaration (orphan from #8) with an empty stub

  Wire-level change: UNAUTHORIZED errors now include `data: { hint: "Sign in to continue" }`. Public handler shapes unchanged otherwise.

- 1ebf641: Root-cause cleanup of the nostr plugin (audit-driven; no behaviour changes in the public wire contract unless called out below).

  ## Type unification

  `plugins/nostr/src/nostr-core/types.ts` now re-exports `Event` and `Filter` from `nostr-tools/core` and `nostr-tools/filter` as `NostrEvent` / `NostrFilter`. Since nostr-tools' `[verifiedSymbol]` brand is optional, the types are mutually assignable, which kills 20+ `as any` / `as unknown as NostrEvent` casts across `nostr-core/{standard,buzz,core}.ts` and `services/nostr.ts`. `pool.publish` accepts `Event` (not `VerifiedEvent`); the only place a real guard was needed is `publishSigned`, where a real `verifyEvent` check now runs before the publish — replacing an `as any` and incidentally closing a gap where `createComment` was publishing unverified signatures.

  ## Wire types via `z.infer`

  New `plugins/nostr/src/lib/schemas.ts` defines `ProfileSchema`, `CommentProfileSchema`, `NostrCommentSchema`, `RelayStatusSchema`, `PublishResultSchema`, `ChannelInfoSchema`. Contract (`contract.ts`) and services (`binding.ts`, `nostr.ts`, `standard.ts`) both consume them, eliminating the hand-maintained parallel interface that could drift. Comment profile is intentionally a separate schema from the standalone profile (kind-1 notes don't carry their own pubkey; the `getProfile` endpoint shape does).

  Adapter-level `PublishResult` (Map-shaped) renamed to `AdapterPublishResult` to stop colliding with the service-level (array-shaped) one.

  ## Shared FastNear KV client

  New `plugins/nostr/src/lib/fastnear-kv.ts` owns the FastNear KV read path. `BindingService.readKv` and `NostrCommentService.verifyKvAccount` both use it. The hardcoded `kv.main.fastnear.com` + `contextual.near` in `verifyKvAccount` (silently ignoring `KV_API_URL` / `BINDING_CONTRACT`) and the GET-vs-POST split are gone.

  ## Configuration hygiene

  - `BUZZ_NSEC` moved from `variables` to `secrets` (`bos.config.json` `plugins.nostr.secrets: ["BUZZ_NSEC"]`, `plugin.dev.ts`). Malformed non-empty `BUZZ_NSEC` now fails plugin initialize loudly instead of silently disabling buzz.
  - Dead `nearRpc` field removed (was hardcoded, never read). `#11` SIWN prototype will add a real `NEAR_RPC` variable when it lands.
  - Default relay list lives in one place (the Zod schema default). `StandardAdapter` constructor takes its relays as a required argument.
  - `nostr-core/config.ts`'s `NostrVariablesSchema` is exported and consumed via `z.infer`.

  ## Error channels and handler simplification

  `NostrCommentService` methods that fail with adapter-not-configured now fail `ORPCError<"BAD_REQUEST">` in the Effect error channel (matching `BindingService.verifyChallenge`). `hasAdapter` is removed from the service shape. The 6 copies of try/catch + `errors.BAD_REQUEST` fallback + `hasAdapter` pre-check in `index.ts` handlers all collapse — every handler is now a one-liner.

  **Behaviour change:** unexpected (non-`ORPCError`) failures that previously became 400 become `INTERNAL_SERVER_ERROR` (500) via `runEffect`'s `flattenError` fallback. Genuinely-expected failures (bad sigs, bad challenges, missing adapters, bad inputs) still get 400 because the services fail with `ORPCError` and `runEffect` rethrows.

  ## Adapter lifecycle

  - `StandardAdapterLive` is wired into `NostrCommentServiceLive` via `Layer.provide(StandardAdapterLive)`. One `SimplePool` per plugin scope instead of two (the dead `StandardAdapterService` build in `initialize` and the freshly-constructed `StandardAdapter` inside the comment service both went away).
  - The `__close` `Object.assign(svc, { __close })` hack is replaced with `Effect.addFinalizer`. `BuzzAdapter` is constructed only when buzz is configured; finalizer closes it.
  - `BuzzAdapter.publishSigned` now awaits the relay's `OK` response keyed by event id (was fire-and-forget after `#send`). `OK` handler in `#handle` checks the pending-publishes map first and resolves with `msg[2] === true`. Timeout defaults to `queryTimeoutMs`; `close()` clears pending timers.
  - `BuzzAdapter.close()` state-key bug fixed: was `states.set("disconnected", "disconnected")` (literal key, ignored); now `states.set(relay, "disconnected")` per connection.

  ## Layer composition

  `NostrCommentService` now reads `StandardAdapterService` from the layer graph instead of casting `getAdapter("standard") as StandardAdapter` ×3. Manual `for (i += BATCH)` + inner `Effect.forEach` loops in `requireVerified` and `enrich` collapse into single `Effect.forEach(items, fn, { concurrency: 5 })`.

  `initialize` no longer builds the dead `NostrCoreService` (which was only read by the old `listRelays` handler). `listRelays` now reads the resolved `relays` from `resolveNostrConfig` directly. `NostrCoreService` / `NostrCoreLive` exports remain in `nostr-core` (vendored SDK parity) but are not wired by the plugin.

  `verifyEvent` (sig check) moves from the `verifyBinding` handler into `BindingService.verifyChallenge`. The service accepts the no-kind event shape and injects `kind: 27235` for verification, keeping the implicit-kind contract out of the wire schema. The `verifyBinding` handler becomes a one-liner.

  **Behaviour change:** invalid signatures on `verifyBinding` now fail at the service layer (consistent with the other challenge failures), not at the handler.

  ## Test cleanup

  - New `tests/helpers.ts` exports `CFG`, `TestLayer`, `withBinding`, `expectBadRequest`, `makeBindingEvent`, `stubFetch`, `mockJsonResponse`. The two effect-using test files no longer duplicate these.
  - `expectBadRequest` uses `toMatchObject({ code: "BAD_REQUEST" })` instead of `(squashed as ORPCError<string, unknown>).code`.
  - `binding-read.test.ts` holds the `vi.fn()` reference directly instead of `(globalThis.fetch as ReturnType<typeof vi.fn>)` ×6.
  - `event-verification.test.ts` types `cloneMinus` properly (no `(event as any).id` ×7) and uses it without `as unknown as Parameters<typeof verifyEvent>[0]` casts.
  - The leftover scratch block + mid-file `import * as CauseNS` at the bottom of `binding-read.test.ts` is deleted.
  - Test count: 38 (was 39; the scratch was a test-of-the-test, not a real assertion).

  ## Hygiene

  - Stray `plugins/nostr/:memory:/` PGlite data directory removed (untracked).
  - `plugins/nostr/README.md` rewritten from the unswapped "Template Plugin" scaffold into plugin-specific docs (routes, architecture, configuration, tests).
  - `plugins/nostr/LLM.txt` removed (uncustomized every-plugin template guide leftover).

## 1.3.0

### Minor Changes

- ada1cd2: Move the things CRUD into the template plugin as a DB-backed demonstration of database best practices, replacing the in-memory `Map` store while keeping the existing streaming demos.

  - Add drizzle infrastructure under `src/db/`: `things` table schema, PGLite/Postgres driver, scoped `DatabaseTag`/`DatabaseLive` layer, and a migration runner with a generated initial migration
  - Add `ThingsService` (Effect `Context.Tag`) with `createThing`, `getThing`, `deleteThing`, and a new `listThings` (type filter + offset cursor pagination); errors are typed `Effect<_, ORPCError>` (`NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`)
  - Build the service via `tools.buildService` so the database pool lifecycle is bound to the plugin scope
  - Rename the `apiKey` secret to `TEMPLATE_API_KEY` and add a `TEMPLATE_DATABASE_URL` secret (defaults to in-memory PGLite); all secrets now follow the uppercase convention
  - Add dependency scripts `db:generate`, `db:push`, and `db:studio`

  Streaming demonstrations (`search`, background events via `MemoryPublisher`) are preserved.

### Patch Changes

- ada1cd2: Remove `_viewer` paths from the host and add structured error testing surface.

  - Remove `_viewer` route, `renderBosViewer`, `isViewerFramePath`, and viewer-specific CSP/font-src conditionals from the host; always apply `frame-ancestors 'none'`
  - Rate limiter no longer skips the `/health` path, protecting it from DDoS
  - Add `testError` route to the core API shell with six error kinds (`unauthorized`, `forbidden`, `not_found`, `conflict`, `bad_request`, `internal`), returning structured JSON errors with correct status codes and content types
  - Add `testError` route to the `@every-plugin/template` plugin as a demonstration
  - Append template plugin's thing routes (`/api/things`) to the API router with `requireAuth`, restoring the host-level `/api/things` surface via `_plugins.template()` passthrough
  - Add regression tests verifying structured error responses, security headers (CSP/CSRF/X-Frame-Options), body-size limiting, and rate limiting
  - Add router-composition note to `plans/orpc-v2-effect-migration.md` (Phase 1.7) for future direct-router merging in `every-plugin`
  - Standalone plugin dev servers now load declared `dependsOn` sibling plugins via `BOS_RUNTIME_CONFIG`, enabling `_plugins.*()` in `initialize` during local development

- ada1cd2: Route the things UI through the namespaced `template` plugin client and enforce auth on thing writes.

  - Things routes in the UI now call `apiClient.template.createThing`, `apiClient.template.getThing`, `apiClient.template.deleteThing`, and `apiClient.template.listThings` instead of the removed top-level `api` client methods; `live.tsx` no longer needs a cast to reach the template client
  - The parent API now proxies thing routes to the template plugin through the in-process `templateClient`, keeping `createThing`/`deleteThing` auth-protected at the API boundary with `requireAuth` while `getThing`/`listThings` remain public
  - The template plugin's `createThing` and `deleteThing` handlers no longer enforce auth themselves (auth is enforced by the parent API), so direct plugin-to-plugin calls don't depend on per-call auth context

## 1.2.1

### Patch Changes

- b03bc24: **every-plugin:**

  - Broaden `Effect.annotateLogs({ plugin: pluginId })` to cover the full plugin lifecycle — `usePlugin`, `loadPlugin`, `instantiatePlugin`, and `initializePlugin` — so all logs including Module Federation operations and database migrations are tagged with the plugin's registry key
  - Convert Module Federation service `console.log` calls to `Effect.logDebug` (registering/loading) and `Effect.logInfo` (registered/loaded) with proper log levels
  - Refactor `formatORPCError` to return `string | null` instead of calling `console.error` directly, enabling callers to log through Effect's structured system
  - Make `toPluginRuntimeError` and `wrapORPCError` pure functions (no side effects); add `Effect.tapError` with `Effect.logError` at 4 call sites in `plugin-loader.service.ts` for plugin-aware error logging
  - Remove `formatPluginError` (dead code after purity refactor)
  - Remove redundant `Effect.annotateLogs` from `plugin-loader.service.ts` (now covered at runtime level)

  **api:**

  - Convert 3 startup `console.log` calls to `Effect.logInfo` so `[API]` startup messages gain the `plugin=api` annotation
  - Convert `Effect.log` to `Effect.logInfo` for shutdown

  **host:**

  - Import `logger` wrapper in `plugins.ts` and replace all raw `console.*` calls with `logger.*` (for async contexts) or `Effect.log*` (for Effect generator contexts)
  - Restructure `catchAll` block to `Effect.gen` for proper `Effect.logError`/`Effect.logWarning` usage
  - Fix 2 stray `console.*` calls in `program.ts` to use `logger`

  **@everything-dev/apps-plugin:**

  - Convert `console.log` to `Effect.logInfo` for startup message
  - Convert `Effect.log` to `Effect.logInfo` for shutdown

  **@every-plugin/template:**

  - Convert publish failure `console.log` to `Effect.logWarning` for proper log level and annotation
  - Remove `[Event]` debug `console.log` from streaming handler; use `getEventMeta` for meaningful event ID filtering instead
  - Restructure `getById` to `Effect.gen` wrapper with `Effect.logInfo` for service call logging

## 1.2.0

### Minor Changes

- 4772e1f: Simplify API to a thin orchestration layer: replaces the upvotes table with a `things` registry (`thingId`, `pluginId`, `createdAt`, `updatedAt`), adds Effect service layers (Registry, Votes), and introduces plugin dispatch via `getThingProvider()` so the API delegates to plugins by `pluginId`. Adds `createThing`, `getThing`, `deleteThing` (admin-only), `subscribeThings` endpoints with SSE filtering by `pluginId`/`type`/`action`. Adds `deleteThing` to `_template` plugin contract/service/handler. Extracts `ApiContextSchema`, `pluginContext`, `runEffect` into `lib/context.ts`. Renames service files `thing-registry`→`registry`, `thing-votes`→`votes` with matching symbol renames. Removes obsolete `lib/plugins.ts`. Adds frontend thing registry routes under `/things/` (index, create, detail with vote controls, admin delete, live SSE stream). Improves DB Layer with idempotent migrator. Updates api-and-auth and plugin-development skill docs.

## 1.1.0

### Minor Changes

- d46dbee: Pass full organization and NEAR context from host to plugins

  The host's `buildPluginContext()` now forwards the complete `organization`
  and `near` objects from the auth plugin's `getContext()`, not just the
  flat `organizationId` and `walletAddress` strings.

  **Host:**

  - Store full `contextResult.organization` and `contextResult.near` in
    Hono context variables during session middleware
  - Pass both objects through `buildPluginContext()` to all plugins

  **API plugin:**

  - Add `organization` and `near` zod schemas to the context schema so
    routes and middleware can access org metadata (including `daoAccountId`
    from `organization.organization.metadata`) and NEAR capabilities

  **Template & Settings plugins:**

  - Expand context schema to reflect the full surface of available fields:
    `user`, `organization` (with `organization`, `member`, `isPersonal`,
    `hasOrganization`), `near` (with `primaryAccountId`, `linkedAccounts`,
    `hasNearAccount`), `walletAddress`, and `apiKey`
  - Added documentation comment listing all available context fields

  **CLI (everything-dev):**

  - Fix type error in `resolveRemoteConfigChain` where `BosConfig` was
    passed as `BosConfigInput` to `mergeBosConfigWithExtends`
  - Update plugin-development SKILL.md with a comprehensive Request Context
    Reference section documenting all fields, common patterns, and the
    minimal context pattern

## 1.0.4

### Patch Changes

- b193ad6: Fix `reqHeaders` runtime type to be a real `Headers` instance instead of `Record<string, string>`, preventing `TypeError: undefined is not a function` when calling `.get()` in plugin handlers

## 1.0.3

### Patch Changes

- 13f68ff: Inject `getRawBody` and `reqHeaders` into oRPC handler context so plugins can verify webhook signatures

  - Host session middleware now clones the request body before oRPC consumes it, exposing `getRawBody()` in context for raw body access
  - Dev server middleware also injects `reqHeaders` and `getRawBody` (previously passed `context: {}`)
  - API, projects, registry, and template plugins declare `getRawBody` in their context schemas
  - API plugin `reqHeaders` type changed from `z.custom<Record<string, string>>()` to `z.record(z.string(), z.string())` for proper runtime validation

## 1.0.2

### Patch Changes

- a0c5784: Upgrade `@hono/node-server` to `^2.0.1` across host and everything-dev packages.

  Bump dev dependencies group:

  - `@biomejs/biome` `2.4.10` → `2.4.14`
  - `@effect/language-service` `^0.84.3` → `^0.85.1`
  - `@electric-sql/pglite` `^0.2.0` → `^0.4.5`
  - `@vitest/ui` `4.1.2` → `4.1.5`

## 1.0.1

### Patch Changes

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds

## 1.0.0

### Major Changes

- f080b87: Release v1.0.0 of the everything-dev toolchain.

  - Promote api, ui, everything-dev, and every-plugin to stable 1.0.0
  - Promote the plugin template package to stable 1.0.0
