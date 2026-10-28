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

## Ranked comparisons and manual retries

Goal: offer two or three distinct models, rank every answer with ties, keep separate average-rank scorecards, and retry failed answers while preserving historical data. The user approved implementation after the design discussion; the final scoring rule is average occupied position for ties, lower is better.

- [ ] Document the approved contracts in DESIGN_NOTES.md and implement a transactional, backed-up schema migration preserving all legacy data.
- [ ] Support two/three participants and complete, revisable rankings; retain legacy vote compatibility and historical counts.
- [ ] Calculate separate scorecards using average shared positions and one latest decision per comparison.
- [ ] Add explicit failed-only retries with persistent idempotency, attempt guards, and queue reconciliation.
- [ ] Extend model selection, ranking controls, compact columns, mobile tabs, history, offline fixtures, and question queues.
- [ ] Verify migration preservation, ranking math, concurrency/failure recovery, terminal suites, and desktop/mobile browser workflows using temporary databases.
- [ ] Update README, commit coherent tested steps, merge cleanly, and remove the temporary worktree. Do not push.

Reference lock: retain Margin's existing typography, neutral light/dark surfaces, accent roles, panels, native model selects, and narrow-screen tabs. Use Refero's bundled Forms and Focus States guidance for labelled rank controls and explicit save/retry feedback. The user requested narrower columns and deferred broader visual redesign. No imagery, new design system, or dependencies.

Completion requires usable two/three-model end-to-end workflows, exact preservation of historical records during migration, tied-score examples (1/2/3, 1.5/1.5/3, 1/2.5/2.5, 2/2/2), safe retries, and passing affected checks. Use offline providers and isolated databases; no paid generation or publication is part of this task.

## Selectable OpenAI models

Goal: let users choose exactly two distinct GPT text-generation models available to the backend's OpenAI API key before each comparison.

- [x] Discover available GPT text models through OpenAI's model-list API, keeping aliases and snapshots and excluding non-text modalities.
- [x] Route supported text models to their documented generation endpoints, keeping credentials server-side and avoiding automatic paid retries.
- [x] Validate and persist the chosen pair, including request-ID conflicts, while preserving randomized A/B assignment, reveal after voting, history, and scores.
- [x] Add labelled, keyboard-accessible selectors, loading/error/retry states, and responsive styling; preserve offline fixtures.
- [x] Update the README; verify automated checks, desktop/mobile interaction, and a bounded live comparison with inexpensive models.
- [x] Integrate the concurrently added question-list workflow: freeze the chosen model pair for every queued question, preserve it across reload/retry, and keep older saved lists recoverable.
- [x] Commit tested steps, merge cleanly into the original checkout, and remove the temporary worktree.

Design reference lock: the existing Margin composer owns typography, light/dark surface colors, spacing, borders, and accent roles. Use native selects with visible labels and focus states, following Refero's bundled craft guidance for forms. Keep the pair controls together above the prompt; selection order must not imply answer A/B. No new imagery or dependencies. Live Refero references were unavailable because the subscription was inactive.

Completion requires model discovery and selection to drive actual generation, safe failures without fallback, persistent model identities and scores, passing regression checks, and documented live-test limits. Use only temporary verification databases; preserve the user's existing data and local configuration.

Verification: 67 backend tests, 21 frontend tests, TypeScript checking, and the production build pass. The live catalog returned 72 GPT text entries. Short generations succeeded with GPT-4o Mini, GPT-5.4 nano, and GPT-6 Luna; a two-question live list retained the chosen GPT-4o Mini/GPT-6 Luna pair through both comparisons, voting, and reload. Browser checks covered desktop, 390px and 320px layouts, both themes, keyboard focus, duplicate prevention, model-list failure/recovery, anonymous answers, reveal, and scores. OpenAI returned model-unavailable errors for the listed legacy GPT-3.5 models; these errors stayed explicit without fallback or paid retries. Other models were not live-tested. Temporary databases isolated all verification from existing user data. The upstream Starlette/httpx deprecation warning remains.

Integration: the completed work was fast-forwarded into main after preserving concurrent question-list and motion updates. The production frontend was rebuilt, the idle local backend was restarted on its existing port and database, and the served selectors were verified. The temporary verification server and worktree were removed. No push was performed.

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

## CSV question import

Goal: import a local CSV into the existing editable question list without retyping, changing scheduling, or sending extra file columns to a model.

The preceding question-list implementation was audited and pushed to GitHub main at a5b1bb6. The audit checked all reachable file history, private paths/artifacts, credential patterns, and exact local secret matches without printing secret values.

Design reference: keep the current question-list form and its inline paste preview. Adapt bundled Refero guidance for explicit file/column labels, keyboard focus, inline errors, and preserving drafts. Reuse existing neutral surfaces and button roles; no new visual system or dependencies.

