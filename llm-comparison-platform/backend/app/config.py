from dataclasses import dataclass
import os
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    database_path: Path = PROJECT / 'backend' / 'data' / 'margin.sqlite3'
    frontend_path: Path = PROJECT / 'frontend' / 'dist'
    provider: str = 'mock'
    timeout_seconds: float = 30
    max_active: int = 4
    cookie_secure: bool = False

    def __post_init__(self):
        if not 0 < self.timeout_seconds <= 120 or not 1 <= self.max_active <= 16:
            raise ValueError('Use a timeout in (0, 120] seconds and 1–16 active comparisons.')

    @classmethod
    def from_environment(cls):
        return cls(
            database_path=Path(os.environ.get('MARGIN_DATABASE_PATH', cls.database_path)),
            provider=os.environ.get('MARGIN_PROVIDER', 'mock'),
            timeout_seconds=float(os.environ.get('MARGIN_MODEL_TIMEOUT', '30')),
            max_active=int(os.environ.get('MARGIN_MAX_ACTIVE', '4')),
            cookie_secure=os.environ.get('MARGIN_COOKIE_SECURE', 'false').lower() in ('true', '1'),
        )
