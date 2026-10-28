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


def decision_ranks(vote, sides):
    if vote['ranks'] is not None:
        return json.loads(vote['ranks'])
    return {side: 1 if vote['choice'] in ('tie', side) else 2 for side in sides}


def shared_positions(ranks: dict[str, int]) -> dict[str, float]:
    values = list(ranks.values())
    return {side: 1 + sum(other < rank for other in values) + (values.count(rank) - 1) / 2
            for side, rank in ranks.items()}


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
            if version > 3:
                raise RuntimeError("Database schema is newer than this application.")
            if 0 < version < 3:
                backup = self.path.with_name(f'{self.path.stem}.pre-v3-{uuid4().hex}.sqlite3')
                backup.touch(mode=0o600, exist_ok=False)
                with sqlite3.connect(backup) as destination:
                    connection.backup(destination)
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

            if version < 3:
                connection.executescript("""
                    BEGIN IMMEDIATE;
                    CREATE TABLE responses_v3 (
                        comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
                        side TEXT NOT NULL,
                        model TEXT NOT NULL,
                        status TEXT NOT NULL CHECK(status IN ('pending','success','error')),
                        content TEXT NOT NULL DEFAULT '',
                        error_code TEXT,
                        PRIMARY KEY(comparison_id, side),
                        UNIQUE(comparison_id, model)
                    );
                    INSERT INTO responses_v3 SELECT * FROM responses;
                    DROP TABLE responses;
                    ALTER TABLE responses_v3 RENAME TO responses;
                    CREATE TABLE votes_v3 (
                        comparison_id TEXT PRIMARY KEY REFERENCES comparisons(id) ON DELETE CASCADE,
                        choice TEXT CHECK(choice IN ('A','B','tie')),
                        reason TEXT CHECK(reason IN ('Clarity','Depth','Practicality','Follows the prompt')),
                        evidence_side TEXT,
                        evidence_index INTEGER CHECK(evidence_index >= 0),
                        created_at TEXT NOT NULL,
                        edited INTEGER NOT NULL DEFAULT 0,
                        revision INTEGER NOT NULL DEFAULT 0,
                        updated_at TEXT,
                        ranks TEXT,
                        CHECK(choice IS NOT NULL OR ranks IS NOT NULL),
                        CHECK((evidence_side IS NULL) = (evidence_index IS NULL))
                    );
                    INSERT INTO votes_v3 SELECT *, NULL FROM votes;
                    DROP TABLE votes;
                    ALTER TABLE votes_v3 RENAME TO votes;
                    ALTER TABLE comparisons ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
                    CREATE TABLE retry_requests (
                        comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
                        request_id TEXT NOT NULL,
                        attempt INTEGER NOT NULL,
                        PRIMARY KEY(comparison_id, request_id)
                    );
                    PRAGMA user_version = 3;
                    COMMIT;
                """)

    def has_session(self, token_hash: str) -> bool:
        with self.connect() as connection:
            return connection.execute("SELECT 1 FROM sessions WHERE token_hash = ?", (token_hash,)).fetchone() is not None

    def add_session(self, token_hash: str):
        with self.connect(write=True) as connection:
            connection.execute("INSERT INTO sessions VALUES (?, ?)", (token_hash, now()))

    @staticmethod
    def _check_capacity(connection, session: str, max_active: int):
        if connection.execute("SELECT 1 FROM comparisons WHERE session_hash = ? AND status = 'pending'", (session,)).fetchone():
            raise Capacity("A comparison is already running in this browser. Wait for it to finish.")
        if connection.execute("SELECT COUNT(*) FROM comparisons WHERE status = 'pending'").fetchone()[0] >= max_active:
            raise Capacity("The server is busy. Please try again shortly.")

    def create_comparison(self, session: str, request_id: str, prompt: str, models: list[str], max_active: int):
        if len(models) not in (2, 3) or len(set(models)) != len(models):
            raise ValueError("A comparison needs two or three distinct models.")
        with self.connect(write=True) as connection:
            previous = connection.execute(
                "SELECT id, prompt FROM comparisons WHERE session_hash = ? AND request_id = ?",
                (session, request_id),
            ).fetchone()
            if previous:
                if previous["prompt"] != prompt:
                    raise Conflict("This request ID was already used with a different prompt.")
                previous_models = {row['model'] for row in connection.execute(
                    'SELECT model FROM responses WHERE comparison_id = ?', (previous['id'],))}
                if previous_models != set(models):
                    raise Conflict('This request ID was already used with different models.')
                return previous["id"], False
            self._check_capacity(connection, session, max_active)
            identifier = str(uuid4())
            connection.execute("INSERT INTO comparisons(id, session_hash, request_id, prompt, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)", (identifier, session, request_id, prompt, now()))
            connection.executemany(
                "INSERT INTO responses(comparison_id, side, model, status) VALUES (?, ?, ?, 'pending')",
                [(identifier, side, model) for side, model in zip((chr(65 + index) for index in range(len(models))), models)],
            )
        return identifier, True

    def retry_comparison(self, session: str, comparison_id: str, request_id: str, attempt: int, max_active: int):
        with self.connect(write=True) as connection:
            comparison = self._get(connection, session, comparison_id)
            previous = connection.execute('SELECT attempt FROM retry_requests WHERE comparison_id = ? AND request_id = ?',
                                          (comparison_id, request_id)).fetchone()
            if previous:
                if previous['attempt'] != attempt:
                    raise Conflict('This retry request ID was already used for a different attempt.')
                return comparison, False
            if comparison['attempt'] != attempt:
                raise Conflict('This comparison has a newer attempt. Reload before retrying.')
            if comparison['vote'] or comparison['status'] != 'failed':
                raise Conflict('Retry is available only after all responses finish and at least one fails, before ranking.')
            self._check_capacity(connection, session, max_active)
            connection.execute('INSERT INTO retry_requests VALUES (?, ?, ?)', (comparison_id, request_id, attempt))
            connection.execute("UPDATE responses SET status = 'pending', content = '', error_code = NULL WHERE comparison_id = ? AND status = 'error'",
                               (comparison_id,))
            connection.execute("UPDATE comparisons SET status = 'pending', attempt = attempt + 1 WHERE id = ?", (comparison_id,))
            return self._get(connection, session, comparison_id), True

    def finish_response(self, comparison_id: str, side: str, *, content: str = '', error_code: str | None = None, attempt: int | None = None):
        with self.connect(write=True) as connection:
            if attempt is not None:
                current = connection.execute('SELECT attempt FROM comparisons WHERE id = ?', (comparison_id,)).fetchone()
                if current is None or current['attempt'] != attempt:
                    return
            finished = connection.execute(
                "UPDATE responses SET status = ?, content = ?, error_code = ? WHERE comparison_id = ? AND side = ? AND status = 'pending'",
                ('error' if error_code else 'success', content, error_code, comparison_id, side),
            )
            if not finished.rowcount:
                return
            statuses = [row[0] for row in connection.execute("SELECT status FROM responses WHERE comparison_id = ?", (comparison_id,))]
            if statuses and 'pending' not in statuses:
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
        if vote:
            result['vote']['ranks'] = decision_ranks(vote, [answer['side'] for answer in result['responses']])
            if vote['ranks'] is not None:
                ranks = result['vote']['ranks']
                result['vote']['choice'] = (('tie' if len(set(ranks.values())) == 1 else min(ranks, key=ranks.get))
                                            if len(ranks) == 2 else None)
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
            if len(comparison['responses']) != 2:
                raise InvalidVote('Rank every response in this comparison.')
            if comparison['status'] != 'ready':
                raise Conflict('All responses must succeed before you can vote.')
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
            if len(comparison['responses']) != 2:
                raise InvalidVote('Rank every response in this comparison.')
            if not previous:
                raise Conflict('Vote before revising a decision.')
            if revision != previous['revision']:
                raise Conflict('Your vote changed in another tab. Reload before editing it.')
            if choice != previous['choice']:
                connection.execute('UPDATE votes SET choice=?, ranks=NULL, edited=1, revision=revision+1, updated_at=? WHERE comparison_id=?',
                                   (choice, now(), comparison_id))
            return self._get(connection, session, comparison_id)

    def rank(self, session: str, comparison_id: str, ranks: dict, annotation_revision: int | None = None, revision: int | None = None):
        with self.connect(write=True) as connection:
            comparison = self._get(connection, session, comparison_id)
            sides = {answer['side'] for answer in comparison['responses']}
            if (set(ranks) != sides or any(type(rank) is not int or not 1 <= rank <= len(sides) for rank in ranks.values())
                    or min(ranks.values(), default=0) != 1):
                raise InvalidVote('Rank every answer from 1 to the number of answers, with at least one ranked 1. Equal ranks are ties.')
            if comparison['status'] != 'ready':
                raise Conflict('All responses must succeed before ranking.')
            previous = comparison['vote']
            if revision is None:
                if annotation_revision != comparison['annotation_revision']:
                    raise Conflict('Your highlights changed in another tab. Reload before ranking.')
                if previous:
                    if previous['ranks'] != ranks:
                        raise Conflict('This comparison already has a decision. Use Change ranking.')
                else:
                    connection.execute('INSERT INTO votes(comparison_id, ranks, created_at) VALUES (?, ?, ?)',
                                       (comparison_id, json.dumps(ranks, sort_keys=True), now()))
            else:
                if not previous:
                    raise Conflict('Save a ranking before revising it.')
                if revision != previous['revision']:
                    raise Conflict('Your ranking changed in another tab. Reload before editing it.')
                if previous['ranks'] != ranks:
                    connection.execute('UPDATE votes SET ranks=?, edited=1, revision=revision+1, updated_at=? WHERE comparison_id=?',
                                       (json.dumps(ranks, sort_keys=True), now(), comparison_id))
            return self._get(connection, session, comparison_id)

    def history(self, session: str, limit: int, offset: int):
        with self.connect() as connection:
            rows = connection.execute("""
                SELECT c.id, c.prompt, c.status, c.created_at, v.choice AS vote, v.ranks,
                    COALESCE(v.edited, 0) AS edited,
                    (SELECT COUNT(*) FROM responses r WHERE r.comparison_id=c.id) AS participant_count
                FROM comparisons c LEFT JOIN votes v ON v.comparison_id = c.id
                WHERE c.session_hash = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?
            """, (session, limit + 1, offset)).fetchall()
        items = []
        for row in rows[:limit]:
            item = dict(row)
            if item['ranks'] is not None:
                item['ranks'] = json.loads(item['ranks'])
                ranks = item['ranks']
                item['vote'] = (('tie' if len(set(ranks.values())) == 1 else min(ranks, key=ranks.get))
                                if len(ranks) == 2 else None)
            elif item['vote']:
                item['ranks'] = decision_ranks({'ranks': None, 'choice': item['vote']}, ['A', 'B'])
            items.append(item)
        return {'items': items, 'has_more': len(rows) > limit}

    def scorecards(self, session: str):
        groups = {count: {'participant_count': count, 'comparisons': 0, 'items': {}} for count in (2, 3)}
        with self.connect() as connection:
            rows = connection.execute("""
                SELECT v.comparison_id, v.choice, v.ranks, r.side, r.model
                FROM votes v JOIN comparisons c ON c.id=v.comparison_id
                JOIN responses r ON r.comparison_id=c.id
                WHERE c.session_hash=? ORDER BY v.comparison_id, r.side
            """, (session,)).fetchall()
        comparisons = {}
        for row in rows:
            comparisons.setdefault(row['comparison_id'], []).append(row)
        for answers in comparisons.values():
            count = len(answers)
            group = groups.setdefault(count, {'participant_count': count, 'comparisons': 0, 'items': {}})
            group['comparisons'] += 1
            ranks = decision_ranks(answers[0], [answer['side'] for answer in answers])
            positions = shared_positions(ranks)
            first = [side for side, rank in ranks.items() if rank == min(ranks.values())]
            for answer in answers:
                item = group['items'].setdefault(answer['model'], {'model': answer['model'], 'compared': 0,
                                                                'rank_sum': 0, 'wins': 0, 'ties': 0, 'losses': 0})
                item['compared'] += 1
                item['rank_sum'] += positions[answer['side']]
                outcome = ('wins' if len(first) == 1 else 'ties') if answer['side'] in first else 'losses'
                item[outcome] += 1
        for group in groups.values():
            items = list(group['items'].values())
            for item in items:
                item['average_rank'] = item.pop('rank_sum') / item['compared']
            group['items'] = sorted(items, key=lambda item: (item['average_rank'], item['model']))
        return list(groups.values())

    def scores(self, session: str, models: tuple[str, ...]):
        # Preserve the original counts contract for legacy clients.
        result = {model: {'model': model, 'wins': 0, 'ties': 0, 'losses': 0, 'compared': 0} for model in models}
        for group in self.scorecards(session):
            for item in group['items']:
                row = result.setdefault(item['model'], {'model': item['model'], 'wins': 0, 'ties': 0, 'losses': 0, 'compared': 0})
                for key in ('wins', 'ties', 'losses', 'compared'):
                    row[key] += item[key]
        return sorted(result.values(), key=lambda item: item['model'])
