"""Apply SQL migrations to the configured Supabase Postgres database.

Usage (from backend/):
    python scripts/apply_migrations.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app import config


def main() -> int:
    if not config.SUPABASE_DB_URL:
        print("SUPABASE_DB_URL is not configured in backend/.env")
        return 1

    migrations = sorted((BACKEND / "migrations").glob("*.sql"))
    if not migrations:
        print("No migrations found.")
        return 1

    kwargs = {"connect_timeout": 15}
    if "sslmode=" not in config.SUPABASE_DB_URL:
        kwargs["sslmode"] = "require"

    try:
        with psycopg.connect(config.SUPABASE_DB_URL, **kwargs) as conn:
            for migration in migrations:
                conn.execute(migration.read_text(encoding="utf-8"))
                print(f"applied {migration.name}")
            conn.commit()
    except psycopg.Error as exc:
        print(f"migration failed: {type(exc).__name__}: {str(exc).splitlines()[0]}")
        return 1

    print("migrations complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
