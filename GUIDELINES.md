# Margin development guidelines

## Goal

Keep Margin easy to run from a clean checkout: one prompt or a question list, two anonymous model responses per question, optional highlights and notes, voting, and persistent personal history and scores.

## Project layout and contracts

- Run project commands from the repository root unless the README specifies `backend/`.
- `backend/app/config.py` owns configuration; `providers.py` owns model calls; `db.py` owns persistence; `main.py` owns the API.
- `frontend/src/` owns the React workspace. `demo/` contains optional, retired interface prototypes.
- Keep API credentials on the backend. Never commit `.env`, databases, logs, generated builds, or machine-specific development notes.
- Offline mode must work without credentials and remain clearly labelled. Live failures must never silently use fixtures or retry paid calls.
- Preserve session isolation, blind answers until voting, source-validated highlights, saved reasoning, and one latest vote per comparison.
- Run a single backend worker. Use temporary databases for verification, never an existing user's data.

## Change workflow

Document the goal and completion criteria here before implementation. Make focused changes, preserve existing work, test affected behavior, and commit coherent steps. Use an isolated worktree for large or risky changes. Publishing requires an explicit request.

## Selectable OpenAI models

Goal: let users choose exactly two distinct GPT text-generation models available to the backend's OpenAI API key before each comparison.

- [x] Discover available GPT text models through OpenAI's model-list API, keeping aliases and snapshots and excluding non-text modalities.
- [x] Route supported text models to their documented generation endpoints, keeping credentials server-side and avoiding automatic paid retries.
- [x] Validate and persist the chosen pair, including request-ID conflicts, while preserving randomized A/B assignment, reveal after voting, history, and scores.
- [x] Add labelled, keyboard-accessible selectors, loading/error/retry states, and responsive styling; preserve offline fixtures.
- [x] Update the README; verify automated checks, desktop/mobile interaction, and a bounded live comparison with inexpensive models.
- [x] Integrate the concurrently added question-list workflow: freeze the chosen model pair for every queued question, preserve it across reload/retry, and keep older saved lists recoverable.
- [ ] Commit tested steps, merge cleanly into the original checkout, and remove the temporary worktree.

Design reference lock: the existing Margin composer owns typography, light/dark surface colors, spacing, borders, and accent roles. Use native selects with visible labels and focus states, following Refero's bundled craft guidance for forms. Keep the pair controls together above the prompt; selection order must not imply answer A/B. No new imagery or dependencies. Live Refero references were unavailable because the subscription was inactive.

Completion requires model discovery and selection to drive actual generation, safe failures without fallback, persistent model identities and scores, passing regression checks, and documented live-test limits. Use only temporary verification databases; preserve the user's existing data and local configuration.

Verification: 67 backend tests, 19 frontend tests, TypeScript checking, and the production build pass. The live catalog returned 72 GPT text entries. Short generations succeeded with GPT-4o Mini, GPT-5.4 nano, and GPT-6 Luna; a two-question live list retained the chosen GPT-4o Mini/GPT-6 Luna pair through both comparisons, voting, and reload. Browser checks covered desktop, 390px and 320px layouts, both themes, keyboard focus, duplicate prevention, model-list failure/recovery, anonymous answers, reveal, and scores. OpenAI returned model-unavailable errors for the listed legacy GPT-3.5 models; these errors stayed explicit without fallback or paid retries. Other models were not live-tested. Temporary databases isolated all verification from existing user data. The upstream Starlette/httpx deprecation warning remains.

## Public repository preparation

Goal: remove private development information from all publishable history and verify the documented setup from a clean clone.

- [x] Audit tracked files, history, ignored configuration, and internal Git references.
- [x] Replace private development notes with this portable guide.
- [x] Preserve an external local recovery copy and coordinate with existing work before rewriting history.
- [x] Remove historical private guidelines, machine-specific wording, and internal snapshot references containing unrelated personal files.
- [x] Clone the cleaned history without copying local configuration, dependencies, databases, or generated files.
- [x] Follow the README to install locked dependencies, build, start offline mode, and exercise comparison, annotations, voting, history, scores, and restart persistence.
- [x] Run the test suites and a browser check, then scan the final history and clone for private data.

Completion requires a clean working tree, no private data in publishable references, and a reproducible credential-free setup. Existing commit attribution is preserved. Live-provider access remains dependent on the reader's own credentials and model permissions.

Verification: the cleanup preserved application files and attribution across 52 commits and four branches. Private historical notes and internal personal-file snapshots were removed. Git integrity and all-object privacy scans pass. A fresh clone installed with `npm ci` and `uv sync --locked`; 32 backend tests, eight frontend tests, TypeScript checking, and the production build pass. Browser checks verified offline generation, highlights and notes, model reveal, vote revision, notebook reopening, scores, and persistence across a real server restart. An independent session could not read the saved comparison, and private configuration/database paths returned HTTP 404. No live API key was copied or used during this verification. The existing Starlette test-client deprecation warning remains. No push or deployment was performed.

## Multiple-question workflow

Goal: enter a list once and compare each independent answer pair without repeatedly returning to the composer.

Design: keep Margin's current typography, neutral surfaces, compact controls, and accent roles. The existing interface is the visual reference; Refero live research was unavailable. Bundled form/focus and motion guidance informs labelled fields, visible focus, stable reading position, and restrained state feedback.

- [x] Add labelled question rows and paste-list entry, preserving multiline single prompts.
- [x] Run one pair at a time; start the next question after both answers settle, while the user reads or votes. Never automatically navigate or reveal identities.
- [x] Show queued/generating/ready/failed states and pause/resume. Pause after failures; never automatically retry a paid generation.
- [x] Reuse request IDs across reconnects; preserve the queue in this tab's session storage, restoring paused after reload. Completed comparisons stay in the existing notebook.
- [x] Preserve annotation flush guards, single-prompt behavior, mobile controls, and reduced motion.
- [x] Verify scheduling, errors, duplicate prevention, persistence, browser interactions, and five varied questions against both configured live models for less than $2.
- [x] Commit tested steps, merge cleanly into the original checkout, and remove the temporary worktree.

Scope: the existing API and per-session generation limit remain the source of truth. Queue orchestration lives in the browser; closing the tab stops unsent questions. No backend queue service or dependencies are needed.

Completion requires passing automated checks and browser evidence, recorded real-model latency/usage, and clear limits on recovery and cost measurement.

Queue verification: eight focused scheduler tests cover five-item order, overlapping ticks, pause during creation, incomplete pairs, lost POST responses, failed GET recovery, reload behavior, and input limits. They pass with the existing frontend tests.

UI verification: 17 frontend tests, 32 backend tests, TypeScript, and the production build pass. Desktop/mobile browser checks and injected network/save/delayed-read failures pass. Two live five-question runs produced 20 successful responses for an estimated $0.0024263 total. Final generation time was 13.87 seconds, with 0.06–0.37 second inter-pair gaps. Detailed evidence and pricing sources are recorded in DESIGN_NOTES.md.

Integration: the tested commits were fast-forward merged into the original checkout, its frontend was rebuilt, and the temporary worktree and test servers were removed. No push was performed.
