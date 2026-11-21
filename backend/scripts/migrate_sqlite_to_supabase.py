import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app import config, supabase_store

DEFAULT_DB = Path(__file__).resolve().parents[1] / "axiom.db"


def iso(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc).isoformat()
    return value


def load_rows(path: Path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        tables = {
            row["name"]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        result = {}
        for table in ("matches", "match_players", "player_models", "avatars"):
            result[table] = [dict(row) for row in conn.execute(f"SELECT * FROM {table}")] if table in tables else []
        return result
    finally:
        conn.close()


def upsert(table: str, rows: list[dict], conflict: str, mapping):
    payload = [mapping(row) for row in rows]
    if not payload:
        return 0
    for start in range(0, len(payload), 200):
        supabase_store._request(
            "POST",
            table,
            query=f"on_conflict={conflict}",
            json=payload[start:start + 200],
            prefer="resolution=merge-duplicates,return=minimal",
        )
    return len(payload)


def main():
    parser = argparse.ArgumentParser(description="Migrate AXIOM SQLite data into Supabase.")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Path to the SQLite source database.")
    parser.add_argument("--dry-run", action="store_true", help="Print counts without writing.")
    args = parser.parse_args()

    rows = load_rows(Path(args.db))
    counts = {name: len(items) for name, items in rows.items()}
    print(json.dumps({"mode": "dry-run" if args.dry_run else "apply", "counts": counts}, indent=2))
    if args.dry_run:
        return
    if not config.supabase_configured():
        raise SystemExit("Supabase is not configured; set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")

    def match(row):
        summary = json.loads(row.get("summary") or "{}")
        return {
            "id": row["id"],
            "room": row["room"],
            "seed": row.get("seed"),
            "winner": row.get("winner") or 0,
            "cycles": row.get("cycles") or 0,
            "rounds": summary.get("rounds", 0),
            "duration": row.get("duration") or 0,
            "team_skill": row.get("team_skill") or 0,
            "difficulty": row.get("difficulty") or 0,
            "eliminated": summary.get("eliminated", 0),
            "created_at": iso(row.get("created_at")),
            "summary": summary,
        }

    def match_player(row):
        return {
            "id": row["id"],
            "match_id": row["match_id"],
            "auth_uid": row.get("auth_uid"),
            "firebase_uid": row.get("firebase_uid") or row.get("auth_uid"),
            "username": row.get("username"),
            "slot": row.get("slot"),
            "escaped": bool(row.get("escaped")),
            "eliminated": bool(row.get("eliminated")),
            "points": row.get("points") or 0,
            "revives": row.get("revives") or 0,
            "predictions": row.get("predictions") or 0,
            "correct": row.get("correct") or 0,
            "attributes": json.loads(row.get("attributes") or "{}"),
        }

    def model(row):
        return {
            "auth_uid": row["auth_uid"],
            "firebase_uid": row.get("firebase_uid") or row["auth_uid"],
            "username": row["username"],
            "attributes": json.loads(row.get("attributes") or "{}"),
            "style": row.get("style"),
            "matches": row.get("matches") or 0,
            "updated_at": iso(row.get("updated_at")),
        }

    def avatar(row):
        return {
            "firebase_uid": row["firebase_uid"],
            "character_id": row.get("character_id"),
            "avatar_url": row.get("avatar_url"),
            "storage_path": row.get("storage_path"),
            "content_type": row.get("content_type"),
            "width": row.get("width"),
            "height": row.get("height"),
            "bytes": row.get("bytes"),
            "created_at": iso(row.get("created_at")),
            "updated_at": iso(row.get("updated_at")),
        }

    written = {
        "matches": upsert("matches", rows["matches"], "id", match),
        "match_players": upsert("match_players", rows["match_players"], "id", match_player),
        "player_models": upsert("player_models", rows["player_models"], "auth_uid", model),
        "avatars": upsert("avatars", rows["avatars"], "firebase_uid", avatar),
    }
    print(json.dumps({"written": written}, indent=2))


if __name__ == "__main__":
    main()
