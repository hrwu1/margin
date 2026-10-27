from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import json
from uuid import uuid4


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


class Capacity(Exception):
    pass


class InvalidVote(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def paragraphs(content: str) -> list[str]:
    return [part.strip() for part in content.split("\n\n") if part.strip()]


class Database:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connect(self, *, write=False):
        connection = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            if write:
                connection.commit()
        except BaseException:
            if write:
                connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version > 2:
                raise RuntimeError("Database schema is newer than this application.")
            if version == 0:
                connection.executescript("""
                    BEGIN IMMEDIATE;
                    CREATE TABLE sessions (
                        token_hash TEXT PRIMARY KEY,
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE comparisons (
                        id TEXT PRIMARY KEY,
                        session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
                        request_id TEXT NOT NULL,
                        prompt TEXT NOT NULL CHECK(length(prompt) BETWEEN 1 AND 12000),
                        status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
                        created_at TEXT NOT NULL,
                        UNIQUE(session_hash, request_id)
                    );
                    CREATE INDEX history_by_session ON comparisons(session_hash, created_at DESC, id DESC);
                    CREATE TABLE responses (
                        comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
                        side TEXT NOT NULL CHECK(side IN ('A','B')),
                        model TEXT NOT NULL,
                        status TEXT NOT NULL CHECK(status IN ('pending','success','error')),
                        content TEXT NOT NULL DEFAULT '',
                        error_code TEXT,
                        PRIMARY KEY(comparison_id, side),
                        UNIQUE(comparison_id, model)
                    );
                    CREATE TABLE votes (
                        comparison_id TEXT PRIMARY KEY REFERENCES comparisons(id) ON DELETE CASCADE,
                        choice TEXT NOT NULL CHECK(choice IN ('A','B','tie')),
                        reason TEXT CHECK(reason IN ('Clarity','Depth','Practicality','Follows the prompt')),
                        evidence_side TEXT CHECK(evidence_side IN ('A','B')),
                        evidence_index INTEGER CHECK(evidence_index >= 0),
                        created_at TEXT NOT NULL,
                        CHECK((evidence_side IS NULL) = (evidence_index IS NULL))
                    );
                    PRAGMA user_version = 1;
                    COMMIT;
                """)

            if version < 2:
                connection.executescript("""
                    BEGIN IMMEDIATE;
                    CREATE TABLE annotations (
                        comparison_id TEXT PRIMARY KEY REFERENCES comparisons(id) ON DELETE CASCADE,
                        revision INTEGER NOT NULL,
                        document TEXT NOT NULL
                    );
                    ALTER TABLE votes ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
                    ALTER TABLE votes ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
                    ALTER TABLE votes ADD COLUMN updated_at TEXT;
                    PRAGMA user_version = 2;
                    COMMIT;
                """)

    def has_session(self, token_hash: str) -> bool:
        with self.connect() as connection:
            return connection.execute("SELECT 1 FROM sessions WHERE token_hash = ?", (token_hash,)).fetchone() is not None

    def add_session(self, token_hash: str):
        with self.connect(write=True) as connection:
            connection.execute("INSERT INTO sessions VALUES (?, ?)", (token_hash, now()))

    def create_comparison(self, session: str, request_id: str, prompt: str, models: list[str], max_active: int):
        if len(models) != 2 or len(set(models)) != 2:
            raise ValueError("A comparison needs two distinct models.")
        with self.connect(write=True) as connection:
            previous = connection.execute(
                "SELECT id, prompt FROM comparisons WHERE session_hash = ? AND request_id = ?",
                (session, request_id),
            ).fetchone()
            if previous:
                if previous["prompt"] != prompt:
                    raise Conflict("This request ID was already used with a different prompt.")
                return previous["id"], False
            if connection.execute("SELECT 1 FROM comparisons WHERE session_hash = ? AND status = 'pending'", (session,)).fetchone():
                raise Capacity("A comparison is already running in this browser. Wait for it to finish.")
            if connection.execute("SELECT COUNT(*) FROM comparisons WHERE status = 'pending'").fetchone()[0] >= max_active:
                raise Capacity("The server is busy. Please try again shortly.")
            identifier = str(uuid4())
            connection.execute("INSERT INTO comparisons VALUES (?, ?, ?, ?, 'pending', ?)", (identifier, session, request_id, prompt, now()))
            connection.executemany(
                "INSERT INTO responses(comparison_id, side, model, status) VALUES (?, ?, ?, 'pending')",
                [(identifier, side, model) for side, model in zip(('A', 'B'), models)],
            )
        return identifier, True

    def finish_response(self, comparison_id: str, side: str, *, content: str = '', error_code: str | None = None):
        with self.connect(write=True) as connection:
            connection.execute(
                "UPDATE responses SET status = ?, content = ?, error_code = ? WHERE comparison_id = ? AND side = ? AND status = 'pending'",
                ('error' if error_code else 'success', content, error_code, comparison_id, side),
            )
            statuses = [row[0] for row in connection.execute("SELECT status FROM responses WHERE comparison_id = ?", (comparison_id,))]
            if len(statuses) == 2 and 'pending' not in statuses:
                connection.execute("UPDATE comparisons SET status = ? WHERE id = ?", ('ready' if all(status == 'success' for status in statuses) else 'failed', comparison_id))

    def recover_interrupted(self):
        # shortcut: one server process owns generation; use a durable queue before adding workers.
        with self.connect(write=True) as connection:
            connection.execute("UPDATE responses SET status = 'error', error_code = 'interrupted' WHERE status = 'pending'")
            connection.execute("UPDATE comparisons SET status = 'failed' WHERE status = 'pending'")

    @staticmethod
    def _get(connection, session: str, comparison_id: str):
        row = connection.execute("SELECT * FROM comparisons WHERE id = ? AND session_hash = ?", (comparison_id, session)).fetchone()
        if row is None:
            raise NotFound("Comparison not found.")
        result = dict(row)
        result['responses'] = [dict(row) for row in connection.execute("SELECT * FROM responses WHERE comparison_id = ? ORDER BY side", (comparison_id,))]
        vote = connection.execute("SELECT * FROM votes WHERE comparison_id = ?", (comparison_id,)).fetchone()
        result['vote'] = dict(vote) if vote else None
        annotations = connection.execute('SELECT revision, document FROM annotations WHERE comparison_id = ?', (comparison_id,)).fetchone()
        result['annotation_revision'] = annotations['revision'] if annotations else 0
        result['annotations'] = json.loads(annotations['document']) if annotations else {'highlights': [], 'reason': None, 'note': ''}
        if not annotations and vote:
            result['annotations']['reason'] = vote['reason']
            if vote['evidence_side']:
                answer = next(answer for answer in result['responses'] if answer['side'] == vote['evidence_side'])
                text = paragraphs(answer['content'])[vote['evidence_index']]
                result['annotations']['highlights'] = [{'side': vote['evidence_side'], 'paragraph_index': vote['evidence_index'],
                                                        'start': 0, 'end': len(text), 'quote': text, 'note': ''}]
        return result

    def get_comparison(self, session: str, comparison_id: str):
        with self.connect() as connection:
            # A read transaction keeps the pair and vote in one consistent snapshot.
            connection.execute("BEGIN")
            return self._get(connection, session, comparison_id)

    def vote(self, session: str, comparison_id: str, choice: str, reason: str | None, evidence: dict | None, annotation_revision: int | None = None):
        if choice not in ('A', 'B', 'tie') or reason not in (None, 'Clarity', 'Depth', 'Practicality', 'Follows the prompt'):
            raise InvalidVote("Invalid vote or reason.")
        side = evidence['side'] if evidence else None
        index = evidence['paragraph_index'] if evidence else None
        with self.connect(write=True) as connection:
            comparison = self._get(connection, session, comparison_id)
            if annotation_revision is not None and annotation_revision != comparison['annotation_revision']:
                raise Conflict('Your highlights changed in another tab. Reload before voting.')
            if comparison['status'] != 'ready':
                raise Conflict("Both responses must succeed before you can vote.")
            if evidence:
                answer = next((answer for answer in comparison['responses'] if answer['side'] == side), None)
                if not answer or type(index) is not int or not 0 <= index < len(paragraphs(answer['content'])):
                    raise InvalidVote("The evidence does not identify a paragraph in this comparison.")
            previous = comparison['vote']
            if previous:
                if (previous['choice'], previous['reason'], previous['evidence_side'], previous['evidence_index']) != (choice, reason, side, index):
                    raise Conflict("This comparison already has a vote. Revealed comparisons cannot be voted on again.")
            else:
                connection.execute("INSERT INTO votes(comparison_id, choice, reason, evidence_side, evidence_index, created_at) VALUES (?, ?, ?, ?, ?, ?)", (comparison_id, choice, reason, side, index, now()))
            return self._get(connection, session, comparison_id)

    def save_annotations(self, session: str, comparison_id: str, revision: int, document: dict):
        with self.connect(write=True) as connection:
            comparison = self._get(connection, session, comparison_id)
            if comparison['vote']:
                raise Conflict('Highlights and reasoning are saved with the first vote and cannot be changed after reveal.')
            if revision != comparison['annotation_revision']:
                raise Conflict('This comparison changed in another tab. Reload to use the latest highlights.')
            if document.get('reason') not in (None, 'Correctness', 'Clarity', 'Useful detail', 'Follows the prompt', 'Depth', 'Practicality'):
                raise InvalidVote('Invalid reason.')
            if not isinstance(document.get('note'), str) or len(document['note']) > 2000 or len(document.get('highlights', [])) > 50:
                raise InvalidVote('Keep at most 50 highlights and a note of at most 2,000 characters.')
            seen = set()
            for highlight in document['highlights']:
                side, index, start, end = (highlight.get(key) for key in ('side', 'paragraph_index', 'start', 'end'))
                answer = next((answer for answer in comparison['responses'] if answer['side'] == side and answer['status'] == 'success'), None)
                if not answer or type(index) is not int or not 0 <= index < len(paragraphs(answer['content'])):
                    raise InvalidVote('A highlight must refer to a completed answer in this comparison.')
                text = paragraphs(answer['content'])[index]
                if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text) or text[start:end] != highlight.get('quote'):
                    raise InvalidVote('A highlight must match its exact source text.')
                if not isinstance(highlight.get('note'), str) or len(highlight['note']) > 1000:
                    raise InvalidVote('Keep each highlight note within 1,000 characters.')
                identity = (side, index, start, end)
                if identity in seen:
                    raise InvalidVote('This excerpt is already highlighted.')
                seen.add(identity)
            connection.execute('INSERT INTO annotations VALUES (?, ?, ?) ON CONFLICT(comparison_id) DO UPDATE SET revision=excluded.revision, document=excluded.document',
                               (comparison_id, revision + 1, json.dumps(document, ensure_ascii=False)))
            return self._get(connection, session, comparison_id)

    def revise_vote(self, session: str, comparison_id: str, choice: str, revision: int):
        if choice not in ('A', 'B', 'tie'):
            raise InvalidVote('Invalid vote.')
        with self.connect(write=True) as connection:
            comparison = self._get(connection, session, comparison_id)
            previous = comparison['vote']
            if not previous:
                raise Conflict('Vote before revising a decision.')
            if revision != previous['revision']:
                raise Conflict('Your vote changed in another tab. Reload before editing it.')
            if choice != previous['choice']:
                connection.execute('UPDATE votes SET choice=?, edited=1, revision=revision+1, updated_at=? WHERE comparison_id=?',
                                   (choice, now(), comparison_id))
            return self._get(connection, session, comparison_id)

    def history(self, session: str, limit: int, offset: int):
        with self.connect() as connection:
            rows = connection.execute("""
                SELECT c.id, c.prompt, c.status, c.created_at, v.choice AS vote, COALESCE(v.edited, 0) AS edited
                FROM comparisons c LEFT JOIN votes v ON v.comparison_id = c.id
                WHERE c.session_hash = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?
            """, (session, limit + 1, offset)).fetchall()
        return {'items': [dict(row) for row in rows[:limit]], 'has_more': len(rows) > limit}

    def scores(self, session: str, models: tuple[str, str]):
        result = {model: {'model': model, 'wins': 0, 'ties': 0, 'losses': 0, 'compared': 0} for model in models}
        with self.connect() as connection:
            rows = connection.execute("""
                SELECT r.model, COUNT(*) AS compared,
                    SUM(v.choice = r.side) AS wins, SUM(v.choice = 'tie') AS ties,
                    SUM(v.choice != 'tie' AND v.choice != r.side) AS losses
                FROM votes v JOIN comparisons c ON c.id = v.comparison_id
                JOIN responses r ON r.comparison_id = c.id
                WHERE c.session_hash = ? GROUP BY r.model
            """, (session,)).fetchall()
        for row in rows:
            result[row['model']] = dict(row)
        return sorted(result.values(), key=lambda item: item['model'])
