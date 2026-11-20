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
    details = meta or {}
    row = {
        "firebase_uid": uid,
        "character_id": character_id,
        "avatar_url": avatar_url,
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


def profile_public(profile: dict[str, Any] | None) -> dict[str, Any] | None:
    if not profile:
        return None
    return {
        "id": profile["id"],
        "email": profile.get("email"),
        "username": profile["username"],
        "display_name": profile["display_name"],
        "avatar_url": profile.get("avatar_url"),
        "character_id": profile.get("character_id"),
        "email_verified": bool(profile.get("email_verified")),
        "mfa_enabled": bool(profile.get("mfa_enabled")),
        "created_at": profile.get("created_at"),
        "updated_at": profile.get("updated_at"),
    }
