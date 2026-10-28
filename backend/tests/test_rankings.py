import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.db import Conflict, Database, InvalidVote, shared_positions
from app.main import create_app
from test_api import ControlledProvider, HEADERS, session, settle, settings, submit


@pytest.mark.parametrize('ranks,expected', [
    ({'A': 1, 'B': 2, 'C': 3}, [1, 2, 3]),
    ({'A': 1, 'B': 1, 'C': 2}, [1.5, 1.5, 3]),
    ({'A': 1, 'B': 2, 'C': 2}, [1, 2.5, 2.5]),
    ({'A': 1, 'B': 1, 'C': 1}, [2, 2, 2]),
    ({'A': 1, 'B': 3, 'C': 3}, [1, 2.5, 2.5]),
    ({'A': 1, 'B': 1}, [1.5, 1.5]),
])
def test_shared_positions(ranks, expected):
    assert list(shared_positions(ranks).values()) == expected


class ThreeModels(ControlledProvider):
    models = ('test-fast', 'test-slow', 'test-third')


def test_three_model_ranking_reveal_revision_and_scorecards(settings):
    with TestClient(create_app(settings, ThreeModels())) as client:
        session(client)
        created = submit(client, models=ThreeModels.models)
        identifier = created['id']
        finished = settle(client, identifier)
        assert len(finished['responses']) == 3
        assert all(answer['model'] is None for answer in finished['responses'])
        path = f'/api/comparisons/{identifier}'
        assert client.post(path + '/vote', json={'choice': 'A'}, headers=HEADERS).status_code == 422
        for ranks in ({'A': 1, 'B': 2}, {'A': 1, 'B': 2, 'D': 3}, {'A': 2, 'B': 2, 'C': 2}, {'A': True, 'B': 2, 'C': 3}):
            assert client.post(path + '/ranking', json={'ranks': ranks, 'annotation_revision': 0}, headers=HEADERS).status_code == 422
        document = {'highlights': [{'side': 'C', 'paragraph_index': 0, 'start': 0, 'end': 5, 'quote': 'First', 'note': 'Third answer'}], 'reason': None, 'note': 'Keep this'}
        assert client.put(path + '/annotations', json={**document, 'revision': 0}, headers=HEADERS).status_code == 200
        payload = {'ranks': {'A': 1, 'B': 1, 'C': 2}, 'annotation_revision': 1}
        saved = client.post(path + '/ranking', json=payload, headers=HEADERS).json()
        assert saved['vote']['ranks'] == payload['ranks']
        assert all(answer['model'] for answer in saved['responses'])
        assert client.post(path + '/ranking', json=payload, headers=HEADERS).json() == saved
        assert client.put(path + '/annotations', json={**document, 'revision': 1}, headers=HEADERS).status_code == 409
        groups = client.get('/api/scorecards').json()['groups']
        assert groups[0]['comparisons'] == 0 and groups[1]['comparisons'] == 1
        assert sorted(item['average_rank'] for item in groups[1]['items']) == [1.5, 1.5, 3]
        revised = client.patch(path + '/ranking', json={'ranks': {'A': 2, 'B': 3, 'C': 1}, 'revision': 0}, headers=HEADERS).json()
        assert revised['vote']['edited'] and revised['vote']['revision'] == 1
        assert revised['annotations'] == document
        assert client.patch(path + '/ranking', json={'ranks': payload['ranks'], 'revision': 0}, headers=HEADERS).status_code == 409
        history = client.get('/api/comparisons').json()['items'][0]
        assert history['ranks'] == revised['vote']['ranks'] and history['participant_count'] == 3
        assert client.get('/api/scorecards').json()['groups'][1]['comparisons'] == 1
        client.cookies.clear(); session(client)
        assert client.get(path).status_code == 404
        assert all(group['comparisons'] == 0 for group in client.get('/api/scorecards').json()['groups'])


