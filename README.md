# Margin

Compare two or three AI answers, keep the details that matter, and remember why you chose one.

Margin lets you choose **two or three OpenAI GPT text-generation models**, sends them the same prompt, presents their answers in randomized A/B or A/B/C order, and reveals which model wrote each answer after you save a complete ranking. Your comparisons, highlights, notes, and latest rankings stay in a personal notebook and scorecard.

Built with React, TypeScript, FastAPI, and SQLite. See [Design notes](DESIGN_NOTES.md) for the approach, tradeoffs, and verification.

## Try it locally

### Prerequisites

- Python **3.12 or newer** and [uv](https://docs.astral.sh/uv/getting-started/installation/).
- Node.js **24 or newer**, with npm.
- For live answers: an OpenAI API key with API credits, permission to list models, and access to the selected models. Offline mode needs no key.

Clone or download this repository, then open a terminal in its root, the folder containing `backend/` and `frontend/`. The commands below use a macOS/Linux shell. No database server, existing database, or local configuration is needed.

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

Check that the interface says **Live models** before comparing. Exported environment variables take precedence over `.env`; unset an exported `MARGIN_PROVIDER` if it keeps the app in offline mode. Each new live comparison makes one API request per selected model and may incur charges. Failures never silently substitute offline answers or automatically retry paid requests.

The key stays on the backend. `.env` is ignored by Git; never put the key in frontend code or a variable prefixed with `VITE_`.

## Using Margin

1. **Choose two or three models, then add your questions.** Choose the number of models and pick distinct entries from the model lists. Enter a single prompt, or choose **Question list** to add up to 20 questions. **Paste a list** accepts one question per line; individual fields support multiline prompts and code. The start button shows the number of questions and model calls. Selection order does not determine the anonymous answer labels.
2. **Read every answer.** Compare side by side on desktop, or switch answer tabs on a narrow screen. Model names stay hidden until you save a ranking.
3. **Keep useful details, optionally.** Select text or use a paragraph's Highlight control. Keep several passages from any answer and add a note to each. An overall reason and decision note are separate from individual highlights. Highlights record what influenced your choice; they are not citations or an automated fact check.
4. **Rank every answer.** Give each answer a number from 1 through the number of answers; at least one must be ranked 1. Equal ranks mean ties, and gaps do not change relative preference. Save ranking reveals the models and freezes highlights and reasoning as a snapshot. Notes are optional. Every answer must finish successfully before ranking is available.
5. **Revisit or revise.** Open a saved comparison from the notebook. Change ranking updates your decision, preserves the original notes, and labels the result **Edited after reveal**. Each comparison contributes only its latest ranking to the scorecard.

### Comparing a question list

Each question is an independent comparison with the same models selected when you start the list. The chosen model set is saved with each queued question and retained across pause, resume, and reload. All selected models run concurrently for that question. Once all responses finish, the next question starts automatically while you read, highlight, or rank. Only one comparison runs at a time; the workspace never switches questions automatically. Use **Next question** or expand the queue to open a comparison.

**Pause queue** stops new questions after the current comparison finishes. A model or connection failure pauses the queue; **Resume queue** reconnects using the existing request ID and continues remaining questions. Failed answers are retained, not automatically retried. After pausing, expand the queue to discard unsent questions once the current request is resolved. Completed comparisons remain in the notebook.

The queue is kept in this tab's session storage. Keep the tab open to send remaining questions. Reloading restores the list paused and checks any known in-progress comparison; press **Resume queue** to send more. Closing the tab can lose unsent questions. A lost creation response is reconciled using the same request ID before the queue can be cleared, preventing accidental duplicate requests. Each started question makes two or three potentially billable model requests. A 20-question list with three models makes 60 calls; pausing does not cancel an already-started comparison.

### Retrying failed answers

Once all current responses settle, **Retry failed answers** reruns only failed answers with their original prompt, models, and anonymous labels. Successful answers, highlights, and notes remain intact. A retry cannot run after a decision is saved, and the existing one-active-comparison limit still applies.

Retries require an explicit action; there are no automatic new generation attempts. A timed-out request may already be billable, so retrying can incur additional charges. Fix quota, credentials, or model availability errors before retrying when needed; changing models or the prompt starts a new comparison.

If an acknowledgement is lost, **Reconnect retry** reconciles the existing attempt. Reloading restores that operation from this tab's session storage. Duplicate requests do not dispatch duplicate attempts, and stale completions cannot overwrite a newer attempt. Remaining queued questions stay paused during and after retry; use **Resume queue** when ready to continue. Closing the tab can lose an unresolved browser operation, but the comparison and its attempt remain saved on the server.

### Average-rank scorecards

Two-model and three-model comparisons have separate scorecards. Lower average rank is better. Tied answers share the average of the positions they occupy:

| Three-answer ranking | A's score | B's score | C's score |
| --- | ---: | ---: | ---: |
| A > B > C | 1 | 2 | 3 |
| A = B > C | 1.5 | 1.5 | 3 |
| A > B = C | 1 | 2.5 | 2.5 |
| A = B = C | 2 | 2 | 2 |

A two-model tie scores 1.5 for each model. Average each model's scores across its ranked comparisons; each comparison counts once using its latest decision. Equal averages share leaderboard placement. Participation counts are shown because models may have different sample sizes. Failed and unranked comparisons do not contribute.

Historical A/B/tie votes remain stored unchanged during migration and are interpreted as equivalent rankings. Existing two-model win/tie/loss counts remain visible. Before upgrading an existing database, startup creates a restricted-permission `*.pre-v3-*.sqlite3` backup beside it, then migrates the schema transactionally. Keep this backup for recovery; use the matching older application version if restoring it. Old saved queues retain their original model selections.

### Importing questions from CSV

In **Question list**, choose **Upload CSV**. Margin detects a `question`, `questions`, `prompt`, or `prompts` header. Headerless single-column files also work. For other layouts, select the question column and set **First row is a header** as needed; the preview shows exactly which text will be imported.

```csv
question
"When should a small application use SQLite?"
"Explain the tradeoff between speed, cost, and accuracy."
```

Choose **Add questions** to append them to your draft, edit if needed, then select **Compare**. Existing draft questions are preserved. Empty question cells are skipped and counted; duplicates are kept. Quoted commas, doubled quotes, multiline code, UTF-8 text, and UTF-8 BOM are supported. Export Excel or other spreadsheets as **CSV (UTF-8)** with commas as separators.

Files are limited to 1 MB, 100 columns, and 10,000 nonempty rows. Your final list must still fit within 20 questions, each at most 12,000 characters. Invalid files and oversized lists show an error without partially importing or starting comparisons.

The file is parsed locally in your browser. Its filename and other columns are not uploaded. Only the selected question text enters the existing comparison workflow after you add it and explicitly start comparing.

Draft notes save automatically. If saving fails, retry or deliberately reload the saved version before leaving. Light mode is the default; your explicit theme choice is remembered. Open **Motion & feedback** to preview highlight motion, switch animations on or off, and see whether touch vibration is available. These preferences stay in this browser; your device’s Reduce Motion setting takes precedence.

### Available models

The backend reads the [OpenAI model-list API](https://developers.openai.com/api/reference/resources/models/methods/list) using its own key. The selectors show the returned numbered GPT text-generation families, including dated snapshots, coding models, search models, and older text models. Image, audio, realtime, transcription, speech synthesis, embeddings, non-GPT models, and custom fine-tunes are excluded. See the [official model catalog](https://developers.openai.com/api/docs/models/all) for model capabilities and lifecycle status.

The list is cached for five minutes per backend process. **Reload model list** checks it again; **Retry model list** retries a failed lookup without generating answers. Comparisons stay disabled while loading, on a lookup failure, or when fewer models are available than the selected comparison size. Saved comparisons and scores remain accessible. Offline mode lists three local fixtures and never calls OpenAI.

GPT-5.6 Luna and GPT-6 Luna remain the initial pair when available; otherwise the first available entries are selected. You can change the model count and selections before every comparison. The choices remain while navigating within the open app. Models can differ substantially in cost and latency; search models may also incur search fees. A listed model can still reject generation because of retirement, permissions, quota, or other provider restrictions. Such failures are displayed without switching models or automatically retrying paid calls.

### History and privacy

History belongs to an anonymous browser session, identified by an HTTP-only cookie. Use the same browser profile and address to return later: `localhost` and `127.0.0.1` have separate cookies. Clearing cookies or using private browsing can lose access to saved history. There is no account recovery or device sync.

Prompts, answers, highlights, and votes are stored in the local SQLite database. In live mode, prompts are also sent to OpenAI. Highlight notes and decision notes are not sent with generation requests. The provider requests `store=false` on Responses and Chat Completions; legacy Completions does not accept that setting. The flag is not a guarantee of zero provider-side retention.

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

The database directory and schema are created automatically. [providers.py](backend/app/providers.py) discovers models and routes requests to Responses, Chat Completions for older GPT/chat-search models, or legacy Completions for GPT-3.5 Turbo Instruct. All selected models receive the same prompt. Output is capped at 4,096 tokens (1,024 for legacy Instruct); the original Luna pair uses low reasoning effort, while other models use their own defaults to avoid unsupported settings. A refused, truncated, failed, or timed-out answer cannot be ranked until every response succeeds. Large reasoning models may need more time or output budget than this local app allows.

The saved comparison retains its exact selected model IDs. Reusing a request ID with a different prompt or model set returns a conflict; repeating the same request with the same model set in any selection order returns the existing comparison. The scorecard includes models with saved votes, including models that later disappear from the available list.

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

The build includes TypeScript checking. Automated tests use fixtures and do not spend API credits. They cover catalog filtering/caching, endpoint compatibility, selected-model persistence, ranking validation and tie arithmetic, migration preservation, retry idempotency/concurrency/restarts, queues, anonymous responses, and history/score preservation. API schemas are available at [local API docs](http://127.0.0.1:8767/docs); `GET /api/models` returns the session's available model IDs and initial pair, and new comparison requests send a `models` array containing two or three distinct IDs. `POST/PATCH /api/comparisons/{id}/ranking` saves complete `ranks` with annotation/vote revisions; `GET /api/scorecards` returns separate participant-count groups. `POST /api/comparisons/{id}/retry` accepts a request ID and current attempt. Legacy vote and score endpoints remain compatible for two-model comparisons. Older saved question lists that omit `models` retain the original fixed Luna pair (or local fixtures in mock mode); they do not silently adopt a newly selected model set. [Health status](http://127.0.0.1:8767/api/health) reports the selected provider. Health status alone does not verify API credentials or model access.

```text
backend/app/       Configuration, providers, API, and SQLite persistence
backend/tests/     Provider, API, database, and migration tests
frontend/src/      Comparison workspace, annotation saving, and rendering
.env.example       Configuration template without credentials
DESIGN_NOTES.md    Engineering decisions and verification
```

### Troubleshooting

- **The page is missing or out of date:** run `npm run build --prefix frontend` from the project root, then restart the backend.
- **Port 8767 is already in use:** replace `--port 8767` with an available port, such as `--port 8877`, in both server commands, and open `http://127.0.0.1:8877/`. Use the same address after restarts to keep the browser session. Frontend development uses the proxy configured in `frontend/vite.config.ts`; update its target too if you change the backend port.
- **The model list does not load:** check the backend's network connection and key's model-list permission, then select Retry model list. No paid generation is started by this action.
- **Live generation fails:** check the visible error, API key, API credits, model access, and network connection. Choose another model if a listed ID is retired or unavailable for generation. Offline mode remains available for testing the app.
- **An answer is interrupted or times out:** the existing comparison retains whatever completed. Use **Retry failed answers**. This makes new requests only for failed responses and keeps successful answers intact.
- **A save conflicts with another tab:** the app rejects the stale update. Preserve any text you need before reloading the saved version.
- **History seems empty:** return to the same browser profile, hostname, and database. Copying the database alone does not restore a lost session cookie.

## Scope

Margin is a local assessment application. Its scorecard reflects your own prompts and preferences, not a global model ranking. Responses support a small safe Markdown subset; unsupported syntax remains readable source text.

Public hosting would need access and abuse controls, durable background jobs, operational monitoring, and a backup/retention policy. The local URLs above are not a public demo. Further tradeoffs and priorities are described in [Design notes](DESIGN_NOTES.md).
