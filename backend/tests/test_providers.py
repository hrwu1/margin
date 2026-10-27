import asyncio

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
    for model in provider.models:
        assert asyncio.run(provider.generate(model, 'Same prompt')) == 'Answer.'
    import json
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
    with pytest.raises(ProviderFailure) as error:
        asyncio.run(OpenAIProvider('never-echo-key').generate('gpt-6-luna', 'private prompt'))
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
