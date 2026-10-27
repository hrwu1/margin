import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.providers import OpenAIProvider, ProviderFailure, configured_provider


def request(monkeypatch, payload, status=200):
    seen = []
    def handler(request):
        seen.append(request)
        return httpx.Response(status, json=payload)
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return seen


def test_responses_contract_and_exact_models(monkeypatch):
    seen = request(monkeypatch, {'status': 'completed', 'output': [
        {'type': 'reasoning', 'summary': []},
        {'type': 'message', 'content': [{'type': 'output_text', 'text': 'Answer.'}]},
    ]})
    provider = OpenAIProvider('test-not-a-real-key')
    provider.models = ('gpt-5.6-luna', 'gpt-6-luna')
    for model in provider.models:
        assert asyncio.run(provider.generate(model, 'Same prompt')) == 'Answer.'
    bodies = [json.loads(item.content) for item in seen]
    assert [body.pop('model') for body in bodies] == ['gpt-5.6-luna', 'gpt-6-luna']
    assert bodies[0] == bodies[1] == {'input': 'Same prompt', 'store': False, 'reasoning': {'effort': 'low'}, 'max_output_tokens': 4096}
    assert all(item.url == 'https://api.openai.com/v1/responses' for item in seen)


@pytest.mark.parametrize('status,payload,code', [
    (401, {'error': {'message': 'private details'}}, 'credentials'),
    (403, {}, 'credentials'), (404, {}, 'model_unavailable'),
    (429, {'error': {'code': 'insufficient_quota'}}, 'quota'),
    (429, {'error': {}}, 'rate_limit'), (500, {}, 'provider_error'),
    (200, {'status': 'incomplete', 'output': []}, 'incomplete'),
    (200, {'status': 'completed', 'output': []}, 'invalid_response'),
    (200, {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'refusal'}]}]}, 'refusal'),
])
def test_safe_failures(monkeypatch, status, payload, code):
    request(monkeypatch, payload, status)
    provider = OpenAIProvider('never-echo-key')
    provider.models = ('gpt-6-luna',)
    with pytest.raises(ProviderFailure) as error:
        asyncio.run(provider.generate('gpt-6-luna', 'private prompt'))
    assert str(error.value) == code


def test_explicit_configuration_and_secret_repr(monkeypatch):
    assert configured_provider('mock').mode == 'mock'
    with pytest.raises(ValueError, match='OPENAI_API_KEY'):
        configured_provider('openai')
    monkeypatch.setenv('MARGIN_PROVIDER', 'openai')
    monkeypatch.setenv('OPENAI_API_KEY', 'never-echo-key')
    settings = Settings.from_environment()
    assert settings.api_key == 'never-echo-key'
    assert 'never-echo-key' not in repr(settings)
    assert settings.provider == 'openai'


def test_model_discovery_filters_modalities_keeps_snapshots_and_caches(monkeypatch):
    included = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.6-terra', 'gpt-5.4-nano-2026-03-17',
                'gpt-5.3-codex', 'gpt-5-pro', 'gpt-5-chat-latest', 'gpt-4o-search-preview',
                'gpt-4.1-mini', 'gpt-4', 'gpt-3.5-turbo-instruct']
    excluded = ['gpt-image-2', 'gpt-audio', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview',
                'gpt-4o-mini-transcribe', 'gpt-4o-mini-tts', 'gpt-live-1', 'gpt-realtime',
                'o3', 'text-embedding-3-small', 'ft:gpt-4.1:custom', 'chatgpt-image-latest']
    seen = request(monkeypatch, {'data': [{'id': model} for model in included + excluded + included]})
    provider = OpenAIProvider('test-key')
    async def discover():
        first, second = await asyncio.gather(provider.list_models(), provider.list_models())
        assert first == second == tuple(sorted(included))
        assert len(seen) == 1
        provider._models_until = 0
        assert await provider.list_models() == first
        assert len(seen) == 2
    asyncio.run(discover())
    assert all(item.method == 'GET' and item.url.path == '/v1/models' for item in seen)


@pytest.mark.parametrize('payload', [{}, {'data': None}, {'data': ['gpt-6-luna']}, {'data': [{'id': 1}]}])
def test_invalid_catalog_is_not_cached(monkeypatch, payload):
    request(monkeypatch, payload)
    provider = OpenAIProvider('private-key')
    with pytest.raises(ProviderFailure, match='invalid_response'):
        asyncio.run(provider.list_models())
    assert provider._models_until == 0
    assert provider.models == ()


@pytest.mark.parametrize('model,endpoint', [
    ('gpt-4o-mini', 'responses'), ('gpt-4.1-nano-2025-04-14', 'responses'),
    ('gpt-5-pro', 'responses'), ('gpt-5.3-codex', 'responses'),
    ('gpt-5-chat-latest', 'responses'), ('gpt-6.1-sol', 'responses'),
    ('gpt-3.5-turbo', 'chat/completions'), ('gpt-4-0613', 'chat/completions'),
    ('gpt-4-turbo', 'chat/completions'), ('gpt-4o-search-preview', 'chat/completions'),
    ('gpt-5-search-api', 'chat/completions'), ('gpt-3.5-turbo-instruct-0914', 'completions'),
])
def test_selected_model_uses_compatible_endpoint_and_parameters(monkeypatch, model, endpoint):
    payload = {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'Answer.'}]}]} if endpoint == 'responses' else {
        'choices': [{'finish_reason': 'stop', 'text': 'Answer.', 'message': {'content': 'Answer.'}}]}
    seen = request(monkeypatch, payload)
    provider = OpenAIProvider('test-key')
    provider.models = (model,)
    assert asyncio.run(provider.generate(model, 'Same prompt')) == 'Answer.'
    assert len(seen) == 1 and seen[0].url.path == f'/v1/{endpoint}'
    body = json.loads(seen[0].content)
    assert body['model'] == model and 'reasoning' not in body
    if endpoint == 'responses':
        assert body['input'] == 'Same prompt' and body['max_output_tokens'] == 4096
    elif endpoint == 'chat/completions':
        assert body['messages'] == [{'role': 'user', 'content': 'Same prompt'}]
        assert body['max_completion_tokens'] == 4096
    else:
        assert body['prompt'] == 'Same prompt' and body['max_tokens'] == 1024
    assert body.get('store') is (None if endpoint == 'completions' else False)
    with pytest.raises(ValueError, match='Unknown'):
        asyncio.run(provider.generate('not-in-catalog', 'Same prompt'))
    assert len(seen) == 1


@pytest.mark.parametrize('choice,code', [
    ({'finish_reason': 'length', 'text': 'partial'}, 'incomplete'),
    ({'finish_reason': 'content_filter'}, 'refusal'),
    ({'finish_reason': 'stop', 'message': {'refusal': 'private'}}, 'refusal'),
    ({'finish_reason': 'stop', 'text': '', 'message': {'content': ''}}, 'invalid_response'),
    ({'finish_reason': 'tool_calls'}, 'invalid_response'),
])
def test_legacy_errors_are_safe(monkeypatch, choice, code):
    seen = request(monkeypatch, {'choices': [choice]})
    provider = OpenAIProvider('private-key')
    provider.models = ('gpt-3.5-turbo', 'gpt-3.5-turbo-instruct')
    for model in provider.models:
        with pytest.raises(ProviderFailure, match=code):
            asyncio.run(provider.generate(model, 'private prompt'))
    assert len(seen) == 2
