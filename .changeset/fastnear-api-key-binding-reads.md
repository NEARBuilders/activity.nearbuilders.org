---
"api": minor
"@nearbuilders/activity-client": patch
"ui": patch
---

Send the `FASTNEAR_API_KEY` secret as a bearer token on FastKV binding reads. A 401, 403, or 429 from FastKV now fails binding confirmation with a distinct `SERVICE_UNAVAILABLE` error and log line instead of reporting that the binding is not available yet, and the dashboard stops polling and shows that error.
