"""Runtime configuration loaded from backend/.env.

Secrets are never logged or exposed by this module.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _private_key() -> str:
    return _env("FIREBASE_PRIVATE_KEY").replace("\\n", "\n").strip()


FIREBASE_PROJECT_ID = _env("FIREBASE_PROJECT_ID")
FIREBASE_CLIENT_EMAIL = _env("FIREBASE_CLIENT_EMAIL")
FIREBASE_PRIVATE_KEY = _private_key()
APP_CHECK_ENFORCE = _env("FIREBASE_APP_CHECK_ENFORCE").lower() in {"1", "true", "yes", "on"}

SUPABASE_URL = _env("SUPABASE_URL").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_DB_URL = _env("SUPABASE_DB_URL")
SUPABASE_STORAGE_BUCKET = _env("SUPABASE_STORAGE_BUCKET", "avatars")

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in _env("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
FRONTEND_URL = _env("FRONTEND_URL", "http://localhost:3000")
ADMIN_UIDS = {
    uid.strip()
    for uid in _env("ADMIN_UIDS").split(",")
    if uid.strip()
}
ENVIRONMENT = _env("ENVIRONMENT", "development")


def firebase_configured() -> bool:
    return bool(FIREBASE_PROJECT_ID and FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY)


def supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


MATCH_STORE = _env(
    "AXIOM_MATCH_STORE",
    "supabase" if (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) else "sqlite",
).lower()
if MATCH_STORE not in {"supabase", "sqlite"}:
    MATCH_STORE = "sqlite"


def supabase_match_store_enabled() -> bool:
    return MATCH_STORE == "supabase" and supabase_configured()
