import asyncio
from typing import Protocol


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


def configured_provider(name: str) -> Provider:
    if name != 'mock':
        raise ValueError('Only MARGIN_PROVIDER=mock is configured. Choose live provider credentials before adding live generation; no silent fallback is used.')
    return MockProvider()
