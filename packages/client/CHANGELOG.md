# @nearbuilders/activity-client

## 0.3.0

### Minor Changes

- 97a2dbf: Build the client on oRPC 2 and everything-dev v2. `createActivityClient(baseUrl, options)` and the contract import path are unchanged. The package now declares `@orpc/openapi` and `zod`, which the bundled contract imports directly instead of through the removed `every-plugin/orpc` and `every-plugin/zod` facades.
- 57d293c: Add a stateless MCP server at `POST /api/v1/mcp` whose tools let a coding agent register a project through a binding session (`start_activity_registration`, `check_activity_registration`) and submit events (`submit_activity_event`, including `activity.test` and history with `occurredAt`). The `/skill` page gains a **Copy MCP prompt** button, and `skill.md` and the integration guide describe the MCP flow.
- 3549d8d: Add the public `GET /v1/signing-keys` endpoint (`listActivitySigningKeys`), listing the source ID and public key of every bound Signing Identity, current and retired, for Activity Sources that are not rejected. relay.nearbuilders.org's write policy uses it to reject kind-1701 events from unregistered pubkeys.

### Patch Changes

- 99fc647: Send the `FASTNEAR_API_KEY` secret as a bearer token on FastKV binding reads. A 401, 403, or 429 from FastKV now fails binding confirmation with a distinct `SERVICE_UNAVAILABLE` error and log line instead of reporting that the binding is not available yet, and the dashboard stops polling and shows that error.

## 0.2.0

### Minor Changes

- ef677e2: Make Activity onboarding agent-first. A coding agent starts a binding session with
  `POST /v1/binding-sessions`, hands the person a `/binding` link and match code, and claims the
  Source API Key exactly once from `POST /v1/binding-sessions/{sessionId}/claim` after the person
  signs in, confirms the prefilled details, and links the source on-chain. Sessions can be prefilled
  from a nearbuilders.org project link, slug, or name, and each source records the nearbuilders.org
  project it was registered from, which may have only one source.

  Administrator approval no longer blocks onboarding: a pending source can link on-chain, create API
  keys, and publish up to 500 events a day, which appear in the feed marked "Under review" and join
  leaderboards once it is approved. Rejected sources stay blocked and leave the feed, and editing a
  rejected source no longer reopens it.

  The registration form can import a nearbuilders.org project, event type descriptions are optional,
  the setup panel shows Info, Link on-chain, and API key with a way back to edit Info, and `/skill.md`
  documents the agent flow.

### Patch Changes

- 6d20354: Add a typed Activity RPC client package and remove the Beta banner from the site.
