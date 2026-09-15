---
"api": patch
---

Point production `activityRelayUrl` at a public relay (`wss://relay.damus.io`) as a stopgap.
`relay.nearbuilders.org` has never had a DNS record — production was configured against a
hostname that was never provisioned. This is not a permanent fix; issue #12 (provision and
operate the production relay and Redis) still tracks deploying real, NEARBuilders-controlled
relay infrastructure. Swap this value back once that lands.
