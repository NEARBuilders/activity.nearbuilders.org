---
"api": minor
"ui": minor
"@nearbuilders/activity-client": minor
---

Make Activity onboarding agent-first. A coding agent starts a binding session with
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
