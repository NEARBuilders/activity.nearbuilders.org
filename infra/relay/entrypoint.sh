#!/bin/sh
# Starts strfry for relay.nearbuilders.org. Deployment-specific values come from the environment
# and are passed with --set, so strfry.conf stays static. See infra/relay/README.md.
set -eu

db_dir="/data/strfry-db"
mkdir -p "$db_dir"
# Railway mounts volumes owned by root; strfry runs unprivileged.
chown -R strfry:strfry "$db_dir"

set -- /app/strfry --config=/app/strfry.conf \
  --set "relay.port=${PORT:-7777}" \
  --set "relay.auth.serviceUrl=${RELAY_URL:-wss://relay.nearbuilders.org}" \
  --set "relay.info.contact=${RELAY_CONTACT:-https://github.com/NEARBuilders/activity.nearbuilders.org}" \
  --set "relay.info.pubkey=${RELAY_PUBKEY:-}" \
  --set "relay.realIpHeader=${RELAY_REAL_IP_HEADER:-x-real-ip}" \
  "$@"

exec su-exec strfry "$@"
