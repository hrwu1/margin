import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import time
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.config import Settings
from app.db import Capacity, Conflict, Database, NotFound
from app.main import COOKIE, create_app
from app.providers import ProviderFailure


HEADERS = {'X-Margin-Client': 'web'}


class RetryProvider:
    models = ('test-one', 'test-two', 'test-three')
    mode = 'test'

    def __init__(self, failures):
        self.failures = failures
        self.calls = Counter()

    async def list_models(self):
        return self.models

    async def generate(self, model, prompt):
        self.calls[model] += 1
        attempt = self.calls[model]
        await asyncio.sleep(0.04)
        if attempt <= self.failures.get(model, 0):
            raise ProviderFailure('timeout')
        return 'Completed response.\n\nA useful explanation.'


def settle(client, identifier):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        result = client.get(f'/api/comparisons/{identifier}').json()
        if result['status'] != 'pending':
            return result
        time.sleep(0.01)
    pytest.fail('Comparison did not settle within three seconds')


def submit(client, models):
    assert client.post('/api/session', headers=HEADERS).status_code == 200
    result = client.post('/api/comparisons', headers=HEADERS, json={
        'request_id': str(uuid4()), 'prompt': 'Explain an index', 'models': models,
    })
    assert result.status_code == 202, result.text
    return settle(client, result.json()['id'])


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / 'retry.sqlite3')
    database.initialize()
    database.add_session('alice')
    database.add_session('bob')
    return database


def failed(db, models=('one', 'two'), failures=('B',)):
    identifier, _ = db.create_comparison('alice', str(uuid4()), 'Prompt', list(models), 4)
    for side in 'ABC'[:len(models)]:
        db.finish_response(identifier, side, error_code='timeout' if side in failures else None,
                           content='' if side in failures else f'Keep answer {side}.')
    return identifier


@pytest.mark.parametrize('count,failed_models', [(2, ('test-two',)), (3, ('test-two', 'test-three'))])
def test_retry_only_failed_answers_preserves_sources_and_replays(tmp_path, count, failed_models):
    settings = Settings(database_path=tmp_path / 'app.sqlite3', frontend_path=tmp_path / 'no-ui')
    provider = RetryProvider(dict.fromkeys(failed_models, 1))
    with TestClient(create_app(settings, provider)) as client:
        original = submit(client, provider.models[:count])
        assert original['status'] == 'failed' and original['attempt'] == 0
        identifier = original['id']
        completed = next(answer for answer in original['responses'] if answer['status'] == 'success')
        annotations = {'highlights': [{'side': completed['side'], 'paragraph_index': 0,
                       'start': 0, 'end': 9, 'quote': 'Completed', 'note': 'Keep this.'}],
                       'reason': 'Clarity', 'note': 'Preserve my notes.'}
        saved = client.put(f'/api/comparisons/{identifier}/annotations', headers=HEADERS,
                           json={'revision': 0, **annotations})
        assert saved.status_code == 200
        request = {'request_id': str(uuid4()), 'attempt': 0}
        retried = client.post(f'/api/comparisons/{identifier}/retry', json=request, headers=HEADERS)
        assert retried.status_code == 202, retried.text
        assert retried.json()['attempt'] == 1
        replay = client.post(f'/api/comparisons/{identifier}/retry', json=request, headers=HEADERS)
        assert replay.status_code in (200, 202)
        finished = settle(client, identifier)
        assert finished['status'] == 'ready' and finished['attempt'] == 1
        assert finished['created_at'] == original['created_at']
        assert finished['annotations'] == annotations
        assert finished['annotation_revision'] == saved.json()['annotation_revision']
        assert next(answer for answer in finished['responses'] if answer['side'] == completed['side']) == completed
        assert all(answer['model'] is None for answer in finished['responses'])
        assert provider.calls == Counter({model: 2 if model in failed_models else 1 for model in provider.models[:count]})
        assert client.post(f'/api/comparisons/{identifier}/retry', json=request, headers=HEADERS).json() == finished
        token = client.cookies[COOKIE]
    with TestClient(create_app(settings, provider)) as restarted:
        restarted.cookies.set(COOKIE, token, path='/api')
        assert restarted.post(f'/api/comparisons/{identifier}/retry', json=request, headers=HEADERS).json() == finished
        assert sum(provider.calls.values()) == count + len(failed_models)


def test_retry_conflicting_body_stale_attempt_and_session_isolation(db):
    identifier = failed(db)
    request_id = str(uuid4())
    pending, created = db.retry_comparison('alice', identifier, request_id, 0, 4)
    assert created and pending['attempt'] == 1
    with pytest.raises(Conflict):
        db.retry_comparison('alice', identifier, request_id, 1, 4)
    with pytest.raises(Conflict):
        db.retry_comparison('alice', identifier, str(uuid4()), 0, 4)
    with pytest.raises(NotFound):
        db.retry_comparison('bob', identifier, request_id, 0, 4)
    db.finish_response(identifier, 'B', error_code='timeout', attempt=1)
    pending, created = db.retry_comparison('alice', identifier, str(uuid4()), 1, 4)
    assert created and pending['attempt'] == 2
    replayed, created = db.retry_comparison('alice', identifier, request_id, 0, 4)
    assert not created and replayed['attempt'] == 2


