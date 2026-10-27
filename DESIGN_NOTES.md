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
              GPT-5.6 Luna     GPT-6 Luna
```

**Small, explicit boundaries.** React and TypeScript own interaction state and typed API calls. FastAPI validates requests and coordinates generation. `config.py` loads settings, `providers.py` handles external calls, and `db.py` owns SQL transactions and schema migration. SQLite provides durable local storage without another service. Sessions, comparisons, responses, votes, and annotation documents have distinct responsibilities; annotation JSON keeps a small collection of highlights together.

**Persist before starting work.** A comparison and its shuffled A/B slots are saved before two concurrent provider calls begin. Each completed answer is persisted independently, so a slow or failed peer does not erase a usable result. Both models receive the same prompt and generation settings. Polling exposes completed answers without the extra partial-text and reconnect contracts of token streaming. Only two successful responses permit a vote.

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

## Question lists and generation timing

The list editor keeps each prompt independent, including multiline code. The browser schedules one comparison at a time through the existing idempotent API. Both models start together; the next question starts immediately after polling detects a completed pair, without waiting for a vote or another timer tick. Background work never changes the selected question. A failure pauses the list, and resuming never regenerates an already-created comparison.

The queue controller is separate from the React subscription and from its editor/progress controls. Session storage retains prompts and request IDs in the current tab; answer content and notes remain in the backend. Reload restores paused, and closing the tab stops unsent work. This intentionally avoids a new backend job service for a local app. The existing per-session and global concurrency limits still apply.

The interface follows Margin's existing design system: compact neutral controls, numbered fields, a collapsible progress strip, and stable answer columns. Form/focus and restrained-motion guidance informed the controls; live Refero research was unavailable. Selecting another question uses the existing annotation flush guard. A delayed initial GET cannot overwrite a completed generation snapshot.

### Verification

- 32 backend tests and 17 frontend tests pass; TypeScript and the production build pass. No new dependencies or database migrations.
- Browser checks cover five-question paste, one-pair scheduling, pause/resume, reload recovery, blind answers, highlights and notes, voting and Next question, desktop/mobile layouts, light/dark themes, and reduced motion.
- Fault injection covers a server-accepted POST whose response is lost (same request ID reused), failed annotation saves blocking navigation, mobile drawer focus isolation, and a delayed pending snapshot arriving after completion.
- Five questions were randomly selected from a ten-question pool and submitted through the UI to GPT-5.6 Luna and GPT-6 Luna. They covered a study schedule, correlation versus causation, the Moon's rotation, Python empty-list handling, and JavaScript floating-point comparison. All ten answers completed successfully. Answers were inspected for relevance and usable formatting; this is a workflow smoke test, not a model-quality benchmark.

| Question topic | Pair completion time | Gap before this pair |
| --- | ---: | ---: |
| Two-hour study schedule | 3.50 s | First pair |
| Correlation and causation | 1.87 s | 0.13 s |
| Moon's rotation | 2.68 s | 0.37 s |
| Python empty-list handling | 2.19 s | 0.33 s |
| JavaScript floating point | 2.76 s | 0.06 s |

The final live run took 13.87 seconds from the first provider request to the last response (14.80 seconds including browser setup/actions). Mean provider latency was 2.46 seconds for GPT-5.6 Luna and 2.23 seconds for GPT-6 Luna. An earlier run exposed an extra timer delay; removing it reduced observed inter-pair gaps from 0.85–1.24 seconds to 0.06–0.37 seconds. Model latency varies, so total runtime is not a controlled speed benchmark.

The final run used 155 input / 743 output tokens for GPT-5.6 Luna and 155 input / 562 output tokens for GPT-6 Luna, including reported reasoning tokens. Estimated cost was $0.0012191; both live runs together were $0.0024263, far below the authorized $2 limit. Estimates use returned usage and official standard pricing: [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) and [OpenAI API pricing](https://developers.openai.com/api/docs/pricing). These are usage-based estimates, not a billing statement. The test harness capped each run at ten short requests and preserved the production 4,096-token output limit.
