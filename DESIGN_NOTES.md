# Margin — design notes

Margin implements the assessment's complete loop: one prompt, two model responses, side-by-side comparison, voting, a scorecard, and persistent history. The product question guiding the implementation was: **can someone return to a preference and understand what led to it?** Optional highlights and notes make that possible without turning every vote into a form.

## Problem breakdown and development approach

The first boundary was a complete vertical slice: create a comparison, generate two answers, persist them, vote, and reopen the result. A deterministic provider made the workflow and failure cases testable without API cost. Provider integration and interaction design could then evolve around the same persistence and API contracts.

The interface developed through several prototypes before the compact workspace was selected. Equal answer panes prioritize reading; the optional highlights drawer keeps supporting details close without occupying the workspace permanently. Small transitions connect an excerpt to its saved highlight. Keyboard operation, narrow-screen answer tabs, light/dark themes, and reduced-motion behavior are part of that workflow.

AI assistance was used for implementation, design exploration, and checks. The repository contains automated tests; the verification below separates those checks from manual browser and live-provider checks.

## Architecture and decisions

```text
React workspace → same-origin FastAPI → SQLite
                           ↓
                    provider interface
                     ↙           ↘
              Selected GPT    Selected GPT
```

**Small, explicit boundaries.** React and TypeScript own interaction state and typed API calls. FastAPI validates requests and coordinates generation. `config.py` loads settings, `providers.py` handles external calls, and `db.py` owns SQL transactions and schema migration. SQLite provides durable local storage without another service. Sessions, comparisons, responses, votes, and annotation documents have distinct responsibilities; annotation JSON keeps a small collection of highlights together.

**Persist before starting work.** A comparison and its shuffled A/B slots are saved before two concurrent provider calls begin. Each completed answer is persisted independently, so a slow or failed peer does not erase a usable result. Both models receive the same prompt, with endpoint-compatible generation parameters. Polling exposes completed answers without the extra partial-text and reconnect contracts of token streaming. Only two successful responses permit a vote.

**Discover before selecting.** The backend caches the OpenAI model list for five minutes and filters it to GPT text families. Users select two distinct IDs; the API checks membership and the database binds both IDs to the request ID. Catalog failures block new generation but do not block saved history or scores. A model-list entry is not proof that a generation request will succeed; provider errors remain explicit, and paid calls never retry automatically.

Creation uses a session-scoped request ID to avoid duplicate generation when the same creation request is repeated. Timeouts, output limits, one pending comparison per session, and a global concurrency cap bound work. Errors have safe user-facing messages; paid calls are not automatically retried. On restart, unfinished responses become explicitly interrupted while completed data survives. This is recovery of saved state, not resumption of a job.

**Blind choice with honest revision.** Model identities are withheld by the API until the first vote, and A/B assignment is shuffled. This reduces obvious identity and position cues; it cannot prevent guessing a model from its writing. Each browser session sees only its own records. An HTTP-only cookie carries a random token; the database stores its hash. This avoids account setup, at the cost of recovery and cross-device access.

Changing a vote remains possible after reveal, but is labelled accordingly. Highlights and reasoning freeze on the first vote, preserving the original context. There is one current vote per comparison, and scores are calculated from those rows rather than incrementing counters. Revisions therefore cannot inflate totals. This is a personal win/tie/loss scorecard, not an Elo system or controlled benchmark.

**Source fidelity and save correctness.** Highlights reference exact text ranges, validated against the stored response. Python and TypeScript use Unicode code-point offsets consistently. A small safe formatting layer preserves those positions without rendering arbitrary HTML. Annotation saves are serialized and debounced; voting and internal navigation flush pending edits. Revision numbers reject stale writes from another tab instead of silently overwriting them. Save errors remain visible, with retry or explicit reload.

## Verification

A clean Git clone was checked by following the README, without copying an API key, database, dependencies, or generated build:

- Locked dependency installation, **32 backend tests**, **8 frontend tests**, TypeScript checking, and the production build.
- Backend coverage includes provider contracts/errors, parallel generation and partial failure, creation idempotency, session isolation, schema migration, exact/Unicode highlights, stale writes, frozen annotations, revised scores, and restart recovery.
- Frontend tests check source formatting, highlight ranges, and score calculations, including overlapping marks, ties, revised votes, and historical model pairs. Browser checks in the clean clone exercised offline generation, annotations, vote/revision, notebook history, scores, and reopening after a real server restart. Independent HTTP checks verified session isolation and that private configuration/database files are not served.

During implementation, browser checks separately exercised real responses from both exact model IDs, reveal, text/code highlights, notes, save failure/retry, vote revisions, reloads, and persistence after restart. Desktop and 390px/320px phone layouts were checked in both themes, including focus handling and reduced-motion support. These browser/live checks are manual evidence, not an automated end-to-end suite. Physical-device vibration and mobile selection handles, a full assistive-technology audit, and production load behavior remain unverified. The backend suite currently emits one upstream Starlette/httpx deprecation warning.

## With more time

1. **Before public hosting:** protect API spending with access and abuse controls; move generation to durable jobs; add monitoring, backups, and a clear retention/deletion policy. The current single-process task model is deliberately unsuitable for multiple workers.
2. **Strengthen regression coverage:** automate the browser save/reveal/revise workflow and test physical devices and assistive technologies.
3. **Improve reading and evaluation:** broaden safe Markdown support, add streaming with explicit partial-result semantics, and support curated prompt sets before drawing stronger conclusions from scores.

All required assessment workflows are implemented. Public deployment is optional and has not been prepared; the application currently runs locally.
