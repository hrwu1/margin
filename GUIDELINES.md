# Margin development guidelines

## Goal

Keep Margin easy to run from a clean checkout: one prompt, two anonymous model responses, optional highlights and notes, voting, and persistent personal history and scores.

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

- [ ] Discover available GPT text models through OpenAI's model-list API, keeping aliases and snapshots and excluding non-text modalities.
- [ ] Route supported text models to their documented generation endpoints, keeping credentials server-side and avoiding automatic paid retries.
- [ ] Validate and persist the chosen pair, including request-ID conflicts, while preserving randomized A/B assignment, reveal after voting, history, and scores.
- [ ] Add labelled, keyboard-accessible selectors, loading/error/retry states, and responsive styling; preserve offline fixtures.
- [ ] Update the README; verify automated checks, desktop/mobile interaction, and a bounded live comparison with inexpensive models.
- [ ] Commit tested steps, merge cleanly into the original checkout, and remove the temporary worktree.

Design reference lock: the existing Margin composer owns typography, light/dark surface colors, spacing, borders, and accent roles. Use native selects with visible labels and focus states, following Refero's bundled craft guidance for forms. Keep the pair controls together above the prompt; selection order must not imply answer A/B. No new imagery or dependencies. Live Refero references were unavailable because the subscription was inactive.

Completion requires model discovery and selection to drive actual generation, safe failures without fallback, persistent model identities and scores, passing regression checks, and documented live-test limits. Use only temporary verification databases; preserve the user's existing data and local configuration.

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
