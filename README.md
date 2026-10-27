# Margin

Compare two AI answers, keep the details that matter, and remember why you chose one.

Margin sends the same prompt to **GPT-5.6 Luna** and **GPT-6 Luna**, presents their answers anonymously, and reveals the models after you vote. Your comparisons, highlights, notes, and latest votes stay in a personal notebook and scorecard.

Built with React, TypeScript, FastAPI, and SQLite. See [Design notes](DESIGN_NOTES.md) for the approach, tradeoffs, and verification.

## Try it locally

### Prerequisites

- Python **3.12 or newer** and [uv](https://docs.astral.sh/uv/getting-started/installation/).
- Node.js **24 or newer**, with npm.
- For live answers: an OpenAI API key with API credits and access to both configured models. Offline mode needs no key.

The commands below use a macOS/Linux shell. Run them from the project root, the folder containing `backend/` and `frontend/`.

### 1. Install and build

```sh
# Preserve an existing configuration.
test -f .env || cp .env.example .env
chmod 600 .env

npm ci --prefix frontend
npm run build --prefix frontend
cd backend
uv sync --locked
```

### 2. Start with offline examples

From `backend/`:

```sh
MARGIN_PROVIDER=mock uv run uvicorn app.main:app --host 127.0.0.1 --port 8767
```

Open [Margin locally](http://127.0.0.1:8767/). The interface labels offline fixtures clearly. They exercise the complete saving and voting workflow, but are **not AI-generated answers**. Stop the server with Ctrl+C.

### 3. Connect live models

Edit the project-root `.env` privately:

```dotenv
OPENAI_API_KEY=your-own-api-key
MARGIN_PROVIDER=openai
```

Then restart from `backend/`, without the `MARGIN_PROVIDER=mock` command prefix:

```sh
uv run uvicorn app.main:app --host 127.0.0.1 --port 8767
```

Check that the interface says **Live models** before comparing. Exported environment variables take precedence over `.env`; unset an exported `MARGIN_PROVIDER` if it keeps the app in offline mode. Each new live comparison makes two API requests and may incur charges. Failures never silently substitute offline answers or automatically retry paid requests.

The key stays on the backend. `.env` is ignored by Git; never put the key in frontend code or a variable prefixed with `VITE_`.

## Using Margin

1. **Ask once.** Enter a prompt and start a comparison. The two requests run concurrently; an answer appears when it finishes.
2. **Read A and B.** Compare side by side on desktop, or switch answer tabs on a narrow screen. Model names stay hidden until you vote.
3. **Keep useful details, optionally.** Select text or use a paragraph's Highlight control. Keep several passages from either answer and add a note to each. An overall reason and decision note are separate from individual highlights. Highlights record what influenced your choice; they are not citations or an automated fact check.
4. **Vote A, B, or tie.** Voting reveals the models and freezes your highlights and reasoning as a snapshot. You can vote without adding any notes. Both answers must finish successfully before voting is available.
5. **Revisit or revise.** Open a saved comparison from the notebook. Change vote updates your choice, preserves the original notes, and labels the result **Edited after reveal**. Each comparison contributes only its latest vote to the scorecard.

Draft notes save automatically. If saving fails, retry or deliberately reload the saved version before leaving. Light mode is the default; your explicit theme choice is remembered. Motion respects your reduced-motion preference.

### History and privacy

History belongs to an anonymous browser session, identified by an HTTP-only cookie. Use the same browser profile and address to return later: `localhost` and `127.0.0.1` have separate cookies. Clearing cookies or using private browsing can lose access to saved history. There is no account recovery or device sync.

Prompts, answers, highlights, and votes are stored in the local SQLite database. In live mode, prompts are also sent to OpenAI. Highlight notes and decision notes are not sent with generation requests. The provider requests `store=false`; that flag is not a guarantee of zero provider-side retention.

## Configuration

The backend reads `.env` from the project root. Restart it after changing settings.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Required for live mode; unused in mock mode. |
| `MARGIN_PROVIDER` | `openai` | `openai` for live answers, `mock` for deterministic offline fixtures. |
| `MARGIN_DATABASE_PATH` | `backend/data/margin.sqlite3` in the project | Optional database location. Prefer an absolute path; relative paths use the server's working directory. |
| `MARGIN_MODEL_TIMEOUT` | `90` | Deadline per answer in seconds; greater than 0 and at most 120. |
| `MARGIN_MAX_ACTIVE` | `4` | Concurrent comparisons across all sessions; 1–16. Each session can have one pending comparison. |
| `MARGIN_COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS; leave `false` for local HTTP. |

The database directory and schema are created automatically. The configured model IDs are `gpt-5.6-luna` and `gpt-6-luna` in [providers.py](backend/app/providers.py). Both receive the same prompt, low reasoning effort, and a 4,096 output-token cap. A refused, truncated, failed, or timed-out answer cannot be voted on.

**Run one backend process, with one worker.** Generation runs in that process. Restarting preserves completed data and marks unfinished responses as interrupted; it does not resume their model requests.

## Development and checks

For frontend development, keep the backend running on port 8767. In another terminal at the project root:

```sh
npm run dev --prefix frontend
```

Open [the development frontend](http://127.0.0.1:5174/). Vite proxies `/api` to the backend. The server on port 8767 serves the last production build; rebuild the frontend to update that version.

Run checks from the project root after installing dependencies:

```sh
(cd backend && MARGIN_PROVIDER=mock uv run pytest -q)
npm test --prefix frontend
npm run build --prefix frontend
```

The build includes TypeScript checking. Automated tests use fixtures and do not spend API credits. API schemas are available at [local API docs](http://127.0.0.1:8767/docs), and [health status](http://127.0.0.1:8767/api/health) reports the selected provider. Health status alone does not verify API credentials or model access.

```text
backend/app/       Configuration, providers, API, and SQLite persistence
backend/tests/     Provider, API, database, and migration tests
frontend/src/      Comparison workspace, annotation saving, and rendering
.env.example       Configuration template without credentials
DESIGN_NOTES.md    Engineering decisions and verification
```

### Troubleshooting

- **The page is missing or out of date:** run `npm run build --prefix frontend` from the project root, then restart the backend.
- **Live generation fails:** check the visible error, API key, API credits, model access, and network connection. The exact configured model IDs must be available to your API project. Offline mode remains available for testing the app.
- **An answer is interrupted or times out:** the existing comparison retains whatever completed. Start a new comparison to retry; this makes new model requests.
- **A save conflicts with another tab:** the app rejects the stale update. Preserve any text you need before reloading the saved version.
- **History seems empty:** return to the same browser profile, hostname, and database. Copying the database alone does not restore a lost session cookie.

## Scope

Margin is a local assessment application. Its scorecard reflects your own prompts and preferences, not a global model ranking. Responses support a small safe Markdown subset; unsupported syntax remains readable source text.

Public hosting would need access and abuse controls, durable background jobs, operational monitoring, and a backup/retention policy. The local URLs above are not a public demo. Further tradeoffs and priorities are described in [Design notes](DESIGN_NOTES.md).
