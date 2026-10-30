---
"api": minor
"ui": minor
"@nearbuilders/activity-client": minor
---

Add a stateless MCP server at `POST /api/v1/mcp` whose tools let a coding agent register a project through a binding session (`start_activity_registration`, `check_activity_registration`) and submit events (`submit_activity_event`, including `activity.test` and history with `occurredAt`). The `/skill` page gains a **Copy MCP prompt** button, and `skill.md` and the integration guide describe the MCP flow.
