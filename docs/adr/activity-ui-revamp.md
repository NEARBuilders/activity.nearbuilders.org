# ADR: Activity UI revamp — demo-grade three-route surface

Status: Proposed. Written for issue #31. Implementation may not start until this is merged.

## Context

PR #35 already replaced the inherited everything.dev shadcn defaults with a real, custom token
set in `ui/src/styles.css` — this ADR is not proposing that work from scratch. What's still
missing, and what #31 actually asks this ADR to settle, is: (1) a written anti-pattern list
naming what's still wrong even after #35, grounded in the product owner's own feedback on that
redesign, not invented after the fact; (2) the Tailwind/shadcn-in-dependencies-vs-removed
decision the issue explicitly requires; and (3) a concrete plan for the three-route consolidation
(`/`, `/onboarding`, `/settings`) that maps existing components to their new homes instead of
describing a rebuild.

## Design direction

### Typography

Already shipped, keep as-is: **IBM Plex Sans** (400/500/600/700) for UI text, **IBM Plex Mono**
(400/500/600) for anything identifier-shaped — event IDs, pubkeys, API key prefixes, signatures.
This pairing already reads as "infrastructure tool," which fits an activity/reputation ledger
better than a generic geometric sans would. No change proposed.

### Color

Already shipped, keep as-is: a neutral zinc scale for structure (`--background` through
`--border`), a single brand accent teal (`--brand-accent: #00D9A3`) for the one "this is
interactive/live" signal per view, NEAR's own green/blue/purple reserved for NEAR-specific
affordances (wallet, account links), and a dedicated status-danger set separate from the generic
`--destructive` token. `--radius: 0.75rem` (soft-rounded, not sharp, not pill-shaped) is the one
radius value everything derives from via the `--radius-sm/md/lg/xl` scale in `@theme inline`. No
change proposed — this is a coherent, already-working system, and #31's job is to finish applying
it, not replace it.

### Motion

Already shipped: `animate-fade-in-up`, `animate-fade-in`, `animate-subtitle-cycle`, plus
`shadow-elevation-{sm,md,lg}` for depth instead of borders-as-default. Direction for new
work in this ticket: motion marks state changes (a step completing in `/onboarding`, a new event
arriving live in the `/` feed), never decoration. No new keyframes needed for the three routes;
reuse what exists.

### Anti-pattern list

This is the part #31 actually needs and doesn't yet have. Every entry below is either the product
owner's own verbatim feedback on the post-#35 UI (from the working session that shipped it) or a
grep-verified fact about the current codebase, not a hypothetical.

1. **"Everything is a card. Don't like that either."** — direct quote, given after seeing the
   #35 redesign live, specifically about the activity feed and leaderboard. Verified still true:
   `ui/src/components/activity-feed.tsx` and `ui/src/components/ui/activity-leaderboard.tsx`
   still wrap every row in a `Card`. **For the three core routes: no `Card` wrapping for list rows.**
   A feed of signed events is a *log*, not a deck of unrelated cards — rows should read as one
   continuous, scannable ledger (dividers, not boxes; see NostrFeed's `divide-y` pattern in the
   nostr-plugin-integration.md research for a proof this works at this data shape). `Card` stays
   available for genuinely card-shaped things: the sample-source picker in `/onboarding`, a single
   settings panel.
2. **"I don't like this subheading, heading, description style — 'Dynamically weighted /
   Leaderboard / 9/7/2026 – 9/13/2026 · UTC' — replace this UI pattern."** — direct quote. The
   anti-pattern is a three-line stacked eyebrow/title/meta header repeated per section. **For the
   three core routes: one line of section context max** (a title plus, if needed, a single inline
   meta detail — not a stacked block).
3. **"This looks so bad"** (screenshot, on an SSR-suspense fallback showing stale/old UI). The
   concrete failure mode: SSR suspense fallbacks must render the *current* skeleton/loading state
   for the route, never a cached older version of the page. Verify this explicitly for all three
   routes during implementation — it's a real regression that already happened once.
4. **No sidebar, ever, on these three routes.** Already true in `_layout.tsx` — no sidebar exists
   codebase-wide today. Keep it that way for `/`, `/onboarding`, `/settings` specifically; #31's
   nav simplification (brand mark + one link) applies to the public `/` route's header, not
   necessarily the authenticated shell wrapping `/onboarding` and `/settings`.
