# relay.nearbuilders.org

[strfry](https://github.com/hoytech/strfry) with the NEAR Builders configuration and write policy.
It serves Activity events (kind 1701) and nostr.nearbuilders.org comments and profiles. The
requirements come from [`docs/activity-protocol.md`](../../docs/activity-protocol.md#production-requirements)
and issue #12.

| File | Purpose |
| --- | --- |
| `Dockerfile` | Upstream strfry image pinned by digest, plus Node for the write policy |
| `strfry.conf` | Static relay settings: query cap 1,000, 4 tag filters, NIP-11 info, database on `/data` |
| `write-policy.mjs` | strfry plugin: allowed kinds and per-address write rate limits |
| `entrypoint.sh` | Fixes volume ownership, applies environment settings with `--set`, drops root |
| `export-relay.mjs` | Copies a relay's events of the accepted kinds as JSONL (migration and backups) |
| `publish-events.mjs` | Replays JSONL into a relay over a normal client connection (restore), paced under the rate limit |

## Settings

All are optional environment variables on the Railway service.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `7777` | Listen port. Must match the domain's target port on Railway |
| `RELAY_URL` | `wss://relay.nearbuilders.org` | Public URL, used to validate NIP-42 auth |
| `RELAY_CONTACT` | repository URL | NIP-11 contact (email, website, or `nostr:` URI) |
| `RELAY_PUBKEY` | empty | NIP-11 operator pubkey (hex or npub) |
| `RELAY_ALLOWED_KINDS` | `0,1,1111,1701` | Kinds accepted from clients. Add chat kinds here when needed |
| `RELAY_WRITE_RATE` | `20` | Sustained writes per second per client address |
| `RELAY_WRITE_BURST` | `300` | Burst size per client address |
| `RELAY_REAL_IP_HEADER` | `x-real-ip` | Header carrying the client address behind the proxy |

The Activity gateway publishes every source's events from one server address, so the burst has
to absorb a GitHub backfill. Imports, syncs, and streams are operator actions and are not
rate-limited, but they are also **not** filtered by the write policy: `strfry import` accepts any
kind, which is why `export-relay.mjs` filters kinds itself.

Activity's adapters declare a per-query cap (`maxQueryLimit`, currently 500). It must never exceed
this relay's `maxFilterLimit` (1,000), or Activity could miss truncated history.

## Local check

```bash
docker build -t nearbuilders-relay infra/relay
docker run --rm -p 7777:7777 -v relay-data:/data nearbuilders-relay
curl -H 'Accept: application/nostr+json' http://localhost:7777   # NIP-11 document
node --test infra/relay/write-policy.test.mjs
```

## Deploying on Railway

**Deployed on 2026-09-16** to the existing `activity-relay` service, replacing
`ghcr.io/mattn/nostr-relay`. Railway has no access to this repository, so it was uploaded from a
working copy:

```bash
railway up infra/relay --path-as-root --service activity-relay
```

Updates therefore need another `railway up` until someone with GitHub organisation access links the
repository (below). `PORT=7447` is set so the existing `relay.nearbuilders.org` domain and DNS keep
working, and the volume stayed mounted at `/data`; the previous relay's SQLite file is still there.

Verified in production after the swap: the NIP-11 document reports `NEAR Builders Relay` with
`max_limit: 1000`; Activity's `/api/v1/health` reports the relay ok; publishing and reading through
nostr.nearbuilders.org both work; a kind 4 event is rejected by the write policy; and strfry logs a
public client address rather than a proxy address, so per-address rate limits apply per client.

Once repository access is available, link the service with **Root Directory** `/infra/relay` and
**Watch Paths** `/infra/relay/**`, so it rebuilds only when these files change. Mount a volume at
`/data`.

To replace the previous relay in place (keeping the `relay.nearbuilders.org` domain and DNS):

1. **Back up** the current relay from any machine:
   `node infra/relay/export-relay.mjs wss://relay.nearbuilders.org > relay-backup.jsonl`
   (the previous relay caps queries at 500, which is the script's default `--cap`).
2. Point the existing `activity-relay` service at this repository and directory, and set `PORT` to
   the domain's current target port. The volume stays mounted at `/data`; strfry uses
   `/data/strfry-db/` and leaves the previous relay's files untouched for rollback.
3. After the deploy is healthy, **restore** the backup over a normal connection. At the default 15
   events per second it stays under the write limit; it is safe to rerun, since stored events
   come back as duplicates, and it exits non-zero if anything is rejected:
   `node infra/relay/publish-events.mjs wss://relay.nearbuilders.org < relay-backup.jsonl`
4. **Verify**: the NIP-11 document shows `NEAR Builders Relay`; exporting again
   (`export-relay.mjs ... --cap=1000`) yields the backup's event IDs; `GET /api/v1/health` on
   Activity reports the relay ok; and a nostr.nearbuilders.org comment round-trips.

**Rollback:** point the service back at the `ghcr.io/mattn/nostr-relay` image with its previous
settings. Its SQLite file is still on the volume. Events published during the strfry period exist
only in strfry; export them with `export-relay.mjs` and republish them with `publish-events.mjs`.

## Backups and restore

```bash
# Back up from any machine (events of the accepted kinds):
node infra/relay/export-relay.mjs wss://relay.nearbuilders.org --cap=1000 > relay-$(date +%F).jsonl
# Restore into a running relay:
node infra/relay/publish-events.mjs wss://relay.nearbuilders.org < relay-YYYY-MM-DD.jsonl
```

With shell access to the relay host, `strfry export` and `strfry import` are faster, but
`strfry import` skips the write policy and accepts any kind.

Verified locally against the pinned image: 1,349 events exported from `mattn/nostr-relay` were
restored into an empty strfry with identical event IDs; 2,500 events paged completely through
Activity's relay client at 500- and 1,000-event caps; data survived a restart; and the write
policy rejected disallowed kinds and rate-limited each client address separately.

Scheduling backups and choosing where they are kept is still open in issue #12.
