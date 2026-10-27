from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app.db import Capacity, Conflict, Database, InvalidVote, NotFound


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / 'test.sqlite3')
    database.initialize()
    database.add_session('alice')
    database.add_session('bob')
    return database


def create(db, session='alice', models=None):
    return db.create_comparison(session, str(uuid4()), 'Explain an index', models or ['cedar', 'birch'], 4)[0]


def ready(db, session='alice', models=None):
    identifier = create(db, session, models)
    db.finish_response(identifier, 'A', content='First paragraph.\n\nSecond paragraph.')
    db.finish_response(identifier, 'B', content='Alternative answer.')
    return identifier


def test_request_idempotency_and_capacity(db):
    request_id = str(uuid4())
    identifier, created = db.create_comparison('alice', request_id, 'A prompt', ['cedar', 'birch'], 4)
    assert created
    assert db.create_comparison('alice', request_id, 'A prompt', ['cedar', 'birch'], 4) == (identifier, False)
    with pytest.raises(Conflict):
        db.create_comparison('alice', request_id, 'Changed prompt', ['cedar', 'birch'], 4)
    with pytest.raises(Capacity):
        create(db)
    with pytest.raises(Capacity):
        db.create_comparison('bob', str(uuid4()), 'A prompt', ['cedar', 'birch'], 1)


def test_session_isolation_and_pagination(db):
    first = ready(db)
    second = ready(db)
    assert [row['id'] for row in db.history('alice', 1, 0)['items']] == [second]
    assert db.history('alice', 1, 0)['has_more']
    assert db.history('alice', 1, 1)['items'][0]['id'] == first
    assert not db.history('bob', 50, 0)['items']
    with pytest.raises(NotFound):
        db.get_comparison('bob', first)
    with pytest.raises(NotFound):
        db.vote('bob', first, 'A', None, None)


def test_evidence_validation_and_immutable_vote(db):
    identifier = ready(db)
    for evidence in ({'side': 'A', 'paragraph_index': 2}, {'side': 'B', 'paragraph_index': -1}, {'side': 'C', 'paragraph_index': 0}, {'side': 'A', 'paragraph_index': True}):
        with pytest.raises(InvalidVote):
            db.vote('alice', identifier, 'A', None, evidence)
    evidence = {'side': 'A', 'paragraph_index': 1}
    first = db.vote('alice', identifier, 'B', 'Clarity', evidence)
    assert first['vote']['evidence_index'] == 1  # Evidence may explain a losing answer's weakness.
    assert db.vote('alice', identifier, 'B', 'Clarity', evidence)['vote'] == first['vote']
    with pytest.raises(Conflict):
        db.vote('alice', identifier, 'A', 'Clarity', evidence)


def test_concurrent_conflicting_votes_count_once(db):
    identifier = ready(db)

    def vote(choice):
        try:
            return db.vote('alice', identifier, choice, None, None)['vote']['choice']
        except Conflict:
            return 'conflict'

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(vote, ['A', 'B']))
    assert results.count('conflict') == 1
    assert sum(row['wins'] for row in db.scores('alice', ('cedar', 'birch'))) == 1


def test_scores_follow_model_identity_and_session(db):
    db.vote('alice', ready(db), 'A', None, None)
    db.vote('alice', ready(db, models=['birch', 'cedar']), 'A', None, None)
    db.vote('alice', ready(db), 'tie', None, None)
    db.vote('bob', ready(db, 'bob'), 'B', None, None)
    for score in db.scores('alice', ('cedar', 'birch')):
        assert (score['wins'], score['ties'], score['losses'], score['compared']) == (1, 1, 1, 3)


def test_partial_failure_and_restart_preserve_success(db):
    identifier = create(db)
    db.finish_response(identifier, 'A', content='Keep this completed response.')
    with pytest.raises(Conflict):
        db.vote('alice', identifier, 'A', None, None)
    restarted = Database(db.path)
    restarted.initialize()
    restarted.recover_interrupted()
    comparison = restarted.get_comparison('alice', identifier)
    assert comparison['status'] == 'failed'
    assert comparison['responses'][0]['content'] == 'Keep this completed response.'
    assert comparison['responses'][1]['error_code'] == 'interrupted'
    with pytest.raises(Conflict):
        restarted.vote('alice', identifier, 'A', None, None)
    assert all(row['compared'] == 0 for row in restarted.scores('alice', ('cedar', 'birch')))