def test_real_v2_migration_preserves_rows_and_backup(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
    with sqlite3.connect(path) as c:
        c.executescript('''
            CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
            CREATE TABLE comparisons(id TEXT PRIMARY KEY, session_hash TEXT REFERENCES sessions(token_hash), request_id TEXT, prompt TEXT, status TEXT, created_at TEXT, UNIQUE(session_hash, request_id));
            CREATE TABLE responses(comparison_id TEXT REFERENCES comparisons(id), side TEXT CHECK(side IN ('A','B')), model TEXT, status TEXT, content TEXT, error_code TEXT, PRIMARY KEY(comparison_id, side), UNIQUE(comparison_id, model));
            CREATE TABLE votes(comparison_id TEXT PRIMARY KEY REFERENCES comparisons(id), choice TEXT NOT NULL CHECK(choice IN ('A','B','tie')), reason TEXT, evidence_side TEXT CHECK(evidence_side IN ('A','B')), evidence_index INTEGER, created_at TEXT, edited INTEGER DEFAULT 0, revision INTEGER DEFAULT 0, updated_at TEXT);
            CREATE TABLE annotations(comparison_id TEXT PRIMARY KEY REFERENCES comparisons(id), revision INTEGER, document TEXT);
            INSERT INTO sessions VALUES ('alice','original-session-time');
            INSERT INTO comparisons VALUES ('saved','alice','request','Original prompt','ready','original-time');
            INSERT INTO responses VALUES ('saved','A','old-a','success','First paragraph.',NULL), ('saved','B','old-b','success','Second paragraph.',NULL);
            INSERT INTO votes VALUES ('saved','B','Clarity','A',0,'vote-time',1,2,'revision-time');
            PRAGMA user_version=2;
        ''')
        before = {table: c.execute(f'SELECT * FROM {table}').fetchall() for table in ('sessions', 'comparisons', 'responses', 'votes', 'annotations')}
    db = Database(path); db.initialize(); db.initialize()
    with db.connect() as c:
        for table, rows in before.items():
            after = [tuple(row)[:len(rows[0])] for row in c.execute(f'SELECT * FROM {table}')] if rows else []
            assert after == rows
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
    backups = list(tmp_path.glob('*.pre-v3-*.sqlite3'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as c:
        assert c.execute('PRAGMA user_version').fetchone()[0] == 2
        assert c.execute('SELECT * FROM votes').fetchall() == before['votes']
    record = db.get_comparison('alice', 'saved')
    assert record['vote']['ranks'] == {'A': 2, 'B': 1}
    assert record['annotations']['highlights'][0]['quote'] == 'First paragraph.'
    assert [(item['model'], item['average_rank']) for item in db.scorecards('alice')[0]['items']] == [('old-b', 1), ('old-a', 2)]
    db.rank('alice', 'saved', {'A': 1, 'B': 1}, revision=2)
    assert [item['average_rank'] for item in db.scorecards('alice')[0]['items']] == [1.5, 1.5]
    assert db.get_comparison('alice', 'saved')['annotations'] == record['annotations']


def test_mixed_formats_average_latest_decisions(tmp_path):
    db = Database(tmp_path / 'scores.sqlite3'); db.initialize(); db.add_session('a')
    for models, ranks in [(['x', 'y'], {'A': 1, 'B': 2}), (['x', 'y'], {'A': 1, 'B': 1}), (['x', 'y', 'z'], {'A': 3, 'B': 1, 'C': 2})]:
        identifier, _ = db.create_comparison('a', str(uuid4()), 'Prompt', models, 4)
        with pytest.raises(Conflict):
            db.rank('a', identifier, ranks, annotation_revision=0)
        for side in ranks:
            db.finish_response(identifier, side, content='Answer')
        db.rank('a', identifier, ranks, annotation_revision=0)
    groups = db.scorecards('a')
    assert groups[0]['comparisons'] == 2 and groups[1]['comparisons'] == 1
    assert {item['model']: item['average_rank'] for item in groups[0]['items']} == {'x': 1.25, 'y': 1.75}
    assert {item['model']: item['average_rank'] for item in groups[1]['items']} == {'x': 3, 'y': 1, 'z': 2}
