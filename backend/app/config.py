from dataclasses import dataclass, field
import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    database_path: Path = PROJECT / 'backend' / 'data' / 'margin.sqlite3'
    frontend_path: Path = PROJECT / 'frontend' / 'dist'
    provider: str = 'mock'
    api_key: str = field(default='', repr=False)
    timeout_seconds: float = 90
    max_active: int = 4
    cookie_secure: bool = False

    def __post_init__(self):
        if not 0 < self.timeout_seconds <= 120 or not 1 <= self.max_active <= 16:
            raise ValueError('Use a timeout in (0, 120] seconds and 1–16 active comparisons.')

    @classmethod
    def from_environment(cls):
        load_dotenv(PROJECT / '.env', override=False)
        return cls(
            database_path=Path(os.environ.get('MARGIN_DATABASE_PATH', cls.database_path)),
            provider=os.environ.get('MARGIN_PROVIDER', 'openai'),
            api_key=os.environ.get('OPENAI_API_KEY', ''),
            timeout_seconds=float(os.environ.get('MARGIN_MODEL_TIMEOUT', '90')),
            max_active=int(os.environ.get('MARGIN_MAX_ACTIVE', '4')),
            cookie_secure=os.environ.get('MARGIN_COOKIE_SECURE', 'false').lower() in ('true', '1'),
        )