def test_vote_survives_reopen_and_schema_is_repeatable(db):
    identifier = ready(db)
    db.vote('alice', identifier, 'tie', 'Depth', None)
    reopened = Database(db.path)
    reopened.initialize()
    reopened.recover_interrupted()
    assert reopened.get_comparison('alice', identifier)['vote']['choice'] == 'tie'
    assert reopened.scores('alice', ('cedar', 'birch'))[0]['ties'] == 1


def annotation(quote='Second', start=0, end=6):
    return {'highlights': [{'side': 'A', 'paragraph_index': 1, 'start': start, 'end': end, 'quote': quote, 'note': 'Why this matters'}],
            'reason': 'Correctness', 'note': 'My overall reasoning'}


def test_highlights_validate_source_freeze_and_survive_revision(db):
    identifier = ready(db)
    for document in (annotation('forged'), annotation(start=True), annotation(end=999)):
        with pytest.raises(InvalidVote):
            db.save_annotations('alice', identifier, 0, document)
    duplicate = annotation()
    duplicate['highlights'] *= 2
    with pytest.raises(InvalidVote):
        db.save_annotations('alice', identifier, 0, duplicate)
    saved = db.save_annotations('alice', identifier, 0, annotation())
    assert saved['annotation_revision'] == 1
    with pytest.raises(Conflict):
        db.save_annotations('alice', identifier, 0, annotation())
    with pytest.raises(NotFound):
        db.save_annotations('bob', identifier, 1, annotation())
    with pytest.raises(Conflict):
        db.vote('alice', identifier, 'A', None, None, 0)
    voted = db.vote('alice', identifier, 'A', None, None, 1)
    assert not voted['vote']['edited']
    assert db.revise_vote('alice', identifier, 'A', 0)['vote'] == voted['vote']
    for revision, choice in enumerate(('B', 'tie', 'A')):
        changed = db.revise_vote('alice', identifier, choice, revision)
        assert changed['annotations'] == annotation()
        assert changed['vote']['edited'] and changed['vote']['revision'] == revision + 1
        scores = db.scores('alice', ('cedar', 'birch'))
        assert all(row['compared'] == 1 for row in scores)
        assert sum(row['ties'] for row in scores) == (2 if choice == 'tie' else 0)
    with pytest.raises(Conflict):
        db.save_annotations('alice', identifier, 1, annotation())
    with pytest.raises(Conflict):
        db.revise_vote('alice', identifier, 'B', 0)
    reopened = Database(db.path)
    reopened.initialize()
    assert reopened.get_comparison('alice', identifier)['annotations'] == annotation()
    assert reopened.get_comparison('alice', identifier)['vote'] == changed['vote']


def test_concurrent_revisions_reject_lost_updates(db):
    identifier = ready(db)
    db.vote('alice', identifier, 'A', None, None)
    def revise(choice):
        try:
            return db.revise_vote('alice', identifier, choice, 0)['vote']['choice']
        except Conflict:
            return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(revise, ['B', 'tie']))
    assert results.count('conflict') == 1
    assert all(row['compared'] == 1 for row in db.scores('alice', ('cedar', 'birch')))


def test_v1_migration_keeps_evidence_and_scores(db):
    identifier = ready(db)
    db.vote('alice', identifier, 'B', 'Clarity', {'side': 'A', 'paragraph_index': 1})
    # Reconstruct v1's exact columns while retaining a real persisted comparison/vote.
    with db.connect() as connection:
        connection.execute('DROP TABLE annotations')
        for column in ('edited', 'revision', 'updated_at'):
            connection.execute(f'ALTER TABLE votes DROP COLUMN {column}')
        connection.execute('PRAGMA user_version = 1')
    db.initialize()
    db.initialize()
    restored = db.get_comparison('alice', identifier)
    assert restored['vote']['choice'] == 'B' and not restored['vote']['edited']
    assert restored['annotations']['highlights'][0]['quote'] == 'Second paragraph.'
    assert restored['annotations']['reason'] == 'Clarity'
    assert sum(row['wins'] for row in db.scores('alice', ('cedar', 'birch'))) == 1


def test_unicode_offsets_and_blank_code_paragraphs(db):
    identifier = create(db)
    db.finish_response(identifier, 'A', content='Hello 🌍!\n\n```python\nx = 1\n\nprint(x)\n```')
    db.finish_response(identifier, 'B', content='Other answer.')
    document = {'highlights': [{'side': 'A', 'paragraph_index': 0, 'start': 6, 'end': 7, 'quote': '🌍', 'note': ''}], 'note': '', 'reason': None}
    assert db.save_annotations('alice', identifier, 0, document)['annotations'] == document
