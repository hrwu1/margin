import asyncio
import re
import time
from typing import Protocol

import httpx


class Provider(Protocol):
    models: tuple[str, ...]
    mode: str

    async def list_models(self) -> tuple[str, ...]: ...

    async def generate(self, model: str, prompt: str) -> str: ...


class MockProvider:
    """An explicit, deterministic fixture; it never calls a model or the network."""

    models = ('local-concise', 'local-detailed', 'local-structured')
    mode = 'mock'

    async def list_models(self) -> tuple[str, ...]:
        return self.models

    async def generate(self, model: str, prompt: str) -> str:
        await asyncio.sleep(0.4 if model == self.models[0] else 0.9)
        received = prompt[:1000] + ('…' if len(prompt) > 1000 else '')
        if model == 'local-structured':
            return f'Local test response — no AI model was called.\n\nPrompt received: {received}\n\n1. Read all responses before ranking.\n2. Give every answer a rank; equal numbers are ties.\n3. Save your ranking to reveal the models.'
        if model == self.models[0]:
            return f'Local test response — no AI model was called.\n\nPrompt received: {received}\n\nThis concise fixture lets you exercise paragraph selection, voting, and persistence. It is not an answer to your question.'
        return f'Local test response — no AI model was called.\n\nYou asked: {received}\n\nThis longer fixture provides a different response for comparing the workflow. Select this paragraph if you want to test saving evidence.\n\nAfter you vote, reopen the comparison from History. The backend should restore your vote, reason, and exact passage.'



class ProviderFailure(Exception):
    """A safe error code, never an upstream response or credential."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class OpenAIProvider:
    models: tuple[str, ...] = ()
    mode = 'openai'

    def __init__(self, api_key: str, timeout: float = 90):
        if not api_key:
            raise ValueError('Set OPENAI_API_KEY in the project .env, or explicitly use MARGIN_PROVIDER=mock for offline testing.')
        self._api_key = api_key
        self.timeout = timeout
        self._models_until = 0
        self._models_lock = asyncio.Lock()

    async def _request(self, method: str, endpoint: str, body: dict | None = None) -> dict:
        try:
            # No automatic retries: a timed-out request may already have incurred usage.
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(
                    method, f'https://api.openai.com/v1/{endpoint}',
                    headers={'Authorization': f'Bearer {self._api_key}'},
                    **({'json': body} if body is not None else {}),
                )
        except httpx.TimeoutException:
            raise ProviderFailure('timeout') from None
        except httpx.RequestError:
            raise ProviderFailure('provider_error') from None
        if response.status_code in (401, 403):
            raise ProviderFailure('credentials')
        if response.status_code == 404:
            raise ProviderFailure('model_unavailable')
        if response.status_code == 429:
            try:
                code = response.json().get('error', {}).get('code')
            except (ValueError, AttributeError):
                code = None
            raise ProviderFailure('quota' if code in ('insufficient_quota', 'billing_hard_limit_reached') else 'rate_limit')
        if response.is_error:
            raise ProviderFailure('provider_error')
        try:
            payload = response.json()
        except ValueError:
            raise ProviderFailure('invalid_response') from None
        if not isinstance(payload, dict):
            raise ProviderFailure('invalid_response')
        return payload

    async def list_models(self) -> tuple[str, ...]:
        async with self._models_lock:
            if time.monotonic() < self._models_until:
                return self.models
            payload = await self._request('GET', 'models')
            entries = payload.get('data')
            if not isinstance(entries, list) or any(not isinstance(item, dict) or not isinstance(item.get('id'), str) for item in entries):
                raise ProviderFailure('invalid_response')
            # /models has no modality metadata. Keep numbered GPT text families,
            # including snapshots, coding and search; exclude audio/image variants.
            self.models = tuple(sorted({item['id'] for item in entries
                                        if re.match(r'^gpt-\d', item['id'])
                                        and not re.search(r'-(audio|realtime|transcribe|tts|image)(-|$)', item['id'])}))
            self._models_until = time.monotonic() + 300
            return self.models

    async def generate(self, model: str, prompt: str) -> str:
        if model not in self.models:
            raise ValueError('Unknown comparison model.')
        if model.startswith('gpt-3.5-turbo-instruct'):
            payload = await self._request('POST', 'completions',
                                          {'model': model, 'prompt': prompt, 'max_tokens': 1024})
            return self._completion_text(payload, chat=False)
        if model.startswith('gpt-3.5-') or re.match(r'^gpt-4($|-)', model) or '-search-' in model:
            payload = await self._request('POST', 'chat/completions',
                                          {'model': model, 'messages': [{'role': 'user', 'content': prompt}],
                                           'store': False, 'max_completion_tokens': 4096})
            return self._completion_text(payload, chat=True)
        body = {'model': model, 'input': prompt, 'store': False, 'max_output_tokens': 4096}
        # Preserve the original pair's settings; other models use their defaults.
        if model in ('gpt-5.6-luna', 'gpt-6-luna'):
            body['reasoning'] = {'effort': 'low'}
        payload = await self._request('POST', 'responses', body)
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

    @staticmethod
    def _completion_text(payload: dict, *, chat: bool) -> str:
        choices = payload.get('choices') or []
        if not choices:
            raise ProviderFailure('invalid_response')
        choice = choices[0]
        if choice.get('finish_reason') == 'length':
            raise ProviderFailure('incomplete')
        message = choice.get('message') or {}
        if choice.get('finish_reason') == 'content_filter' or message.get('refusal'):
            raise ProviderFailure('refusal')
        if choice.get('finish_reason') != 'stop':
            raise ProviderFailure('invalid_response')
        text = message.get('content') if chat else choice.get('text')
        if not isinstance(text, str) or not text.strip():
            raise ProviderFailure('invalid_response')
        return text


def configured_provider(name: str, api_key: str = '', timeout: float = 90) -> Provider:
    if name == 'mock':
        return MockProvider()
    if name == 'openai':
        return OpenAIProvider(api_key, timeout)
    raise ValueError('Use MARGIN_PROVIDER=openai or mock. No silent fallback is used.')
