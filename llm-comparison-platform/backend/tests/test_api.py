import asyncio
from hashlib import sha256
import time
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.config import Settings
from app.db import Database
from app.main import COOKIE, create_app

HEADERS = {'X-Margin-Client': 'web'}


class ControlledProvider:
    models = ('test-fast', 'test-slow')
    mode = 'test'

    def __init__(self, failure=None):
        self.failure = failure
        self.calls = []

    async def generate(self, model, prompt):
        self.calls.append(model)
        await asyncio.sleep(0.01 if model == 'test-fast' else 0.15)
        if model == 'test-slow':
            if self.failure == 'error':
                raise RuntimeError('secret-provider-key-must-not-leak')
            if self.failure == 'empty':
                return '  '
            if self.failure == 'large':
                return 'x' * 60001
        return 'First paragraph.\n\nA useful explanation.'


def session(client):
    response = client.post('/api/session', headers=HEADERS)
    assert response.status_code == 200
    return response


def submit(client, prompt='Explain an index', request_id=None):
    response = client.post('/api/comparisons', json={'prompt': prompt, 'request_id': request_id or str(uuid4())}, headers=HEADERS)
    assert response.status_code in (200, 202), response.text
    return response.json()


def settle(client, identifier):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        comparison = client.get(f'/api/comparisons/{identifier}').json()
        if comparison['status'] != 'pending':
            return comparison
        time.sleep(0.01)
    pytest.fail('Comparison did not settle within three seconds')


@pytest.fixture
def settings(tmp_path):
    return Settings(database_path=tmp_path / 'app.sqlite3', frontend_path=tmp_path / 'no-ui')


def test_full_workflow_blindness_idempotency_and_restart(settings):
    provider = ControlledProvider()
    with TestClient(create_app(settings, provider)) as client:
        response = session(client)
        assert 'HttpOnly' in response.headers['set-cookie'] and 'SameSite=lax' in response.headers['set-cookie']
        token = client.cookies[COOKIE]
        assert token not in settings.database_path.read_bytes().decode('latin1')
        request_id = str(uuid4())
        created = submit(client, '  Explain an index  ', request_id)
        assert created['prompt'] == 'Explain an index'
        assert all(answer['model'] is None for answer in created['responses'])
        assert submit(client, 'Explain an index', request_id)['id'] == created['id']
        finished = settle(client, created['id'])
        assert finished['status'] == 'ready'
        assert sorted(provider.calls) == sorted(provider.models)
        assert all(answer['model'] is None for answer in finished['responses'])
        assert not any(name in str(finished) for name in provider.models)
        payload = {'choice': 'A', 'reason': 'Clarity', 'evidence': {'side': 'A', 'paragraph_index': 1}}
        vote = client.post(f'/api/comparisons/{created["id"]}/vote', json=payload, headers=HEADERS)
        assert vote.status_code == 200
        saved = vote.json()
        assert saved['vote']['evidence']['quote'] == 'A useful explanation.'
        assert all(answer['model'] for answer in saved['responses'])
        assert client.post(f'/api/comparisons/{created["id"]}/vote', json=payload, headers=HEADERS).json() == saved
        assert client.post(f'/api/comparisons/{created["id"]}/vote', json={'choice': 'B'}, headers=HEADERS).status_code == 409
        assert client.get('/api/comparisons').json()['items'][0]['vote'] == 'A'
    with TestClient(create_app(settings, ControlledProvider())) as restarted:
        restarted.cookies.set(COOKIE, token, path='/api')
        assert restarted.get(f'/api/comparisons/{created["id"]}').json() == saved
        assert sum(row['wins'] for row in restarted.get('/api/scores').json()['items']) == 1
        restarted.cookies.clear()
        session(restarted)
        assert restarted.get(f'/api/comparisons/{created["id"]}').status_code == 404
        assert restarted.get('/api/comparisons').json()['items'] == []
        assert all(row['compared'] == 0 for row in restarted.get('/api/scores').json()['items'])