5. **No decorative empty states.** `ui/src/components/empty-state.tsx` exists and is fine to
   reuse, but copy must say what to do next ("Register a source to submit events" not "Nothing
   here yet"), matching the demo principle below.

### Demo principles

- **Time to first working action: under 30 seconds**, per #31's explicit acceptance bar for
  `/onboarding`'s sample-source path. Every step in that flow must have a working default so a
  reviewer never has to think of a value to type.
- **Every visible event or identity claim must show its verification, not just assert it.** The
  existing feed already does this correctly (`Verified signature` / `Standard source` badges,
  confirmed live in this session's `seed:demo` testing) — carry that pattern into the redesigned
  `/` feed rows exactly, just without the `Card` wrapper.
- **A reviewer with no NEAR wallet and no prior context must be able to see the product working**
  at `/` with zero clicks (already true — public feed, no login required) and reach a working
  onboarding demo within one click via the sample-source button.

## Decision: Tailwind + shadcn in dependencies

**Keep both in `package.json`.** This is already the current state and this ADR does not propose
changing it:

- `tailwindcss` and `tw-animate-css` remain — they're the layout/utility engine `styles.css`
  itself is built on (`@import "tailwindcss"`), and the parent everything.dev runtime consumes
  Tailwind classes too, per #31's own framing.
- shadcn-derived primitives in `ui/src/components/ui/` (24 today — `button`, `card`, `dialog`,
  `select`, `tabs`, `stepper`, etc.) remain as the *behavioral* layer (focus management, ARIA,
  composition), but every visible token they render through already comes from `styles.css`'s
  custom `--color-*`/`--radius-*` set, not a separate shadcn theme file — there is no
  `*.gen.ts` shadcn theme to remove; #31's acceptance criterion here is already satisfied by #35's
  work. No `Card` *component* removal is proposed — only the anti-pattern-1 usage restriction
  above, scoped to list rows on the three core routes.

## Three-route plan

Maps existing code to new homes; this is consolidation and header/footer work, not a rebuild.

### `/` — public landing
**Correction to #31's own framing, verified against the current codebase, not assumed from the
issue text:** `ui/src/routes/_layout/index.tsx` is *not* a redirect into `/activity` today — it's
the inherited everything.dev tenant-list page, and it `redirect({ to: "/login" })`s when there's
no session. That's the exact opposite of #31's requirement that `/` be public with zero login.
This is real, load-bearing work, not a rename: the tenant list currently living at `/` needs a new
home (it's `_authenticated` already in spirit — worth moving under `/_authenticated/tenant`
alongside the existing `tenant/$tenantId.tsx` and `tenant/new.tsx`, which is out of scope for #31
but must happen in the same change or `/` breaks for existing tenant-list users) before `/`
can become the activity feed.

The feed itself already exists and is close: `/activity`
(`ui/src/routes/_layout/activity.tsx`), built on `activity-feed.tsx` + `activity-leaderboard.tsx`,
already public/no-login, already live via SSE. Work: relocate the tenant list off `/` per above,
move this feed to be the `index` route, strip `Card` wrapping from feed rows per anti-pattern 1,
compact the leaderboard widget per anti-pattern 2, add the "Built on NEAR" footer (does not exist
anywhere in the codebase today — new `BrandFooter` component, linking https://near.org, rendered
by `_layout.tsx` on all three routes).

### `/onboarding` — source setup
Consolidates three existing pieces that already do the real work, just not in one stepped flow:
`activity-source-registration.tsx` (source name + org — step 1), `activity-source-cards.tsx` /
`activity-sources-dashboard.tsx` (event-type management, rendered today by the
`activity-sources.tsx` route — step 2), `activity-source-credentials.tsx` (signing identity + API key —
steps 3–4). The existing `ui/src/components/ui/stepper.tsx` primitive is the right vehicle for
this — already proven out in `_authenticated/tenant/new.tsx`, so this is a second, not a first,
consumer. New work:
the "use a sample source" pre-fill button (#31's 30-second-demo requirement) and wiring the four
existing pieces into one `Stepper` flow instead of separate pages.

### `/settings` — post-onboarding management
Consolidates the existing `_authenticated/settings/*` route group (`profile.tsx`,
`security.tsx`, `auth-methods.tsx`) with `api-key-manager.tsx` (already built), signing-identity
rotation (exists in `activity-source-credentials.tsx`, needs surfacing here rather than only in
onboarding), `activity-github-integration.tsx` (GitHub poller config — already built, not net-new
as the issue's framing implies) and `activity-source-trust-card.tsx` (trust designation + score
multiplier — also already built). This route is almost entirely composition of existing
components; the new work is the single-page layout tying them together, not new panels.

## Out of scope (unchanged by this ADR)

Per #31: tenant routes, admin dashboard, `/skill`, `/about` keep current markup. **Correction:**
#31 also lists `/things/*` — no such route exists in this codebase; it was already removed
(`62ef715 fix: remove routes for retired thing procedures`, predates this ADR). Also not mentioned
in #31 but present today: `_authenticated/organizations/*` (list/new/detail), which sits alongside
`_authenticated/tenant/*` as the same kind of out-of-demo-light surface — include it in the same
"keep current markup" bucket. Each in-scope-for-stubbing route gets a "demo polish pending" stub
per #31's companion-scrapping note; whether to archive under `<feature>.archive/` is an
implementation-time call per route, not one this ADR needs to pre-decide.

## Next steps

Once merged, per #31: split into per-page tracer-bullet tickets via `/to-tickets`. Implementation
should not start before that split, per #31's own sequencing.
