# Copilot Instructions

Read `AGENTS.md` in the repository root first. It is the canonical source for repository architecture, workflows, conventions, and integration pitfalls.

Keep this file short and Copilot-specific:

- Use `AGENTS.md` for repo facts; avoid duplicating large sections of project documentation here.
- If `AGENTS.md` and this file ever drift, treat `AGENTS.md` as authoritative for repository behavior and update this file to match.
- Make surgical changes that preserve the existing crawler/frontend split and reuse established patterns before introducing new ones.

## Branching workflow

- Never commit directly to `master`. Always open a pull request against `master`.
- If the current branch is not `master`, do work on that branch.
- If the current branch is `master`, create a new feature branch before making any changes.

## Copilot-specific reminders

- For frontend work, keep SQL reads in `frontend/src/lib/data.js`, SQL writes (mutations) in `frontend/src/lib/actions.js`, and preserve the server-passes-promises/client-uses-`use(data)` pattern described in `AGENTS.md`.
- For crawler schema or car-field changes, update `crawler/autoscout/items.py`, `crawler/autoscout/pipelines.py`, `crawler/SCHEMA.sql`, and relevant frontend readers together.
- When deleting searches, search runs, or screenshots, collect `r2_key` values **before** the DB transaction, then call `deleteR2Objects` from `frontend/src/lib/r2.js` **after** the transaction commits. It returns `{ requestedCount, orphanedCount, reason }` instead of throwing — feed it to `r2Warning()` and return the message in the action result so the UI never reports a clean success over orphaned files. Keep `r2.js` `server-only`, not `'use server'`. See the existing `deleteSearch`, `deleteSearchRun`, and `deleteOldScreenshots` actions for the pattern.
- The `searches` table has per-search `screenshots_enabled` and `photos_enabled` boolean columns. When adding a new per-search feature flag, update `crawler/SCHEMA.sql`, the crawler spider constructor (`search.py`), the relevant pipeline, and the `updateSearch`/`toggleSearch*` server actions together.
- Do not modify `crawler/output/` unless the task is explicitly about runtime artifacts or debugging output.
- Follow the existing style conventions already documented in `AGENTS.md`: frontend uses 3-space indentation, single quotes, and no semicolons; Python stays close to PEP 8.