- [x] Parse UTF-8 comma-separated CSV locally, including BOM, CRLF, quoted commas, escaped quotes, and multiline cells. Reject malformed or oversized files clearly.
- [x] Detect question/prompt headers; support headerless single-column files and explicit column/header selection for other layouts.
- [x] Preview selected questions, show blank-row handling and queue limits, and append only after the user chooses Add questions. Preserve existing draft text and multiline content.
- [x] Keep file contents in the browser until imported questions are explicitly compared. Extra columns never enter the question queue.
- [x] Test parsing, validation, import cancellation/replacement, mobile/keyboard behavior, and the complete CSV-to-comparison flow with offline models. No additional paid calls are needed.
- [x] Commit tested steps, merge cleanly, rebuild the local app, and remove the temporary worktree.

Completion: valid CSV questions can be reviewed, edited, and compared through the existing queue; malformed imports do not change drafts or start requests. The existing 20-question and 12,000-character-per-question limits remain. CSV implementation commits stay local unless separately authorized for publication. The tested integration was fast-forwarded into main, the local frontend was rebuilt, and the temporary CSV worktree and offline server were removed.

CSV parser verification: 11 new tests cover UTF-8/BOM, CRLF, multiline cells, escaped quotes, column/header selection, empty rows, duplicate questions, all-or-nothing limits, malformed input, and bounded file dimensions. All 28 frontend tests and the production build pass. TypeScript permits explicit .ts imports so the same parser dependencies run directly in Node tests.

CSV UI verification: 28 frontend tests, 32 backend tests, TypeScript, and the build pass. Browser tests cover native file selection, auto/manual column mapping, headerless imports, preserving draft text, five queued comparisons, quoted multiline code, Unicode, no metadata in requests, preview gating, cancellation, invalid files, late file reads, same-file reselection, mobile light/dark layouts, and reduced motion. No additional paid requests were made. Concurrent model-selection and motion changes were integrated in the isolated worktree; their implementation and documentation were preserved. The combined suite passes 67 backend tests and 32 frontend tests, TypeScript, and the production build. The CSV browser workflow also passes with selected model pairs retained on every request and comparison disabled when model discovery is unavailable.

## Motion and feedback clarity

Goal: make the existing interaction preferences understandable and their effective device state truthful; improve spatial feedback while preserving reading, selection, saved decisions, and the question queue. The user approved renaming the menu, explaining each control, disabling unsupported vibration, and improving fluid motion.

Reference lock: retain Margin's compact paired workspace, current type, neutral light/dark surfaces, and existing accent roles. Refero live style research returned NO_SUBSCRIPTION; use its bundled Motion & Micro-interactions and Craft Details guides. Motion communicates feedback and continuity: quick control responses, soft panel entry, a passage-to-Highlights transfer and clear vote acknowledgement. UI/UX guidance reinforces reduced-motion support and limiting simultaneous movement. No palette redesign, imagery, dependencies, decorative loops, or backend changes.

- [x] Replace Interaction settings with Motion & feedback; use labelled switches, concrete descriptions, effective On/Off/Unavailable states, system-override guidance, and a safe preview that does not alter comparisons.
- [x] Keep saved preferences compatible; derive vibration availability from touch/browser capability and respect reduced motion. Make storage failures explicit and keep physical vibration claims modest.
- [x] Improve interruptible highlight transfer, panel/control transitions and vote feedback; cancel transient effects on navigation/visibility/reduced-motion changes without changing saves, focus, selection or reading state.
- [x] Test preference/capability combinations and existing frontend workflows; build/typecheck. Browser-check motion on/off, preview, highlights/votes, keyboard, both themes, narrow screens and reduced motion in an isolated offline session.
- [x] Commit tested changes, integrate cleanly with concurrent work, rebuild the local app, and record verification and physical-device limits. Attempt managed-worktree cleanup without bypassing protection.


Verification: 19 frontend tests pass, including all 32 combinations of motion/vibration preferences, system reduced-motion, touch input and vibration API availability, plus legacy/malformed preference restoration. TypeScript and production build pass. The existing queue, source-offset and scorecard tests remain green.

Browser checks in an isolated offline session verified desktop and 390px/320px layouts in light/dark, accessible switch labels and Space/Escape behavior, focus restoration, preview replay and single-flight cleanup, motion-off updates, saved preference reload, actual highlight/note saving, voting/reveal/revision and retained reasoning. Local-only capability fixtures verified system overrides, a rejected vibration request, and blocked storage guidance; they are not shipped. No browser errors were observed. No paid model calls or existing comparison data were used. Physical-device vibration and mobile selection handles remain unverified.


Integration: plan and implementation were fast-forwarded cleanly into the main checkout, and its production frontend was rebuilt. The live app was checked with Motion & feedback open and its preview working; existing comparisons were not changed. Temporary test server and browser tab were closed, the viewport was reset, and capability fixtures were removed by the production build. Managed cleanup was attempted but the app protected its primary checkout, so the clean merged worktree remains. No push or deployment was performed. Backend code was unchanged; this step reran frontend checks and the browser workflow rather than the backend suite.
