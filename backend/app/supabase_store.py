"""Supabase profile store for Firebase identities.

Uses the Supabase Data API with the service-role key. The service role must
never be exposed to the browser; all profile writes go through the backend.
"""
from __future__ import annotations

import re
import secrets
from typing import Any
from urllib.parse import quote

import httpx

from . import config
from .auth import AuthUser

_MISSING_TABLE_HINT = (
    "The Supabase profiles table is missing. Run backend/migrations/001_profiles.sql "
    "in the Supabase SQL editor, then try again."
)

_USERNAME_RE = re.compile(r"^[A-Za-z0-9 _-]{3,24}$")
_schema_ready = False


class SupabaseUnavailable(RuntimeError):
    pass


class UsernameTaken(ValueError):
    pass


def _headers() -> dict[str, str]:
    if not config.supabase_configured():
        raise SupabaseUnavailable("Supabase is not configured.")
    return {
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _url(path: str, query: str = "") -> str:
    base = config.SUPABASE_URL.rstrip("/")
    suffix = f"?{query}" if query else ""
    return f"{base}/rest/v1/{path}{suffix}"


def _request(
    method: str,
    path: str,
    *,
    query: str = "",
    json: Any = None,
    prefer: str | None = None,
) -> Any:
    headers = _headers()
    if prefer:
        headers["Prefer"] = prefer
    try:
        with httpx.Client(timeout=10) as client:
            response = client.request(
                method,
                _url(path, query),
                headers=headers,
                json=json,
            )
    except httpx.HTTPError as exc:
        raise SupabaseUnavailable("Supabase is unavailable.") from exc
    if response.status_code == 404:
        raise SupabaseUnavailable(_MISSING_TABLE_HINT)
    if response.status_code == 409:
        try:
            code = response.json().get("code")
        except ValueError:
            code = None
        if code == "23505":
            raise UsernameTaken("That username is already taken.")
    if response.status_code >= 400:
        raise SupabaseUnavailable("Supabase rejected the profile request.")
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise SupabaseUnavailable("Supabase returned an invalid response.") from exc


def ensure_schema() -> None:
    """Verify that the profiles table exists.

    The migration is intentionally run once by a human in the Supabase SQL
    editor. The backend only verifies readiness, so the service role never
    needs DDL privileges.
    """
    global _schema_ready
    if _schema_ready:
        return
    _request("GET", "profiles", query="select=id&limit=0")
    _schema_ready = True


def _clean_username(value: str) -> str:
    return re.sub(r"[^\w \-]", "", value or "").strip()[:24]


def _validate_username(value: str) -> str:
    username = _clean_username(value)
    if not _USERNAME_RE.fullmatch(username):
        raise UsernameTaken(
            "Username must be 3-24 letters, numbers, spaces, underscores or hyphens."
        )
    return username


def get_profile(uid: str) -> dict[str, Any] | None:
    ensure_schema()
    rows = _request(
        "GET",
        "profiles",
        query=f"select=*&id=eq.{quote(uid, safe='')}&limit=1",
    )
    return rows[0] if rows else None


def get_profile_by_username(username: str) -> dict[str, Any] | None:
    ensure_schema()
    pattern = username.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = _request(
        "GET",
        "profiles",
        query=f"select=*&username=ilike.{quote(pattern, safe='')}&limit=1",
    )
    return rows[0] if rows else None


def _default_username(user: AuthUser) -> str:
    base = _clean_username(user.name or (user.email or "").split("@")[0] or "Player")
    if len(base) < 3:
        base = f"Player{secrets.randbelow(900) + 100}"
    for index in range(1, 100):
        suffix = "" if index == 1 else str(index)
        candidate = f"{base[:24 - len(suffix)]}{suffix}"
        if get_profile_by_username(candidate) is None:
            return candidate
    return f"Player{secrets.token_hex(3)}"


def create_or_update_profile(
    user: AuthUser,
    requested_username: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any]:
    username = _validate_username(requested_username) if requested_username else None
    ensure_schema()

    for _ in range(4):
        existing = get_profile(user.uid)
        target = username or (existing["username"] if existing else _default_username(user))
        target_display = (
            (display_name or username or (existing["display_name"] if existing else user.name) or target)
            [:48]
            .strip()
            or target
        )
        body = {
            "id": user.uid,
            "email": user.email,
            "username": target,
            "display_name": target_display,
            "email_verified": user.email_verified,
        }
        try:
            rows = _request(
                "POST",
                "profiles",
                query="on_conflict=id",
                json=body,
                prefer="resolution=merge-duplicates,return=representation",
            )
        except UsernameTaken:
            if username:
                raise
            continue
        if rows:
            return rows[0]
        raise SupabaseUnavailable("Could not save the Supabase profile.")

    raise SupabaseUnavailable("Could not allocate a unique username.")


def set_mfa_enabled(uid: str, enabled: bool) -> dict[str, Any] | None:
    ensure_schema()
    rows = _request(
        "PATCH",
        "profiles",
        query=f"id=eq.{quote(uid, safe='')}",
        json={"mfa_enabled": enabled},
        prefer="return=representation",
    )
    return rows[0] if rows else None


def profile_public(profile: dict[str, Any] | None) -> dict[str, Any] | None:
    if not profile:
        return None
    return {
        "id": profile["id"],
        "email": profile.get("email"),
        "username": profile["username"],
        "display_name": profile["display_name"],
        "avatar_url": profile.get("avatar_url"),
        "email_verified": bool(profile.get("email_verified")),
        "mfa_enabled": bool(profile.get("mfa_enabled")),
        "created_at": profile.get("created_at"),
        "updated_at": profile.get("updated_at"),
    }
