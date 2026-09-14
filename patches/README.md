# everything-dev local SSR patch

`everything-dev@1.53.2` starts a local SSR service but omits its URL from the runtime configuration passed to the host. The host consequently serves a client-only shell even with `bos dev --ssr`.

The patch forwards the allocated SSR port when SSR is explicitly enabled for a local UI. It clears the inherited remote bundle integrity for that local development bundle. Remote UI configuration is unchanged. Both ESM and CommonJS distributions receive the same fix. Bun applies this patch during installation.

The UI SSR Rsbuild configuration also reads `PORT` instead of hardcoding 3004. To verify, run `bun run dev -- --ssr` and inspect the initial HTML for `/activity`: it should contain the leaderboard/feed content and `__EVERYTHING_DEV_SSR__`. Reload in the browser and check for hydration errors.

Remove the patch after upgrading to an everything-dev release that forwards the local SSR URL. Keep the UI's configurable port and SSR data-loading regression tests.
