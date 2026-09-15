# relay.nearbuilders.org: strfry with the NEAR Builders config and write policy.
# The upstream image only publishes `latest`, so it is pinned by digest (2026-09-04 build).
FROM ghcr.io/hoytech/strfry@sha256:36f1886d185a88ca57c66ebe52e6e9e8428dac2486eea0a5d50ff934f18b60c3

USER root
# nodejs runs the write-policy plugin; su-exec drops privileges after fixing volume ownership.
RUN apk add --no-cache nodejs su-exec

COPY --chown=strfry:strfry strfry.conf /app/strfry.conf
COPY --chown=strfry:strfry write-policy.mjs /app/write-policy.mjs
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod 0755 /app/write-policy.mjs /app/entrypoint.sh

EXPOSE 7777
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["relay"]