def test_calls_start_concurrently_and_partial_result_is_visible(settings):
    provider = ControlledProvider()
    with TestClient(create_app(settings, provider)) as client:
        session(client)
        identifier = submit(client)['id']
        deadline = time.monotonic() + 1
        partial = None
        while time.monotonic() < deadline:
            partial = client.get(f'/api/comparisons/{identifier}').json()
            if any(answer['status'] == 'success' for answer in partial['responses']):
                break
            time.sleep(0.005)
        assert len(provider.calls) == 2
        assert sorted(answer['status'] for answer in partial['responses']) == ['pending', 'success']
        assert client.post(f'/api/comparisons/{identifier}/vote', json={'choice': 'A'}, headers=HEADERS).status_code == 409
        assert settle(client, identifier)['status'] == 'ready'


@pytest.mark.parametrize('failure', ['error', 'empty', 'large', 'timeout'])
def test_failure_preserves_other_response_blocks_votes_and_hides_error_details(settings, failure):
    if failure == 'timeout':
        settings = Settings(database_path=settings.database_path, timeout_seconds=0.06)
    with TestClient(create_app(settings, ControlledProvider(failure))) as client:
        session(client)
        result = settle(client, submit(client)['id'])
        assert result['status'] == 'failed'
        assert sorted(answer['status'] for answer in result['responses']) == ['error', 'success']
        assert 'secret-provider-key' not in str(result)
        assert client.post(f'/api/comparisons/{result["id"]}/vote', json={'choice': 'tie'}, headers=HEADERS).status_code == 409
        assert all(row['compared'] == 0 for row in client.get('/api/scores').json()['items'])


def test_validation_sessions_and_origin_protection(settings):
    with TestClient(create_app(settings, ControlledProvider())) as client:
        assert client.get('/api/comparisons').status_code == 401
        assert client.post('/api/session').status_code == 403
        assert client.post('/api/session', headers={**HEADERS, 'Origin': 'https://unrelated.example'}).status_code == 403
        assert client.post('/api/session', headers={**HEADERS, 'Origin': 'http://testserver'}).status_code == 200
        for prompt in ('', '   ', 'x' * 12001, 42):
            response = client.post('/api/comparisons', json={'request_id': str(uuid4()), 'prompt': prompt}, headers=HEADERS)
            assert response.status_code == 422
            assert 'input' not in str(response.json())
        assert client.post('/api/comparisons', json={'request_id': 'invalid', 'prompt': 'hello'}, headers=HEADERS).status_code == 422
        assert client.get('/api/comparisons?limit=10000').status_code == 422
        assert client.get('/api/not-a-route').status_code == 404


def test_startup_recovers_interrupted_work(settings):
    db = Database(settings.database_path)
    db.initialize()
    token = 'previous-session'
    owner = sha256(token.encode()).hexdigest()
    db.add_session(owner)
    identifier, _ = db.create_comparison(owner, str(uuid4()), 'Interrupted prompt', ['old-a', 'old-b'], 4)
    db.finish_response(identifier, 'A', content='Completed before restart.')
    with TestClient(create_app(settings, ControlledProvider())) as client:
        client.cookies.set(COOKIE, token, path='/api')
        comparison = client.get(f'/api/comparisons/{identifier}').json()
        assert comparison['status'] == 'failed'
        assert comparison['responses'][0]['paragraphs'] == ['Completed before restart.']
        assert 'restarted' in comparison['responses'][1]['error']


def test_secure_cookie_and_unknown_provider(settings):
    secure = Settings(database_path=settings.database_path, cookie_secure=True)
    with TestClient(create_app(secure, ControlledProvider()), base_url='https://testserver') as client:
        assert 'Secure' in session(client).headers['set-cookie']
    with pytest.raises(ValueError, match='Only MARGIN_PROVIDER=mock'):
        create_app(Settings(provider='not-configured'))
