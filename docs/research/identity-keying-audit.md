# Identity-keying audit

Date: 2026-10-31. Issue: #98. Parent convention: NEARBuilders/nearbuilders.org#329.

## Convention

App data that references a person keys on that person's **primary NEAR account**, never on an auth
session id and never on a bare internal user id:

- the canonical owner id is `context.near.primaryAccountId ?? context.userId`;
- ownership checks fan out over the primary account **plus every linked account**;
- app tables carry a NEAR-account column alongside a nullable `userId`;
- the auth database owns the `near_account` link table (`is_primary`); apps resolve identity through
  the auth plugin context and never read the auth schema directly.

In this app `context.near.linkedAccounts` is every `near_account` row of the user, the primary
included (flagged `isPrimary`), so a check over linked accounts covers the primary account.

Why it matters here: C3 (#80) merges this app's auth users and organizations into the shared
nearbuilders.org auth database, matching **id → NEAR account → verified email → copy with ids**. A
user or organization matched by NEAR account or email takes the shared database's id, so any column
holding this app's user id or organization id points at nothing after the join.

## Scope

- Every table in [`api/src/db/schema.ts`](../../api/src/db/schema.ts), the only plugin schema in this
  repository. The auth schema belongs to the platform auth plugin and is not read here.
- Every handler in [`api/src/index.ts`](../../api/src/index.ts) that resolves the caller or checks
  ownership, and the services it calls.
- Auth sessions: no API source outside `lib/auth.ts` and `lib/auth-types.gen.ts` reads the auth
  session. Every `session.id`, `sessionToken`, and `sessionId` in this app belongs to an Activity
  **Binding Session** (its own table and hashed tokens).

## Summary

| # | Finding | Severity | Data fix |
| --- | --- | --- | --- |
| 1 | Endorsements are keyed on bare `user_id` | High | Backfill + new key |
| 2 | Source and tenant ownership is keyed on `organization_id` | High (C3 blocker) | Remap during C3 |
| 3 | A source's NEAR account is not checked against the caller | Medium | None |
| 4 | A tenant's `account_id` is not checked against the caller | Medium | None |
| 5 | Admin and actor audit columns store bare user ids | Low | Optional backfill |
| 6 | Signing, event, and scoring identity already key on NEAR accounts | Conforms | None |

No code path keys data on an auth session id, and two guards keep it that way:
[`api/src/lib/context.ts`](../../api/src/lib/context.ts) removes `session` from the handler context
type, so any read, destructure, or alias of it fails typecheck; and
[`api/tests/unit/identity-keying.test.ts`](../../api/tests/unit/identity-keying.test.ts) fails if that
type change is reverted (for example by `bos sync`) or if source outside the auth library reads
`context.session`, uses the `AuthSession` types, or calls `getSession`.

## Findings

### 1. Endorsements are keyed on bare `user_id` (High)

- **Data:** `activity_event_endorsements(event_id, user_id)`, unique on `(event_id, user_id)`, with no
  NEAR-account column.
- **Writes:** `endorseActivityEvent` and `unendorseActivityEvent` pass `context.userId` to
  `ActivityEndorsementsService.endorse/unendorse`. They need only `requireAuth`, so any signed-in
  user can endorse, including users without a NEAR account.
- **Reads:** `getActivityEventEndorsements` (`endorsedByCurrentUser`) and the endorsement stream
  (`changedByCurrentUser`) compare `context.userId`.
- **Failure:** after C3, an endorser whose user id changes loses their endorsement state: the rows
  still count toward totals, but the endorser can neither see nor remove them, and endorsing again
  adds a second row for the same person. Today, one person with two auth users (a NEAR sign-in and an
  email sign-in that are later linked) can endorse the same event twice.
- **C3 sizing:** because endorsing needs only a sign-in, this app's auth database holds every
  endorser, not only "admin/management users" as #80 assumes. Size the C3 user merge accordingly.
- **Fix:**
  - Add `owner_account_id` (the canonical owner id) and keep `user_id` as a nullable sibling.
  - Treat the caller's identity as the set {primary account, every linked account, user id}.
    `endorse` checks for an existing row matching any member of that set before inserting,
    `unendorse` deletes rows matching any member, and both read paths match the whole set. A unique
    index on `(event_id, owner_account_id)` alone would not stop a duplicate after the user changes
    their primary account, or after a user who endorsed before linking NEAR links an account.
  - Backfill `owner_account_id` with a one-off migration that maps each `user_id` to its primary NEAR
    account. The auth plugin exposes no admin-level user-to-account lookup (`nearListAccounts` returns
    only the caller's accounts), so this script reads the auth database's `near_account` table
    directly: a documented, migration-only exception to the "never read the auth schema" rule. Rows
    for users without a NEAR account keep their user id as the owner. Merge rows that collapse onto
    one owner.
  - Run the backfill **before** the C3 flip, while this app's user ids still resolve. In the C3
    window, remap `user_id` through the same old-to-new user map, or null it; `owner_account_id`
    stays correct either way.

### 2. Source and tenant ownership is keyed on `organization_id` (High, C3 blocker)

- **Data:** `activity_sources.organization_id` (every source-management route scopes by
  `context.organization.activeOrganizationId`) and `tenants.org_id`. Signing identities, API keys,
  GitHub integrations, and binding sessions hang off sources.
- **Failure:** C3 merges organizations too. If an organization is matched to an existing shared
  organization, or copied under a new id, its sources and tenants become unreachable to their owners.
  `listActivitySources` returns an empty list, source and credential routes return `404`, and tenant
  routes return `403`. Ingestion keeps working, but nobody can rotate keys, revoke API keys, or review
  GitHub quarantine.
- **Why it is not a convention violation:** these rows belong to an organization, not to a person,
  and the convention does not cover organization keys.
- **Fix:** the C3 runbook must either preserve organization ids or produce an old-to-new id map and
  apply it to `activity_sources.organization_id`, `tenants.org_id`, and the organization `member`
  rows in the same window, then verify that every source's organization exists in the shared
  database. Add this to #80.

### 3. A source's NEAR account is not checked against the caller (Medium)

- **Data:** `activity_sources.near_account_id` holds a NEAR account, so the key itself conforms.
- **Gap:** `createActivitySource` requires NEAR authentication but checks `nearAccountId` against the
  caller's linked accounts only when the source is linked to a nearbuilders.org project.
  `updateActivitySource` can change `nearAccountId` without NEAR authentication, with the same
  project-only check. `requireLinkedSourceAccount` runs only when a Signing Identity is bound.
- **Failure:** any organization owner can register sources against someone else's NEAR account.
  `requireSourceCapacity` counts sources per NEAR account across all organizations (at most 10), so
  ten squatted sources block the real owner from registering any. The feed is not affected, because
  it requires a bound identity, and binding does check the caller's accounts; but unverified accounts
  appear in management and review listings.
- **Fix:** on create and on any `nearAccountId` change, require NEAR authentication and check the
  account against the caller's linked mainnet accounts for every source, not only project-linked
  ones.

### 4. A tenant's `account_id` is not checked against the caller (Medium)

- **Data:** `tenants.account_id` holds a NEAR account.
- **Gap:** `createTenant` and `updateTenant` accept any `accountId` that starts with the subdomain and
  never check that the caller controls it.
- **Failure:** any organization member can claim a tenant for an account they do not own, which
  blocks the real owner because `account_id` is unique.
- **Fix:** the same check as finding 3. This is template code (`services/tenants.ts`), so raise it
  upstream in everything-dev as well.

### 5. Admin and actor audit columns store bare user ids (Low)

- **Data and writes:**
  - `activity_sources.reviewed_by`, `activity_source_reviews.administrator_id`, and
    `activity_source_trust_changes.administrator_id` store the reviewing administrator's
    `context.userId`;
  - `activity_signing_identities.created_by` and `retired_by`, and
    `activity_binding_sessions.completed_by`, store the acting user's `context.userId`;
  - `activity_hidden_events.administrator_id` and
    `activity_event_moderation_requests.administrator_id` are polymorphic: an administrator's
    `context.userId` for a hide, or `source:<source-id>` for a source's own retraction.
- **Exposure:** these ids appear in API output (`reviewedBy`, `administratorId`, `createdBy`,
  `retiredBy`, `hiddenBy`).
- **Failure:** these columns drive no authorization, so nothing breaks. After C3, audit history names
  user ids that no longer exist, and the moderation idempotency key
  `(administrator_id, idempotency_key)` restarts for an administrator whose id changed, so a retried
  hide applies again instead of replaying.
- **Fix:** store the canonical owner id from now on. NEAR account ids cannot contain `:`, so they
  cannot collide with `source:` values. Switching key restarts moderation idempotency once, as C3
  would; doing it in the C3 window means it restarts only once. A backfill of existing rows is
  optional.

### 6. What already conforms

- **Linked projects:** `requireProjectOwnerAccount` requires the source account to be both a
  nearbuilders.org project owner account and one of the caller's linked mainnet accounts.
- **Signing identities:** `bound_near_account_id` comes from the on-chain binding under the source's
  NEAR account, and confirmation checks the caller's linked accounts (`requireLinkedSourceAccount`).
- **Events and scoring:** the actor (`n` tag), GitHub actor mappings
  (`activity_github_actor_mappings.near_account_id`), hidden-event `actor`, and leaderboard rows all
  key on NEAR accounts.
- **Machine credentials:** Source API Keys and Binding Session poll tokens live in this app's database
  and belong to sources and sessions, not people, so C3 needs no Source API Key rotation. Rate-limit
  buckets (`requester_key_hash`) hash the client address.

## Other C3 notes

- **Admin authority is role-based.** `requireAdmin` checks `context.user.role`. After the merge, a
  user matched to a shared user takes that user's role: an Activity administrator can lose admin, and
  nearbuilders.org administrators gain source review, trust, and moderation powers here. #80 accepts
  shared roles; list the affected accounts before the flip.
- **Personal organizations.** The UI finds a user's personal organization by `org.slug === user.id`
  (`ui/src/components/user-nav.tsx`, `ui/src/components/organizations/use-organization-detail.ts`).
  For users whose id changes, it falls back to the `isPersonal` metadata.

## Fix tickets

| Ticket | Covers | Migration |
| --- | --- | --- |
| Key endorsements on the canonical NEAR owner id | Finding 1 | Add column; backfill from the auth `near_account` table before C3; merge duplicates |
| Preserve or remap organization ids in the C3 join | Finding 2 | Id map applied to sources, tenants, and members (add to #80) |
| Verify source NEAR account ownership on create and update | Finding 3 | None |
| Verify tenant account ownership | Finding 4 | None |
| Store the canonical owner id in audit columns | Finding 5 | Optional backfill, ideally in the C3 window |
