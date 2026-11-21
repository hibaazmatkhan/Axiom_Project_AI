import logging
from typing import Any

from . import config, db, supabase_store


def _write(table: str, row: dict[str, Any], conflict: str) -> None:
    if not config.supabase_configured():
        return
    supabase_store._request(
        "POST",
        table,
        query=f"on_conflict={conflict}" if conflict else "",
        json=row,
        prefer=(
            "resolution=merge-duplicates,return=minimal"
            if conflict else "return=minimal"
        ),
    )


def log(uid: str | None, kind: str, payload: dict[str, Any] | None = None) -> None:
    details = payload or {}
    try:
        if config.supabase_configured():
            _write("audit_logs", {"firebase_uid": uid, "kind": kind, "payload": details}, "")
        else:
            db.store.log_audit(uid, kind, details)
    except Exception:
        logging.warning("audit log write failed for %s", kind)


def room_upsert(room_id: str, room: Any) -> None:
    summary = {
        "id": room_id,
        "seed": room.seed,
        "status": room.status,
        "stage": room.stage,
        "round": room.round,
        "players": len(room.players),
    }
    try:
        if config.supabase_configured():
            _write("rooms", summary, "id")
        else:
            db.store.upsert_room(room_id, summary)
    except Exception:
        logging.warning("room state write failed for %s", room_id)


def room_delete(room_id: str) -> None:
    try:
        if config.supabase_configured():
            supabase_store._request("DELETE", "rooms", query=f"id=eq.{room_id}")
        else:
            db.store.delete_room(room_id)
    except Exception:
        logging.warning("room delete failed for %s", room_id)
