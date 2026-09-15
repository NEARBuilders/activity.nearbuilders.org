---
"ui": patch
---

Deploy the SSR bundle to Zephyr as a static (`csr`) snapshot instead of an executable `ssr` one.
The host downloads `remoteEntry.server.js` and runs it itself; as an `ssr` snapshot Zephyr
tried to execute the CommonJS entry (`module is not defined`) and returned 404 for the file,
so server-side rendering fell back to the client app on every request.
