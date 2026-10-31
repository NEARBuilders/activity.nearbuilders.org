---
"api": minor
"@nearbuilders/activity-client": minor
---

Add the public `GET /v1/signing-keys` endpoint (`listActivitySigningKeys`), listing the source ID and public key of every bound Signing Identity, current and retired, for Activity Sources that are not rejected. relay.nearbuilders.org's write policy uses it to reject kind-1701 events from unregistered pubkeys.
