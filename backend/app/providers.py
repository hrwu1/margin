import asyncio
from typing import Protocol

import httpx


class Provider(Protocol):
    models: tuple[str, str]
    mode: str

    async def generate(self, model: str, prompt: str) -> str: ...


class MockProvider:
    """An explicit, deterministic fixture; it never calls a model or the network."""

    models = ('local-concise', 'local-detailed')
    mode = 'mock'

    async def generate(self, model: str, prompt: str) -> str:
        await asyncio.sleep(0.4 if model == self.models[0] else 0.9)
        received = prompt[:1000] + ('…' if len(prompt) > 1000 else '')
        if model == self.models[0]:
            return f'Local test response — no AI model was called.\n\nPrompt received: {received}\n\nThis concise fixture lets you exercise paragraph selection, voting, and persistence. It is not an answer to your question.'
        return f'Local test response — no AI model was called.\n\nYou asked: {received}\n\nThis longer fixture provides a different response for comparing the workflow. Select this paragraph if you want to test saving evidence.\n\nAfter you vote, reopen the comparison from History. The backend should restore your vote, reason, and exact passage.'



class ProviderFailure(Exception):
    """A safe error code, never an upstream response or credential."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class OpenAIProvider:
    models = ('gpt-5.6-luna', 'gpt-6-luna')
    mode = 'openai'

    def __init__(self, api_key: str, timeout: float = 90):
        if not api_key:
            raise ValueError('Set OPENAI_API_KEY in the project .env, or explicitly use MARGIN_PROVIDER=mock for offline testing.')
        self._api_key = api_key
        self.timeout = timeout

    async def generate(self, model: str, prompt: str) -> str:
        if model not in self.models:
            raise ValueError('Unknown comparison model.')
        try:
            # No automatic retries: a timed-out request may already have incurred usage.
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    'https://api.openai.com/v1/responses',
                    headers={'Authorization': f'Bearer {self._api_key}'},
                    json={'model': model, 'input': prompt, 'store': False,
                          'reasoning': {'effort': 'low'}, 'max_output_tokens': 4096},
                )
        except httpx.TimeoutException:
            raise TimeoutError from None
        if response.status_code in (401, 403):
            raise ProviderFailure('credentials')
        if response.status_code == 404:
            raise ProviderFailure('model_unavailable')
        if response.status_code == 429:
            code = response.json().get('error', {}).get('code')
            raise ProviderFailure('quota' if code in ('insufficient_quota', 'billing_hard_limit_reached') else 'rate_limit')
        if response.is_error:
            raise ProviderFailure('provider_error')
        payload = response.json()
        if payload.get('status') == 'incomplete':
            raise ProviderFailure('incomplete')
        if payload.get('status') != 'completed':
            raise ProviderFailure('provider_error')
        parts = [part for item in payload.get('output', []) if item.get('type') == 'message'
                 for part in item.get('content', [])]
        if any(part.get('type') == 'refusal' for part in parts):
            raise ProviderFailure('refusal')
        content = '\n\n'.join(part['text'] for part in parts if part.get('type') == 'output_text')
        if not content.strip():
            raise ProviderFailure('invalid_response')
        return content


def configured_provider(name: str, api_key: str = '', timeout: float = 90) -> Provider:
    if name == 'mock':
        return MockProvider()
    if name == 'openai':
        return OpenAIProvider(api_key, timeout)
    raise ValueError('Use MARGIN_PROVIDER=openai or mock. No silent fallback is used.')
