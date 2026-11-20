from __future__ import annotations

from typing import Any, Callable
from urllib.parse import quote

ProfilePatcher = Callable[[str, dict[str, Any]], Any]
UsernameChecker = Callable[[str, str | None], bool]


def make_supabase_patch_profile(store: Any) -> ProfilePatcher:
    def patch_profile(uid: str, patch: dict[str, Any]) -> Any:
        rows = store._request(
            "PATCH",
            "profiles",
            query=f"id=eq.{quote(uid, safe='')}",
            json=patch,
            prefer="return=representation",
        )
        return rows[0] if rows else None

    return patch_profile


def make_supabase_username_taken(store: Any) -> UsernameChecker:
    def username_taken(username: str, uid: str | None = None) -> bool:
        row = store.get_profile_by_username(username)
        return bool(row and row.get("id") != uid)

    return username_taken
