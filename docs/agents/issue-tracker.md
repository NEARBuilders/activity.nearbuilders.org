# Issue tracker: GitHub

Issues and specifications for this repository live in [NEARBuilders/activity.nearbuilders.org](https://github.com/NEARBuilders/activity.nearbuilders.org/issues). Use the `gh` CLI for tracker operations.

## Conventions

- Create one GitHub issue per implementation ticket.
- Create blocker issues before their dependents so dependency edges can reference real issue IDs.
- Use GitHub native issue dependencies for blocking relationships when available.
- Fall back to a `Blocked by` section containing issue references when native dependencies are unavailable.
- Apply `ready-for-agent` only when acceptance criteria and blocking edges make the issue independently implementable.
- Do not close or modify a parent issue while publishing child tickets.

The repository is inferred from `git remote -v` when commands run inside this clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

External pull requests are not automatically treated as feature requests by the triage workflow.

## Publishing and reading work

- Publish a ticket with `gh issue create`.
- Read a ticket and its discussion with `gh issue view <number> --comments`.
- Update labels with `gh issue edit`.
- Query the current frontier by selecting open, unassigned issues whose native blockers are all closed.
