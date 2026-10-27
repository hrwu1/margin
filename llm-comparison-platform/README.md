# Margin

A compact workspace for comparing **GPT-5.6 Luna** and **GPT-6 Luna**. Enter one prompt, read two anonymous answers, optionally keep exact highlights and notes, then vote to reveal the models. Reopen any comparison from the notebook. Change a vote after reveal without losing the original reasoning; the scorecard counts only the latest choice.

Built with React + TypeScript, FastAPI, and SQLite. `demo/` contains retired visual explorations; the working application is `frontend/` + `backend/`.

## Run locally

Requirements: Python 3.12+, [uv](https://docs.astral.sh/uv/), Node.js 24+, npm.

From this project directory:

```sh
cp .env.example .env  # only if .env does not already exist
# Add your own OPENAI_API_KEY to .env. Never commit it.
chmod 600 .env
npm ci --prefix frontend
npm run build --prefix frontend
cd backend
uv sync --locked
uv run uvicorn app.main:app --host 127.0.0.1 --port 8767
```

Open **http://127.0.0.1:8767/**. Keep one server process; do not add multiple workers. The backend reads the project-root `.env` automatically, with exported environment variables taking precedence. The key stays on the server. The frontend build never reads it.

New checkouts need their own API key for live mode. `.env`, virtual environments, generated frontend files, SQLite files and logs under `backend/data/` are ignored by Git.

For offline development, explicitly set `MARGIN_PROVIDER=mock`. The interface labels these deterministic fixtures; no network request or AI model is used. There is no fallback from live failures to mock answers.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | required in live mode | Server-only OpenAI project key |
| `MARGIN_PROVIDER` | `openai` | `openai` or explicit `mock` |
| `MARGIN_DATABASE_PATH` | `backend/data/margin.sqlite3` | SQLite file |
| `MARGIN_MODEL_TIMEOUT` | `90` | Per-model deadline, up to 120 seconds |
| `MARGIN_MAX_ACTIVE` | `4` | Maximum concurrent comparisons across sessions, up to 16 |
| `MARGIN_COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS |

Both exact model IDs are configured in `backend/app/providers.py`. They receive the same prompt and settings: Responses API, low reasoning effort, 4,096 output-token limit, and `store=false`. Output limits include reasoning tokens; truncated, refused, failed or timed-out answers cannot be voted on. Paid requests are never automatically retried.

For frontend development, run the backend as above, then `npm run dev --prefix frontend`. Vite binds port 5174 and proxies `/api` to port 8767.

## Checks

```sh
cd backend
MARGIN_PROVIDER=mock uv run pytest -q
cd ../frontend
npm test
npm run build
```

Backend tests cover source-validated highlights, Unicode offsets, migration from schema v1, session isolation, creation idempotency, concurrent generation, partial failures, safe provider errors, annotation freezing, stale-write rejection, vote revisions, derived scores and restart recovery. Provider contract tests do not spend API credits. Small live smoke requests separately verified both exact models.

Browser verification covers live generation, text/code highlights, notes, autosave before voting, reload/restart persistence, model reveal, editable votes and score updates, notebook navigation, light/dark modes, keyboard focus, and phone widths. Physical-device vibration and mobile selection handles require real-device testing.

## Implementation and product decisions

- **Backend boundaries:** `config.py` loads server settings, `providers.py` owns model calls, `db.py` owns transactions/migrations, and `main.py` owns validation, sessions and routes. The provider interface also supports deterministic tests.
- **Durable work first:** a comparison and two shuffled response slots are persisted before concurrent generation begins. Completed answers are independently saved. The client polls for completion; there is no token streaming. On restart, unfinished responses become explicit interrupted failures while completed answers remain intact.
- **Anonymous sessions:** a random, HTTP-only SameSite cookie connects this browser to its comparisons. Only a hash is stored. Every history, answer, annotation, vote and score query is session-scoped. Model identities are omitted from answer payloads until voting. Clearing cookies loses access to the session's history; there is no account recovery or device sync.
- **Evidence without friction:** highlights are optional. Multiple full passages or exact excerpts from either answer can carry their own notes, alongside an overall reason and note. The backend verifies every quote against stored source text. Unicode offsets use code points consistently in Python and TypeScript.
- **Honest revision:** annotations become read-only with the first vote. A separate vote revision changes the latest choice and marks it “Edited after reveal.” Scores are derived from persisted votes; no duplicate counters or inflated totals.
- **Save correctness:** annotation saves are serialized, typing is debounced, and voting/navigation flush pending edits. Optimistic revision numbers reject stale writes from another tab. Failed saves remain visible and prevent accidental navigation; retry or deliberately reload the saved version.
- **Readable and safe output:** responses support paragraphs, headings, fenced code, inline code and bold text while retaining exact source positions. Other Markdown remains source text; HTML is never executed, and model-supplied images are not loaded.
- **Interaction design:** the approved Refero-informed compact shell, independent reading panes, optional highlights drawer, excerpt transfer, theme preference, mobile A/B tabs and editable vote dock remain intact. Motion respects reduced-motion preferences. Vibration is capability-aware and always has a visible equivalent.

API: `POST /api/session`, `POST /api/comparisons`, `GET /api/comparisons`, `GET /api/comparisons/{id}`, `PUT /api/comparisons/{id}/annotations`, `POST /api/comparisons/{id}/vote`, `PATCH /api/comparisons/{id}/vote`, and `GET /api/scores`. Mutation requests require `X-Margin-Client: web` and same-origin browser requests. API responses are not cached. See `/docs` for schemas.

## Deliberate limits

This is a local assessment app, not an internet-hardened hosted service. It uses one server process, SQLite and in-process generation. Before public hosting, add deployment authentication/abuse limits, a durable job queue, operational monitoring, backups/retention, and a clear account/privacy policy. A shared anonymous internet endpoint could otherwise spend the project's API credits. API prompts leave the machine for OpenAI; notes are stored only in the app's SQLite database.

A personal scorecard records preferences from a small, self-selected sample; it is not a global benchmark. Future improvements should prioritize broader Markdown support, token streaming, and real-device accessibility testing before adding more visual directions.

Implementation plans, source requirements, reference decisions and delivery evidence are maintained in `GUIDELINES.md`. No push or deployment is part of this change.
