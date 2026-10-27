# Margin

A small comparison app: enter a prompt, read two anonymous responses, vote, and revisit the decision with optional paragraph evidence. The Python API stores the entire workflow in SQLite; the React/TypeScript client is deliberately minimal while the final design remains open.

**Current provider: local test fixtures.** The app accepts arbitrary prompts, but its two responses are deterministic fixtures, not language-model output. No API credentials are configured and no external model calls are made. Connecting two real models remains pending the provider/credential choice. The separate `demo/` directory contains interactive design prototypes; the current Refero-based workspace is at `/workspace/`.

## Run locally

Tested with Python 3.12, Node.js 24, npm, and [uv](https://docs.astral.sh/uv/). Run from `llm-comparison-platform`:

```sh
cd frontend
npm ci
npm run build
cd ../backend
uv sync --frozen
uv run uvicorn app.main:app --host 127.0.0.1 --port 8767 --workers 1
```

Open **http://127.0.0.1:8767/**. The API serves the built frontend on the same origin. API documentation is at `/docs`. Build the frontend before starting the API.

For frontend development, keep the API running and run `npm run dev` from `frontend/`. Open http://127.0.0.1:5174/; Vite proxies `/api` to port 8767. Use the same hostname consistently because browser cookies are hostname-scoped.

For the static design demos: `python3 -m http.server 8766 --bind 127.0.0.1 --directory demo` from the project root.

- **Current interactive workspace: http://127.0.0.1:8766/workspace/**. Compact paired answers, a shared prompt, and an optional evidence drawer. Select an exact excerpt or use a passage’s + control, add a reason/note, then vote to reveal the fictional model names. Drafts and votes persist on this device; Change vote lets you revise A/B/tie while preserving notes/evidence, labels actual revisions Edited after reveal, and updates the scorecard; the notebook reopens saved evidence and the scorecard follows model identities when sides swap.
- The workspace uses fluid panel resizing, local state transitions, and in-place identity reveal. Settings can disable motion; system reduced-motion takes precedence. Optional vibration requires a supported touch device/browser and has not been physically tested. Phone layouts use answer tabs and an evidence sheet.
- Retired design explorations remain available for history at `/bold/`, `/directions/`, and `/`. They are not approved design targets.
- All demos are standalone HTML/CSS/JS with prewritten answers and fictional models. They do not call the API or modify SQLite. The new design has not been integrated into React. Its exact excerpts, two-sided evidence, and freeform notes are prototype features and will need API/schema work if adopted.
- Prototype checks: `node --test demo/demo.test.mjs demo/directions/app.test.mjs demo/bold/*.test.mjs demo/workspace/*.test.mjs`.

## Configuration and data

Export variables in the backend process; `.env.example` documents them and is **not automatically loaded**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MARGIN_PROVIDER` | `mock` | Explicit local test provider. Other values fail startup rather than silently returning mock data. |
| `MARGIN_DATABASE_PATH` | `backend/data/margin.sqlite3` | SQLite file; use an absolute path to store it elsewhere. |
| `MARGIN_MODEL_TIMEOUT` | `30` | Per-response timeout in seconds; maximum 120. |
| `MARGIN_MAX_ACTIVE` | `4` | Server-wide active comparisons; maximum 16. Each browser session can run one at a time. |
| `MARGIN_COOKIE_SECURE` | `false` | Use `true` when serving through HTTPS. Local HTTP needs `false`. |

Database files, `.env` files, build outputs, dependencies, and virtual environments are ignored by Git. Tables are initialized automatically and tracked with SQLite `user_version=1`. Existing data is preserved on startup. Unknown newer schemas are rejected.

Anonymous sessions use a random HTTP-only, SameSite cookie. Only the token hash is stored in the database. Comparisons and scores belong to that session; another browser/session receives no access to them. Clearing the cookie starts a new history and does not delete the old server records. There is no account recovery or cross-device sync.

## API contract

All mutations require `X-Margin-Client: web`; JSON requests also use `Content-Type: application/json`. Browser mutations must come from the same origin. There is no cross-origin API configuration.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/session` | Create or resume an anonymous session; sets the HTTP-only cookie. |
| `POST /api/comparisons` | Accept `{ "request_id": "UUID", "prompt": "…" }`; return a persisted comparison immediately. |
| `GET /api/comparisons/{id}` | Read both response states and the saved vote, if any. |
| `POST /api/comparisons/{id}/vote` | Accept `choice` (`A`, `B`, `tie`), optional `reason`, and optional `evidence`. |
| `GET /api/comparisons?limit=20&offset=0` | Read this session's newest-first history; `has_more` supports pagination. |
| `GET /api/scores` | Counts derived from this session's persisted votes. |
| `GET /api/health` | Process health and explicit provider mode. |

Example vote body:

```json
{
  "choice": "A",
  "reason": "Clarity",
  "evidence": { "side": "A", "paragraph_index": 1 }
}
```

Evidence uses a zero-based index into the response's returned `paragraphs` array. The server validates the index and returns the exact stored quote. Evidence can refer to either answer, including a weakness in the answer that lost. Supported reasons are Clarity, Depth, Practicality, and Follows the prompt. Both fields are optional.

## Design decisions

- **Clear module responsibilities:** `backend/app/db.py` owns transactions and queries; `providers.py` defines the async provider interface and local fixture; `main.py` owns HTTP validation, session boundaries, generation lifecycle, and public response shaping. `config.py` reads runtime settings. The frontend's typed API client is separate from its comparison/voting component.
- **Persist first, then generate:** a comparison and both randomly assigned response slots are committed before calls start. The two calls run concurrently and save their individual outcomes. The client polls, so a completed answer remains visible while the other is pending or failed.
- **Honest blind comparison:** model identifiers are absent from response payloads until the vote is saved. This is an API rule, not a CSS trick. Response text itself can still contain a provider's self-identification; the app does not rewrite model output.
- **Idempotent creation:** `(session, request_id)` is unique. Repeating the same request returns the existing comparison; changing its prompt with the same ID returns 409. The client retains its request ID after a network failure. Active-work limits return 429.
- **One immutable vote:** the database primary key and a short write transaction prevent concurrent duplicate votes. Repeating the identical vote returns the saved result; changing it after reveal returns 409. A vote requires two successful responses. Scores are queried from votes, never incremented in separate counters.
- **Failure boundaries:** each response has a deadline. Empty/oversized output and provider errors become safe per-response messages. Provider exception strings are not returned or logged because they may contain prompts or credentials. No automatic model-call retries occur.
- **Restart behavior:** pending work becomes interrupted/failed when the server starts. Already completed answers and votes remain intact. This process-local task runner is intentionally limited to **one API worker**; use a durable job queue before running multiple workers or hosts.
- **Small persistence layer:** SQLite uses foreign keys, WAL, a busy timeout, a session/history index, and bound query parameters. Database operations run outside the async event loop. It is suitable for the assessment's local single-server scope.
- **Minimal UI:** text is rendered through React without raw HTML. Voting, reason/evidence, failure messages, history, pagination, and score counts are functional. Markdown polish, streaming tokens, and final visual design are deferred.

## Verification

```sh
cd backend
uv run pytest -q
cd ../frontend
npm run build
```

The backend suite covers session isolation, request deduplication, concurrent voting, evidence bounds, model identity when A/B sides swap, tie counts, SQL persistence, hidden model names, partial completion, timeouts, invalid output, safe provider errors, same-origin mutations, input validation, and restart recovery. Tests use temporary databases and injected providers; they make no live model calls.

The browser acceptance path is: enter a prompt → receive both responses → mark a paragraph → choose a reason → vote → view scorecard/history → reopen → reload. Check this path on desktop and phone widths. `GUIDELINES.md` records completed checks and remaining work.

Current limitations: no real model integration yet, no deployment, and no final frontend design. Live API behavior and billing are unverified. This is not ready to claim the assessment's two-real-model requirement is complete.

Implementation references: [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/), [Python SQLite](https://docs.python.org/3.12/library/sqlite3.html), [Vite](https://vite.dev/guide/), and [React createRoot](https://react.dev/reference/react-dom/client/createRoot).