def test_concurrent_retry_requests_dispatch_only_once(db):
    identifier = failed(db)
    request_id = str(uuid4())
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: db.retry_comparison('alice', identifier, request_id, 0, 4), range(2)))
    assert sum(created for _, created in results) == 1
    assert all(record['attempt'] == 1 for record, _ in results)
    db.finish_response(identifier, 'B', error_code='timeout', attempt=1)

    def retry(_):
        try:
            return db.retry_comparison('alice', identifier, str(uuid4()), 1, 4)[1]
        except Conflict:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(retry, range(2))) == 1


def test_retry_attempt_guards_ignore_old_completion_and_restart_keeps_success(db):
    identifier = failed(db, ('one', 'two', 'three'), ('B', 'C'))
    request_id = str(uuid4())
    db.retry_comparison('alice', identifier, request_id, 0, 4)
    db.finish_response(identifier, 'B', content='Stale original result.', attempt=0)
    comparison = db.get_comparison('alice', identifier)
    assert comparison['responses'][1]['status'] == 'pending'
    assert comparison['responses'][1]['content'] == ''
    db.finish_response(identifier, 'B', content='Retried response.', attempt=1)
    db.finish_response(identifier, 'B', error_code='timeout', attempt=1)
    assert db.get_comparison('alice', identifier)['responses'][1]['content'] == 'Retried response.'
    db.recover_interrupted()
    interrupted = db.get_comparison('alice', identifier)
    assert interrupted['status'] == 'failed' and interrupted['attempt'] == 1
    assert [answer['status'] for answer in interrupted['responses']] == ['success', 'success', 'error']
    assert interrupted['responses'][2]['error_code'] == 'interrupted'
    restarted = Database(db.path)
    restarted.initialize()
    assert restarted.retry_comparison('alice', identifier, request_id, 0, 4) == (interrupted, False)
    retried, created = restarted.retry_comparison('alice', identifier, str(uuid4()), 1, 4)
    assert created and retried['attempt'] == 2
    assert retried['responses'][:2] == interrupted['responses'][:2]
    db.finish_response(identifier, 'C', content='Late interrupted result.', attempt=1)
    assert db.get_comparison('alice', identifier)['responses'][2]['status'] == 'pending'
    db.finish_response(identifier, 'C', content='Final response.', attempt=2)
    assert db.get_comparison('alice', identifier)['status'] == 'ready'


def test_retry_requires_settled_failure_and_respects_capacity(db):
    identifier = failed(db)
    other, _ = db.create_comparison('alice', str(uuid4()), 'Other prompt', ['one', 'two'], 4)
    with pytest.raises(Capacity):
        db.retry_comparison('alice', identifier, str(uuid4()), 0, 4)
    db.finish_response(other, 'A', error_code='timeout')
    with pytest.raises(Conflict):
        db.retry_comparison('alice', other, str(uuid4()), 0, 4)
    db.finish_response(other, 'B', content='Done.')
    db.create_comparison('bob', str(uuid4()), 'Other session', ['one', 'two'], 4)
    with pytest.raises(Capacity):
        db.retry_comparison('alice', identifier, str(uuid4()), 0, 1)
    assert db.get_comparison('alice', identifier)['attempt'] == 0


def test_retry_cannot_regenerate_successful_or_voted_comparison(db):
    identifier = failed(db)
    db.retry_comparison('alice', identifier, str(uuid4()), 0, 4)
    db.finish_response(identifier, 'B', content='Recovered.', attempt=1)
    with pytest.raises(Conflict):
        db.retry_comparison('alice', identifier, str(uuid4()), 1, 4)
    db.vote('alice', identifier, 'A', None, None)
    saved = db.get_comparison('alice', identifier)
    with pytest.raises(Conflict):
        db.retry_comparison('alice', identifier, str(uuid4()), 1, 4)
    assert db.get_comparison('alice', identifier) == saved


@pytest.mark.parametrize('attempt', [-1, True, '0'])
def test_retry_api_rejects_invalid_attempt(tmp_path, attempt):
    settings = Settings(database_path=tmp_path / 'app.sqlite3', frontend_path=tmp_path / 'no-ui')
    provider = RetryProvider({'test-two': 1})
    with TestClient(create_app(settings, provider)) as client:
        failed_comparison = submit(client, provider.models[:2])
        response = client.post(f'/api/comparisons/{failed_comparison["id"]}/retry', headers=HEADERS,
                               json={'request_id': str(uuid4()), 'attempt': attempt})
        assert response.status_code == 422
        assert sum(provider.calls.values()) == 2
