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
from .auth import AuthUser, mfa_enabled_from_profile

_MISSING_TABLE_HINT = (
    "The required Supabase table is missing. Run the matching file in "
    "backend/migrations/ in the Supabase SQL editor, then try again."
)
_SCHEMA_TABLES = {
    "profiles": "backend/migrations/001_profiles.sql",
    "avatars": "backend/migrations/003_phase4_avatar.sql",
    "rooms": "backend/migrations/003_phase4_avatar.sql",
    "audit_logs": "backend/migrations/003_phase4_avatar.sql",
}

_USERNAME_RE = re.compile(r"^[A-Za-z0-9 _-]{3,24}$")
_NON_ASCII_USERNAME_RE = re.compile(r"[^A-Za-z0-9 _-]")
_schema_ready = False


class SupabaseUnavailable(RuntimeError):
    pass


class UsernameTaken(ValueError):
    pass


class InvalidUsername(ValueError):
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


def _response_detail(response: Any) -> tuple[Any, str]:
    try:
        payload = response.json()
    except ValueError:
        payload = None
    code = payload.get("code") if isinstance(payload, dict) else None
    message = ""
    if isinstance(payload, dict):
        message = payload.get("message") or payload.get("details") or ""
    if not message:
        message = (response.text or "").strip()[:200] or "no response body"
    return code, str(message)


def _table_hint(path: str) -> str:
    table = path.split("?", 1)[0]
    migration = _SCHEMA_TABLES.get(table)
    if migration:
        return f"Run {migration} in the Supabase SQL editor, then try again."
    return _MISSING_TABLE_HINT


def _unavailable(method: str, path: str, response: Any, hint: str = "") -> SupabaseUnavailable:
    code, message = _response_detail(response)
    parts = [f"Supabase {method} /rest/v1/{path} failed (HTTP {response.status_code})"]
    if code:
        parts.append(f"PostgREST code {code}")
    parts.append(f"message: {message}")
    if hint:
        parts.append(hint)
    return SupabaseUnavailable(". ".join(parts))


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
        raise SupabaseUnavailable(f"Supabase {method} /rest/v1/{path} is unavailable.") from exc
    if response.status_code == 404:
        raise _unavailable(method, path, response, hint=_table_hint(path))
    if response.status_code == 409:
        code, _ = _response_detail(response)
        if code == "23505":
            raise UsernameTaken("That username is already taken.")
        raise _unavailable(method, path, response)
    if response.status_code >= 400:
        raise _unavailable(method, path, response)
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise SupabaseUnavailable(
            f"Supabase {method} /rest/v1/{path} returned an invalid response."
        ) from exc


def ensure_schema() -> None:
    """Verify that every table used by profile/avatar persistence is ready.

    Migrations are run once by a human in the Supabase SQL editor. The backend
    only verifies readiness, so the service role never needs DDL privileges.
    """
    global _schema_ready
    if _schema_ready:
        return
    for table in _SCHEMA_TABLES:
        _request("GET", table, query="select=*&limit=0")
    _schema_ready = True


def _clean_username(value: str) -> str:
    return _NON_ASCII_USERNAME_RE.sub("", value or "").strip()[:24]


