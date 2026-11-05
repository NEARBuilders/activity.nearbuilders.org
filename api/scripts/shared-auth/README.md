# Runbook: moving activity onto the shared nearbuilders.org auth database

Tracks [#118](https://github.com/NEARBuilders/activity.nearbuilders.org/issues/118) (epic
[nearbuilders.org#210](https://github.com/NEARBuilders/nearbuilders.org/issues/210); feedback's
equivalent: [feedback #166](https://github.com/NEARBuilders/feedback.nearbuilders.org/pull/166)).

After the cutover activity.nearbuilders.org and nearbuilders.org read the same auth database, so
they share users, NEAR accounts and organizations. Activity's own data is keyed by NEAR account
(#103/#107) and carries over unchanged. Only two columns point into the auth DB and need
rewriting: `tenants.org_id` and `activity_sources.organization_id`. Activity has no team
references, so — unlike feedback — teams are not part of the remap.

## What must move

| Reference | Where | Nullable? | Treatment |
| --- | --- | --- | --- |
| `activity_sources.organization_id` | API DB | NOT NULL | Remap to shared org ids |
| `tenants.org_id` | API DB | NOT NULL, unique | Remap to shared org ids |
| `activity_event_endorsements.user_id` | API DB | nullable legacy | Backfill (`pnpm run backfill:endorsement-owners`, #103) + lazy claim — **not** this tooling |
| Audit columns (`reviewed_by`, `administrator_id`, `created_by`, …) | API DB | various | Display-only; legacy user ids go stale — skipped |
| Orgs, memberships, users | activity's local auth DB | — | Copied/merged into the shared DB (matched by NEAR account) |
| Source API keys | API DB (`activity_source_api_keys`) | — | Survive untouched |

## What the tooling does

All commands run from the repo root. Every database is addressed by an environment variable:

| Variable | Database |
| --- | --- |
| `ACTIVITY_AUTH_DATABASE_URL` | Activity's current auth DB (only read) |
| `SHARED_AUTH_DATABASE_URL` | nearbuilders.org's auth DB, which activity moves onto |
| `API_DATABASE_URL` | Activity's API DB (holds `tenants` and `activity_sources`) |

- `pnpm run auth:check-schema <VAR> [<VAR> ...]` reports how far each auth DB is through the
  auth plugin's migrations (`0000` … `0018`), by checking the tables, columns and constraints
  each migration leaves behind. It exits non-zero when a DB is behind.
- `pnpm run auth:cutover [--overrides overrides.json] [--report plan.json] [--apply]` plans and
  performs the remap:
  - **Orgs** referenced by a tenant or source map to the shared org with the same id, else the
    same slug when the two orgs share at least one member (matched by NEAR account), else they
    are copied with their id. A slug match with no shared members is a conflict.
  - **Users** holding a membership in those orgs map to the shared user with the same id, else
    the one owning the same NEAR account, else the same verified email (both sides
    `emailVerified`), else they are copied (user, NEAR accounts, provider accounts) with their
    ids. An unverified email match is a conflict. Site roles (`user.role`) are never copied.
  - **Memberships** missing from the shared DB are added. Where a membership already exists the
    shared role is kept and the difference is reported.
  - **Tenants and sources** are rewritten to the mapped ids. Each update only applies while the
    row still holds the id the plan was made from.
  - Afterwards every tenant and source must point at an org that exists in the shared DB;
    otherwise everything rolls back.

  Without `--apply` it is a dry run: all writes are executed inside one transaction per DB,
  verified, and rolled back. With `--apply` the shared auth DB commits first, then the API DB.
  The auth inserts are idempotent, so if the second commit fails, re-run the command.
  Re-running after a successful cutover plans nothing.

  Anything it cannot decide safely is reported as a conflict, and nothing is written until the
  conflicts are gone. Typical fixes are an overrides file for orgs whose slug differs between
  the apps:

  ```json
  { "organizations": { "<activity org id>": "<shared org id>" } }
  ```

## Steps

### 1. Make copies

Take `pg_dump` snapshots of all three databases and restore them into scratch databases. Every
step up to 5 runs against the copies only.

```sh
pg_dump --no-owner --format=custom "$PROD_SHARED_AUTH_URL" > shared-auth.dump
pg_dump --no-owner --format=custom "$PROD_ACTIVITY_AUTH_URL" > activity-auth.dump
pg_dump --no-owner --format=custom "$PROD_ACTIVITY_API_URL" > activity-api.dump
pg_restore --no-owner --dbname "$SHARED_AUTH_DATABASE_URL" shared-auth.dump
pg_restore --no-owner --dbname "$ACTIVITY_AUTH_DATABASE_URL" activity-auth.dump
pg_restore --no-owner --dbname "$API_DATABASE_URL" activity-api.dump
```

### 2. Migrate the shared auth DB forward

nearbuilders.org's shared auth DB must be at the auth plugin's latest migration
(`0018_icy_thunderbolts` as of 2.0.0-rc.39). Bring a copy forward by booting the current auth
plugin against it, so its own migrator applies the migrations and records them in its journal —
for example, run this repo locally with `AUTH_DATABASE_URL` set to the copy (`pnpm run dev`) and
wait for the auth plugin to finish starting. Do not apply the SQL by hand: the runtime tracks
applied migrations by hash, and replaying an `ALTER`-only migration it has not recorded fails on
the next boot.

```sh
pnpm run auth:check-schema SHARED_AUTH_DATABASE_URL ACTIVITY_AUTH_DATABASE_URL
```

Then run `auth:check-schema` again; it must report no pending migrations. Compare row counts of
`user`, `near_account`, `organization`, `member` and `apikey` before and after; the forward path
only adds tables and columns (organizations get `status = 'active'`), so the counts must match.
`api/tests/unit/shared-auth-cutover.test.ts` replays exactly this path on a populated `0000`
database, using the upstream migrations copied into `api/tests/fixtures/auth-migrations/`.

In production, the shared DB reaches the latest migration by upgrading nearbuilders.org to the
current auth plugin (same boot-time migration). Do that before step 5. The cutover refuses to
run against a shared DB that is behind. This is a shared prerequisite with feedback's cutover —
verify once; both cutovers depend on it.

### 3. Dry-run on the copies

```sh
pnpm run auth:cutover --report plan.json
```

Review the summary and `plan.json`:

- every org resolution (same id, slug match, override, copy) is what you expect;
- role differences: the shared role wins, so fix them in the shared DB if activity's should;
- the API keys listed must be re-issued (step 6).

Resolve conflicts with an overrides file and repeat until the dry run passes. Then run it once
with `--apply` against the copies and point a local instance at them (`AUTH_DATABASE_URL` =
shared copy, `API_DATABASE_URL` = activity copy) to check the acceptance criteria by hand: the
source list per org, endorsement state, and tenant subdomain resolution.

Run the endorsement backfill against the copies too, in the same rehearsal:
`pnpm run backfill:endorsement-owners` (dry run), review the plan, then `--apply`.

### 4. Secrets

- `BETTER_AUTH_SECRET` must be identical in the activity and nearbuilders.org deployments. Use
  nearbuilders.org's value, because its sessions already live in the shared DB.
- `AUTH_DATABASE_URL` on the activity Railway service points at the shared DB. Railway is the
  source of truth for the variable — GitHub-side workflows cannot see it, so there is no CI
  gate here; the fail-closed boot-time guard is tracked upstream
  ([everything-dev#804](https://github.com/NEARBuilders/everything-dev/issues/804)). Until it
  lands, the flip in step 5 depends on setting the variable correctly: never boot prod with it
  unset, or the host silently falls back to a local database (nb#380 / audit #341).
- Provider tokens copied for activity-only users were written under activity's old secret. They
  are refreshed on the user's next sign-in.

### 5. Cut over production (quiet window, in this order)

1. Announce a short maintenance window (sign-in, source review and tenant admin are briefly
   unavailable).
2. Confirm the shared DB is current: `pnpm run auth:check-schema SHARED_AUTH_DATABASE_URL`.
3. **Backfill first**: with the production URLs exported, `pnpm run backfill:endorsement-owners`
   (dry run), review, then `--apply`. This must happen before the flip, in a quiet window: the
   plan is a snapshot, and running it against live traffic races the lazy claim (#118).
4. Dry-run: `pnpm run auth:cutover --report plan.json`.
5. Back up the columns being rewritten:
   `pg_dump --data-only --table=tenants --table=activity_sources "$API_DATABASE_URL" > org-refs-before-cutover.sql`.
6. Apply: `pnpm run auth:cutover --apply`.
7. Flip the activity Railway service: `AUTH_DATABASE_URL` → shared DB, `BETTER_AUTH_SECRET` →
   the shared value. Redeploy.
8. Users sign in again. Source API keys survive untouched — they live in the API DB
   (`activity_source_api_keys`), not the auth DB.

Caveats to announce:

- Users with **no linked NEAR account** cannot be matched across auth DBs. Their endorsement
  rows become unreachable and re-actionable at cutover (`caller.ids` no longer contains the old
  user id). Nudge active no-NEAR users to link before the flip; accept the loss for the rest.
- Everyone signs in again; sessions do not carry over.

### 6. Sessions and API keys

- Activity's auth-DB API keys (`api_…`, Settings → API Keys) do not exist in the shared DB and
  must be re-issued. The dry-run summary lists every key with its owning user/org. Contact those
  owners and ask them to create new keys after the cutover.
- Source API keys (`source:<id>`, used for signing and ingest) are stored in the API DB and
  survive unchanged.

### 7. Verify

- Endorsements survive a primary switch (state keyed on owner id, #103).
- Org members/owners still see review history; moderation roles intact (#107).
- Tenant subdomains resolve; source signing + ingest works.
- Moderation hide-retries replay instead of duplicating.
- A user with a reissued auth id still sees their endorsement state (`caller.ids` matching).

Rollback: point `AUTH_DATABASE_URL` back at the preserved local auth DB (the cutover never
writes to it) and restore `tenants.org_id` / `activity_sources.organization_id` from `plan.json`
(each update lists `from` and `to`) or from the step 5 backup. Rows added to the shared DB can
stay; they are ordinary orgs, users and memberships. The tooling is idempotent and re-runnable.

Keep activity's old auth DB read-only for a few weeks as a reference, then decommission it.
