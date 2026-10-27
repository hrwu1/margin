import asyncio
from contextlib import asynccontextmanager
from hashlib import sha256
import logging
import secrets
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import Settings
from .db import Capacity, Conflict, Database, InvalidVote, NotFound, paragraphs
from .providers import Provider, ProviderFailure, configured_provider

logger = logging.getLogger(__name__)
COOKIE = 'margin_session'
ERRORS = {
    'credentials': 'The server’s OpenAI key is invalid or lacks permission. Check the server configuration.',
    'quota': 'The OpenAI project has no available API quota. Check its billing or credits.',
    'rate_limit': 'OpenAI is temporarily rate limiting requests. Wait before starting a new comparison.',
    'model_unavailable': 'A selected model is unavailable to this OpenAI project. Choose another model.',
    'incomplete': 'This answer reached its output limit. Try a narrower prompt.',
    'refusal': 'This model declined the request. Try a different prompt.',
    'timeout': 'This response took too long. Start a new comparison to try again.',
    'provider_error': 'This response could not be generated. Start a new comparison to try again.',
    'invalid_response': 'The provider returned an empty or oversized response.',
    'interrupted': 'The server restarted before this response finished. Start a new comparison to try again.',
}


class CreateComparison(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    prompt: str = Field(min_length=1, max_length=12000)
    models: tuple[str, str]

    @field_validator('models')
    @classmethod
    def distinct_models(cls, value):
        if value[0] == value[1]:
            raise ValueError('Choose two distinct models.')
        return value

    @field_validator('prompt', mode='before')
    @classmethod
    def trim_prompt(cls, value):
        return value.strip() if isinstance(value, str) else value


class Evidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    side: Literal['A', 'B']
    paragraph_index: int = Field(ge=0, strict=True)


class Vote(BaseModel):
    model_config = ConfigDict(extra='forbid')
    choice: Literal['A', 'B', 'tie']
    reason: Literal['Clarity', 'Depth', 'Practicality', 'Follows the prompt'] | None = None
    evidence: Evidence | None = None
    annotation_revision: int | None = Field(default=None, ge=0, strict=True)


class Highlight(Evidence):
    start: int = Field(ge=0, strict=True)
    end: int = Field(ge=1, strict=True)
    quote: str = Field(min_length=1, max_length=60000)
    note: str = Field(default='', max_length=1000)


class Annotations(BaseModel):
    model_config = ConfigDict(extra='forbid')
    highlights: list[Highlight] = Field(default_factory=list, max_length=50)
    reason: Literal['Correctness', 'Clarity', 'Useful detail', 'Follows the prompt', 'Depth', 'Practicality'] | None = None
    note: str = Field(default='', max_length=2000)


class SaveAnnotations(Annotations):
    revision: int = Field(ge=0, strict=True)


class ReviseVote(BaseModel):
    model_config = ConfigDict(extra='forbid')
    choice: Literal['A', 'B', 'tie']
    revision: int = Field(ge=0, strict=True)


def public_comparison(record):
    vote = record['vote']
    responses = [{
        'side': answer['side'], 'status': answer['status'],
        'model': answer['model'] if vote else None,
        'paragraphs': paragraphs(answer['content']),
        'error': ERRORS.get(answer['error_code']) if answer['error_code'] else None,
    } for answer in record['responses']]
    public_vote = None
    if vote:
        evidence = None
        if vote['evidence_side']:
            answer = next(answer for answer in responses if answer['side'] == vote['evidence_side'])
            evidence = {'side': vote['evidence_side'], 'paragraph_index': vote['evidence_index'], 'quote': answer['paragraphs'][vote['evidence_index']]}
        public_vote = {'choice': vote['choice'], 'reason': vote['reason'], 'evidence': evidence, 'created_at': vote['created_at'], 'edited': bool(vote['edited']), 'revision': vote['revision'], 'updated_at': vote['updated_at']}
    return {'id': record['id'], 'prompt': record['prompt'], 'status': record['status'],
            'created_at': record['created_at'], 'responses': responses, 'vote': public_vote,
            'annotations': record['annotations'], 'annotation_revision': record['annotation_revision']}


def create_app(settings: Settings | None = None, provider: Provider | None = None) -> FastAPI:
    settings = settings or Settings.from_environment()
    provider = provider or configured_provider(settings.provider, settings.api_key, settings.timeout_seconds)
    db = Database(settings.database_path)
    tasks: set[asyncio.Task] = set()

    @asynccontextmanager
    async def lifespan(app):
        await asyncio.to_thread(db.initialize)
        await asyncio.to_thread(db.recover_interrupted)
        yield
        for task in list(tasks):
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.to_thread(db.recover_interrupted)

    app = FastAPI(title='Margin API', version='0.1.0', lifespan=lifespan)

    @app.middleware('http')
    async def same_origin_mutations(request: Request, call_next):
        if request.url.path.startswith('/api/'):
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                origin = request.headers.get('origin')
                expected_origin = f'{request.url.scheme}://{request.headers.get("host", "")}'
                if request.headers.get('x-margin-client') != 'web' or (origin and origin != expected_origin):
                    return JSONResponse({'detail': 'Use the same-origin app to make this request.'}, status_code=403)
            result = await call_next(request)
            result.headers['Cache-Control'] = 'no-store'
            result.headers['X-Content-Type-Options'] = 'nosniff'
            return result
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Do not echo private prompts or request payloads in validation responses.
        return JSONResponse({'detail': 'Check the request fields.', 'errors': [
            {'field': '.'.join(str(part) for part in item['loc']), 'message': item['msg']}
            for item in error.errors()
        ]}, status_code=422)

    async def domain_error(request, error):
        status = {NotFound: 404, Conflict: 409, Capacity: 429, InvalidVote: 422}[type(error)]
        return JSONResponse({'detail': str(error)}, status_code=status)

    for error in (NotFound, Conflict, Capacity, InvalidVote):
        app.add_exception_handler(error, domain_error)

    @app.exception_handler(ProviderFailure)
    async def provider_error(request, error):
        return JSONResponse({'detail': 'Could not load the model list. ' + ERRORS.get(error.code, ERRORS['provider_error'])}, status_code=503)

    async def session(request: Request) -> str:
        token = request.cookies.get(COOKIE, '')
        hashed = sha256(token.encode()).hexdigest()
        if not token or len(token) > 128 or not await asyncio.to_thread(db.has_session, hashed):
            raise HTTPException(401, 'Your browser session is unavailable. Reload to start a new session.')
        return hashed

    @app.get('/api/health')
    async def health():
        return {'status': 'ok', 'provider_mode': provider.mode}

    @app.post('/api/session')
    async def start_session(request: Request, response: Response):
        token = request.cookies.get(COOKIE, '')
        hashed = sha256(token.encode()).hexdigest()
        if not token or len(token) > 128 or not await asyncio.to_thread(db.has_session, hashed):
            token = secrets.token_urlsafe(32)
            await asyncio.to_thread(db.add_session, sha256(token.encode()).hexdigest())
        response.set_cookie(COOKIE, token, httponly=True, samesite='lax', secure=settings.cookie_secure,
                            max_age=60 * 60 * 24 * 365, path='/api')
        return {'provider_mode': provider.mode, 'max_prompt_length': 12000}

    @app.get('/api/models')
    async def models(owner: Annotated[str, Depends(session)]):
        available = await provider.list_models()
        preferred = [model for model in ('gpt-5.6-luna', 'gpt-6-luna') if model in available]
        defaults = (preferred + [model for model in available if model not in preferred])[:2]
        return {'items': available, 'defaults': defaults}

    async def generate_response(comparison_id, side, model, prompt):
        error = None
        content = ''
        try:
            output = await asyncio.wait_for(provider.generate(model, prompt), timeout=settings.timeout_seconds)
            if not isinstance(output, str) or not output.strip() or len(output) > 60000:
                error = 'invalid_response'
            else:
                content = output.strip()
        except ProviderFailure as failure:
            error = failure.code
        except TimeoutError:
            error = 'timeout'
        except asyncio.CancelledError:
            error = 'interrupted'
        except Exception:
            # Provider exceptions can contain credentials and request contents.
            error = 'provider_error'
        await asyncio.to_thread(db.finish_response, comparison_id, side, content=content, error_code=error)

    async def generate_pair(record):
        outcomes = await asyncio.gather(*[
            generate_response(record['id'], answer['side'], answer['model'], record['prompt'])
            for answer in record['responses']
        ], return_exceptions=True)
        if any(isinstance(outcome, BaseException) for outcome in outcomes):
            logger.error('A comparison result could not be persisted. Check database availability.')

    @app.post('/api/comparisons')
    async def create_comparison(body: CreateComparison, response: Response, owner: Annotated[str, Depends(session)]):
        available = await provider.list_models()
        if any(model not in available for model in body.models):
            raise HTTPException(422, 'Choose two models from the available model list. Reload the list and try again.')
        models = list(body.models)
        secrets.SystemRandom().shuffle(models)
        identifier, created = await asyncio.to_thread(db.create_comparison, owner, str(body.request_id), body.prompt, models, settings.max_active)
        record = await asyncio.to_thread(db.get_comparison, owner, identifier)
        if created:
            task = asyncio.create_task(generate_pair(record))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
        response.status_code = 202 if record['status'] == 'pending' else 200
        return public_comparison(record)

    @app.get('/api/comparisons')
    async def history(owner: Annotated[str, Depends(session)], limit: Annotated[int, Query(ge=1, le=100)] = 20, offset: Annotated[int, Query(ge=0, le=100000)] = 0):
        return await asyncio.to_thread(db.history, owner, limit, offset)

    @app.get('/api/comparisons/{comparison_id}')
    async def comparison(comparison_id: UUID, owner: Annotated[str, Depends(session)]):
        return public_comparison(await asyncio.to_thread(db.get_comparison, owner, str(comparison_id)))

    @app.post('/api/comparisons/{comparison_id}/vote')
    async def vote(comparison_id: UUID, body: Vote, owner: Annotated[str, Depends(session)]):
        record = await asyncio.to_thread(db.vote, owner, str(comparison_id), body.choice, body.reason, body.evidence.model_dump() if body.evidence else None, body.annotation_revision)
        return public_comparison(record)

    @app.put('/api/comparisons/{comparison_id}/annotations')
    async def save_annotations(comparison_id: UUID, body: SaveAnnotations, owner: Annotated[str, Depends(session)]):
        record = await asyncio.to_thread(db.save_annotations, owner, str(comparison_id), body.revision, body.model_dump(exclude={'revision'}))
        return public_comparison(record)

    @app.patch('/api/comparisons/{comparison_id}/vote')
    async def revise_vote(comparison_id: UUID, body: ReviseVote, owner: Annotated[str, Depends(session)]):
        record = await asyncio.to_thread(db.revise_vote, owner, str(comparison_id), body.choice, body.revision)
        return public_comparison(record)

    @app.get('/api/scores')
    async def scores(owner: Annotated[str, Depends(session)]):
        return {'items': await asyncio.to_thread(db.scores, owner, ())}

    # API routes must remain 404s rather than falling through to the frontend.
    @app.api_route('/api/{path:path}', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    async def unknown_api(path: str):
        raise HTTPException(404, 'API route not found.')

    if settings.frontend_path.is_dir():
        app.mount('/', StaticFiles(directory=settings.frontend_path, html=True), name='frontend')
    return app


app = create_app()
