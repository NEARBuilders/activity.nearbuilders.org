---
"api": minor
"ui": minor
---

One NEAR account can now own up to 10 Activity Sources. Each source is bound under its own
`activity/<source-id>` slot on `contextual.near` instead of the account's `nostr/<account>` record,
which is still accepted for sources bound before this change. A nearbuilders.org project can have
only one source, and only the project owner's NEAR account (or the project's linked app account)
can register it. The registration form
searches nearbuilders.org projects and marks the ones you own.

Registration errors now carry a `field` code (`sourceId`, `nearAccountId`, or `project`) so the form
shows each error under the right field. Binding-session rate limits no longer pool every caller
without a known address into one bucket; the global limit still applies to everyone.
