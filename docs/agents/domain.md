# Domain docs

This repository uses a single-context domain documentation layout.

## Before exploring

Read these resources when they exist:

- `CONTEXT.md` at the repository root
- relevant decisions under `docs/adr/`

If they do not exist, proceed silently. Domain-modeling work creates them when terminology or architectural decisions need to be recorded.

## Layout

```text
/
├── CONTEXT.md
├── docs/adr/
└── api/ and ui/
```

Use terminology defined by `CONTEXT.md` in issue titles, implementation plans, schemas, APIs, UI language, and tests. If proposed work conflicts with an existing ADR, call out the conflict explicitly instead of silently replacing the decision.
