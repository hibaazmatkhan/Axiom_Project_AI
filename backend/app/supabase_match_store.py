"""Supabase-backed match, stats, model and leaderboard store.

All calls use the Supabase Data API with a server-only service-role key. The
browser never receives these credentials.
"""
from __future__ import annotations

from typing import Any

import httpx

from . import config
from .store_errors import MatchStoreUnavailable

_MIGRATION_HINT = (
    "Supabase match storage is not ready. Run backend/migrations/002_matches.sql "
    "in the Supabase SQL editor, then try again."
)


def _headers() -> dict[str, str]:
    if not config.supabase_configured():
        raise MatchStoreUnavailable("Supabase is not configured.")
    return {
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _rpc(name: str, payload: dict[str, Any]) -> Any:
    url = f"{config.SUPABASE_URL}/rest/v1/rpc/{name}"
    try:
        with httpx.Client(timeout=15) as client:
            response = client.post(url, headers=_headers(), json=payload)
    except httpx.HTTPError as exc:
        raise MatchStoreUnavailable("Supabase match storage is unavailable.") from exc

    if response.status_code == 404:
        raise MatchStoreUnavailable(_MIGRATION_HINT)
    if response.status_code >= 400:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        code = payload.get("code") if isinstance(payload, dict) else None
        message = payload.get("message") if isinstance(payload, dict) else None
        detail = f"Supabase RPC {name} failed (HTTP {response.status_code})"
        if code:
            detail += f", PostgREST code {code}"
        if message:
            detail += f": {message}"
        raise MatchStoreUnavailable(detail)
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise MatchStoreUnavailable("Supabase returned an invalid match response.") from exc


class SupabaseMatchStore:
    def record_match(self, summary: dict[str, Any]) -> Any:
        return _rpc("record_match", {"p_summary": summary})

    def match_history_for_uid(self, uid: str, limit: int = 20) -> list[dict[str, Any]]:
        rows = _rpc("match_history", {"p_uid": uid, "p_limit": limit})
        return rows if isinstance(rows, list) else []

    def player_stats_for_uid(self, uid: str, username: str) -> dict[str, Any]:
        stats = _rpc("player_stats", {"p_uid": uid, "p_username": username})
        return stats if isinstance(stats, dict) else {}

    def leaderboard(self, limit: int = 10) -> list[dict[str, Any]]:
        from .avatar_store import normalize_avatar

        rows = _rpc("leaderboard", {"p_limit": limit})
        if not isinstance(rows, list):
            return []
        result = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            avatar_url, _ = normalize_avatar(
                row.get("avatar_url"), row.get("character_id"), row.get("username")
            )
            result.append({**row, "avatar_url": avatar_url, "character_id": None})
        return result