def _validate_username(value: str) -> str:
    username = _clean_username(value)
    if not _USERNAME_RE.fullmatch(username):
        raise InvalidUsername(
            "Username must be 3-24 ASCII letters, numbers, spaces, underscores or hyphens."
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
        try:
            candidate = _validate_username(candidate)
        except InvalidUsername:
            continue
        if get_profile_by_username(candidate) is None:
            return candidate
    fallback = f"Player{secrets.token_hex(3)}"
    return _validate_username(fallback)


def ensure_profile_for(uid: str) -> dict[str, Any]:
    """Create a minimal profile so avatar rows never violate the FK."""
    existing = get_profile(uid)
    if existing:
        return existing
    placeholder = AuthUser(
        uid=uid, email=None, email_verified=False, name=None,
        picture=None, mfa_enabled=False, claims={},
    )
    return create_or_update_profile(placeholder)


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
            "avatar_url": (existing or {}).get("avatar_url"),
            "character_id": (existing or {}).get("character_id"),
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


def save_avatar(
    uid: str,
    character_id: str | None,
    avatar_url: str | None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    ensure_profile_for(uid)
    details = meta or {}
    row = {
        "firebase_uid": uid,
        "character_id": character_id,
        "avatar_url": avatar_url,
        "storage_path": details.get("storage_path"),
        "content_type": details.get("content_type"),
        "width": details.get("width"),
        "height": details.get("height"),
        "bytes": details.get("bytes"),
    }
    saved = _request(
        "POST",
        "avatars",
        query="on_conflict=firebase_uid",
        json=row,
        prefer="resolution=merge-duplicates,return=representation",
    )
    _request(
        "PATCH",
        "profiles",
        query=f"id=eq.{quote(uid, safe='')}",
        json={"avatar_url": avatar_url, "character_id": character_id},
        prefer="return=representation",
    )
    return saved[0] if saved else row


set_avatar = save_avatar


def get_avatar(uid: str) -> dict[str, Any] | None:
    ensure_schema()
    rows = _request(
        "GET",
        "avatars",
        query=f"select=*&firebase_uid=eq.{quote(uid, safe='')}&limit=1",
    )
    return rows[0] if rows else None


def clear_avatar(uid: str) -> dict[str, Any] | None:
    ensure_schema()
    _request("DELETE", "avatars", query=f"firebase_uid=eq.{quote(uid, safe='')}")
    rows = _request(
        "PATCH",
        "profiles",
        query=f"id=eq.{quote(uid, safe='')}",
        json={"avatar_url": None, "character_id": None},
        prefer="return=representation",
    )
    return rows[0] if rows else None


def export_user(uid: str) -> dict[str, Any]:
    from . import db

    ensure_schema()
    safe_uid = quote(uid, safe="")
    matches = _request(
        "GET",
        "match_players",
        query=f"select=match_id&auth_uid=eq.{safe_uid}",
    )
    history = db.store.match_history_for_uid(uid, 100)
    return {
        "profile": get_profile(uid),
        "avatar": get_avatar(uid),
        "stats": db.store.player_stats_for_uid(uid, (get_profile(uid) or {}).get("username", "")),
        "history": history,
        "match_ids": [row["match_id"] for row in matches],
    }


def delete_user(uid: str) -> None:
    ensure_schema()
    safe_uid = quote(uid, safe="")
    links = _request(
        "GET",
        "match_players",
        query=f"select=match_id&auth_uid=eq.{safe_uid}",
    )
    match_ids = [row["match_id"] for row in links]
    for match_id in match_ids:
        rows = _request("GET", "matches", query=f"select=id,summary&id=eq.{match_id}&limit=1")
        if not rows:
            continue
        summary = rows[0].get("summary") or {}
        players = summary.get("players") or []
        summary["players"] = [p for p in players if p.get("uid") != uid]
        _request(
            "PATCH",
            "matches",
            query=f"id=eq.{match_id}",
            json={"summary": summary},
            prefer="return=minimal",
        )
    for table in ("match_players", "player_models", "avatars", "audit_logs", "profiles"):
        column = "firebase_uid" if table in {"avatars", "audit_logs"} else (
            "id" if table == "profiles" else "auth_uid"
        )
        _request("DELETE", table, query=f"{column}=eq.{safe_uid}")


def profile_public(
    profile: dict[str, Any] | None, user: AuthUser | None = None
) -> dict[str, Any] | None:
    if not profile:
        return None
    from .avatar_store import normalize_avatar

    avatar_url, _ = normalize_avatar(
        profile.get("avatar_url"), profile.get("character_id"), profile.get("id")
    )
    token_fallback = bool(user.mfa_enabled) if user else False
    return {
        "id": profile["id"],
        "email": profile.get("email"),
        "username": profile["username"],
        "display_name": profile["display_name"],
        "avatar_url": avatar_url,
        "character_id": None,
        "email_verified": bool(profile.get("email_verified")),
        "mfa_enabled": mfa_enabled_from_profile(profile, token_fallback),
        "created_at": profile.get("created_at"),
        "updated_at": profile.get("updated_at"),
    }
