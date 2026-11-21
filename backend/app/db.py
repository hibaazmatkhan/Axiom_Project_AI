"""AXIOM match persistence store (WP7, task 42).

Supabase stores production match history, statistics and Dealer models. SQLite
remains available for local development and tests. Firebase owns identities and
only verified Firebase UIDs are written to ranked match data.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from typing import Iterator

from . import config

DB_PATH = os.getenv("AXIOM_DB", os.path.join(os.path.dirname(__file__), "..", "axiom.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    seed INTEGER,
    winner INTEGER DEFAULT 0,
    cycles INTEGER DEFAULT 0,
    rounds INTEGER DEFAULT 0,
    eliminated INTEGER DEFAULT 0,
    duration REAL DEFAULT 0,
    team_skill REAL DEFAULT 0,
    difficulty REAL DEFAULT 0,
    created_at REAL NOT NULL,
    summary TEXT
);
CREATE TABLE IF NOT EXISTS match_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    username TEXT,
    auth_uid TEXT,
    firebase_uid TEXT,
    slot INTEGER,
    escaped INTEGER DEFAULT 0,
    eliminated INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    revives INTEGER DEFAULT 0,
    predictions INTEGER DEFAULT 0,
    correct INTEGER DEFAULT 0,
    attributes TEXT,
    FOREIGN KEY(match_id) REFERENCES matches(id)
);
CREATE TABLE IF NOT EXISTS player_models (
    auth_uid TEXT PRIMARY KEY,
    firebase_uid TEXT,
    username TEXT NOT NULL,
    attributes TEXT NOT NULL,
    style TEXT,
    matches INTEGER DEFAULT 0,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS avatars (
    firebase_uid TEXT PRIMARY KEY,
    character_id TEXT,
    avatar_url TEXT,
    storage_path TEXT,
    content_type TEXT,
    width INTEGER,
    height INTEGER,
    bytes INTEGER,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    seed INTEGER,
    status TEXT DEFAULT 'lobby',
    stage INTEGER DEFAULT 1,
    round INTEGER DEFAULT 0,
    players INTEGER DEFAULT 0,
    summary TEXT DEFAULT '{}',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firebase_uid TEXT,
    kind TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    created_at REAL NOT NULL
);
"""


class Store:
    def __init__(self, path: str = DB_PATH):
        self.path = path
        self._init()

    @contextmanager
    def conn(self) -> Iterator[sqlite3.Connection]:
        c = sqlite3.connect(self.path, check_same_thread=False)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()

    def _init(self) -> None:
        with self.conn() as c:
            c.executescript(SCHEMA)
            # Forward-compatible migration for databases created before v2.
            match_cols = {r["name"] for r in c.execute("PRAGMA table_info(matches)")}
            for name, decl in (("rounds", "INTEGER DEFAULT 0"),
                               ("eliminated", "INTEGER DEFAULT 0")):
                if name not in match_cols:
                    c.execute(f"ALTER TABLE matches ADD COLUMN {name} {decl}")
            cols = {r["name"] for r in c.execute("PRAGMA table_info(match_players)")}
            for name, decl in (("eliminated", "INTEGER DEFAULT 0"),
                               ("points", "INTEGER DEFAULT 0"),
                               ("revives", "INTEGER DEFAULT 0"),
                               ("auth_uid", "TEXT")):
                if name not in cols:
                    c.execute(f"ALTER TABLE match_players ADD COLUMN {name} {decl}")
            model_info = {r["name"]: dict(r) for r in c.execute("PRAGMA table_info(player_models)")}
            if model_info and model_info.get("auth_uid", {}).get("pk") != 1:
                c.execute("ALTER TABLE player_models RENAME TO player_models_legacy")
                c.execute(
                    "CREATE TABLE player_models ("
                    " auth_uid TEXT PRIMARY KEY,"
                    " username TEXT NOT NULL,"
                    " attributes TEXT NOT NULL,"
                    " style TEXT,"
                    " matches INTEGER DEFAULT 0,"
                    " updated_at REAL NOT NULL)"
                )
                if "auth_uid" in model_info:
                    c.execute(
                        "INSERT OR IGNORE INTO player_models"
                        " (auth_uid, username, attributes, style, matches, updated_at)"
                        " SELECT auth_uid, username, attributes, style, matches, updated_at"
                        " FROM player_models_legacy WHERE auth_uid IS NOT NULL"
                    )
                c.execute("DROP TABLE player_models_legacy")
            model_cols = {r["name"] for r in c.execute("PRAGMA table_info(player_models)")}
            if "firebase_uid" not in model_cols:
                c.execute("ALTER TABLE player_models ADD COLUMN firebase_uid TEXT")
            if "firebase_uid" not in cols:
                c.execute("ALTER TABLE match_players ADD COLUMN firebase_uid TEXT")
            c.execute("CREATE INDEX IF NOT EXISTS idx_match_players_auth_uid"
                      " ON match_players(auth_uid)")

    # ---- matches ---------------------------------------------------------
    def record_match(self, summary: dict) -> int:
        with self.conn() as c:
            cur = c.execute(
                "INSERT INTO matches(room, seed, winner, cycles, rounds, eliminated, duration,"
                " team_skill, difficulty, created_at, summary)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (summary.get("room"), summary.get("seed"), int(summary.get("winner", 0)),
                 summary.get("cycles", 0), summary.get("rounds", 0),
                 summary.get("eliminated", 0), summary.get("duration", 0),
                 summary.get("team_skill", 0), summary.get("difficulty", 0), time.time(),
                 json.dumps(summary)))
            match_id = cur.lastrowid
            for p in summary.get("players", []):
                uid = p.get("uid") if p.get("verified") else None
                if not uid:
                    continue
                c.execute(
                    "INSERT INTO match_players(match_id, username, auth_uid, firebase_uid, slot, escaped, eliminated,"
                    " points, revives, predictions, correct, attributes)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (match_id, p.get("name"), uid, uid, p.get("slot"), int(p.get("escaped", 0)),
                     int(p.get("eliminated", 0)), int(p.get("points", 0)),
                     int(p.get("revives", 0)), p.get("predictions", 0), p.get("correct", 0),
                     json.dumps(p.get("attrs", {}))))
                if p.get("name"):
                    self._upsert_model(c, p["name"], p.get("attrs", {}), p.get("style", ""), uid)
            return match_id

    def _upsert_model(self, c, username: str, attrs: dict, style: str,
                      auth_uid: str | None = None) -> None:
        if not auth_uid:
            return
        row = c.execute(
            "SELECT matches FROM player_models WHERE auth_uid=?", (auth_uid,)
        ).fetchone()
        n = (row["matches"] if row else 0) + 1
        c.execute(
            "INSERT INTO player_models(auth_uid, firebase_uid, username, attributes, style, matches, updated_at)"
            " VALUES (?,?,?,?,?,?,?)"
            " ON CONFLICT(auth_uid) DO UPDATE SET username=excluded.username,"
            " firebase_uid=excluded.firebase_uid, attributes=excluded.attributes,"
            " style=excluded.style, matches=excluded.matches, updated_at=excluded.updated_at",
            (auth_uid, auth_uid, username, json.dumps(attrs), style, n, time.time()))

    def match_history(self, username: str | None = None, limit: int = 20) -> list[dict]:
        with self.conn() as c:
            if username:
                rows = c.execute(
                    "SELECT DISTINCT m.* FROM matches m JOIN match_players mp ON mp.match_id=m.id"
                    " WHERE mp.username=? ORDER BY m.created_at DESC LIMIT ?", (username, limit)).fetchall()
            else:
                rows = c.execute("SELECT * FROM matches ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def player_stats(self, username: str) -> dict:
        with self.conn() as c:
            agg = c.execute(
                "SELECT COUNT(*) n, COALESCE(SUM(escaped),0) wins, COALESCE(SUM(predictions),0) preds,"
                " COALESCE(SUM(correct),0) correct FROM match_players WHERE username=?", (username,)).fetchone()
            model = c.execute("SELECT * FROM player_models WHERE username=?", (username,)).fetchone()
        return {
            "username": username,
            "matches": agg["n"], "escapes": agg["wins"],
            "predictions": agg["preds"], "correct": agg["correct"],
            "accuracy": round(agg["correct"] / agg["preds"], 3) if agg["preds"] else 0.0,
            "attributes": json.loads(model["attributes"]) if model else {},
            "style": model["style"] if model else None,
        }

    def set_avatar(self, uid: str, character_id: str | None, avatar_url: str | None,
                   meta: dict | None = None) -> dict:
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
        with self.conn() as c:
            c.execute(
                "INSERT INTO avatars(firebase_uid, character_id, avatar_url, storage_path,"
                " content_type, width, height, bytes, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(firebase_uid) DO UPDATE SET character_id=excluded.character_id,"
                " avatar_url=excluded.avatar_url, storage_path=excluded.storage_path,"
                " content_type=excluded.content_type, width=excluded.width,"
                " height=excluded.height, bytes=excluded.bytes, updated_at=excluded.updated_at",
                (uid, character_id, avatar_url, row["storage_path"], row["content_type"],
                 row["width"], row["height"], row["bytes"], time.time(), time.time()))
        return row

    def get_avatar(self, uid: str) -> dict | None:
        with self.conn() as c:
            row = c.execute("SELECT * FROM avatars WHERE firebase_uid=?", (uid,)).fetchone()
        return dict(row) if row else None

    def clear_avatar(self, uid: str) -> None:
        with self.conn() as c:
            c.execute("DELETE FROM avatars WHERE firebase_uid=?", (uid,))

    def upsert_room(self, room_id: str, summary: dict) -> None:
        now = time.time()
        with self.conn() as c:
            c.execute(
                "INSERT INTO rooms(id, seed, status, stage, round, players, summary, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(id) DO UPDATE SET seed=excluded.seed, status=excluded.status,"
                " stage=excluded.stage, round=excluded.round, players=excluded.players,"
                " summary=excluded.summary, updated_at=excluded.updated_at",
                (room_id, summary.get("seed"), summary.get("status", "lobby"),
                 summary.get("stage", 1), summary.get("round", 0), summary.get("players", 0),
                 json.dumps(summary), now, now),
            )

    def delete_room(self, room_id: str) -> None:
        with self.conn() as c:
            c.execute("DELETE FROM rooms WHERE id=?", (room_id,))

    def log_audit(self, uid: str | None, kind: str, payload: dict) -> None:
        with self.conn() as c:
            c.execute(
                "INSERT INTO audit_logs(firebase_uid, kind, payload, created_at) VALUES (?,?,?,?)",
                (uid, kind, json.dumps(payload), time.time()),
            )

    def player_stats_for_uid(self, uid: str, username: str) -> dict:
        with self.conn() as c:
            agg = c.execute(
                "SELECT COUNT(*) n, COALESCE(SUM(escaped),0) wins, COALESCE(SUM(predictions),0) preds,"
                " COALESCE(SUM(correct),0) correct FROM match_players WHERE auth_uid=?",
                (uid,)).fetchone()
            model = c.execute("SELECT * FROM player_models WHERE auth_uid=?", (uid,)).fetchone()
        return {
            "username": username,
            "matches": agg["n"], "escapes": agg["wins"],
            "predictions": agg["preds"], "correct": agg["correct"],
            "accuracy": round(agg["correct"] / agg["preds"], 3) if agg["preds"] else 0.0,
            "attributes": json.loads(model["attributes"]) if model else {},
            "style": model["style"] if model else None,
        }

    def match_history_for_uid(self, uid: str, limit: int = 20) -> list[dict]:
        with self.conn() as c:
            rows = c.execute(
                "SELECT DISTINCT m.* FROM matches m JOIN match_players mp ON mp.match_id=m.id"
                " WHERE mp.auth_uid=? ORDER BY m.created_at DESC LIMIT ?", (uid, limit)).fetchall()
        return [dict(r) for r in rows]

    def export_user(self, uid: str) -> dict:
        model = None
        with self.conn() as c:
            row = c.execute("SELECT username FROM player_models WHERE auth_uid=?", (uid,)).fetchone()
            model = dict(row) if row else None
        username = model["username"] if model else ""
        return {
            "profile": None,
            "avatar": self.get_avatar(uid),
            "stats": self.player_stats_for_uid(uid, username),
            "history": self.match_history_for_uid(uid, 100),
        }

    def delete_user(self, uid: str) -> None:
        with self.conn() as c:
            ids = [row["match_id"] for row in c.execute(
                "SELECT DISTINCT match_id FROM match_players WHERE auth_uid=?", (uid,)
            ).fetchall()]
            for match_id in ids:
                row = c.execute("SELECT summary FROM matches WHERE id=?", (match_id,)).fetchone()
                if not row:
                    continue
                try:
                    summary = json.loads(row["summary"] or "{}")
                except (TypeError, ValueError):
                    summary = {}
                summary["players"] = [p for p in summary.get("players", []) if p.get("uid") != uid]
                c.execute("UPDATE matches SET summary=? WHERE id=?", (json.dumps(summary), match_id))
            c.execute("DELETE FROM match_players WHERE auth_uid=?", (uid,))
            c.execute("DELETE FROM player_models WHERE auth_uid=?", (uid,))
            c.execute("DELETE FROM avatars WHERE firebase_uid=?", (uid,))

    def leaderboard(self, limit: int = 10) -> list[dict]:
        with self.conn() as c:
            rows = c.execute(
                "SELECT m.username, m.matches, m.attributes, a.avatar_url, a.character_id"
                " FROM player_models m LEFT JOIN avatars a ON a.firebase_uid = m.auth_uid"
                " WHERE m.auth_uid IS NOT NULL ORDER BY m.matches DESC, m.username ASC LIMIT ?",
                (limit,)).fetchall()
        from .avatar_store import normalize_avatar

        out = []
        for r in rows:
            attrs = json.loads(r["attributes"] or "{}")
            avatar_url, _ = normalize_avatar(
                r["avatar_url"], r["character_id"], r["username"]
            )
            out.append({"username": r["username"], "matches": r["matches"],
                        "pattern": attrs.get("pattern", 0),
                        "avatar_url": avatar_url, "character_id": None})
        return out


def _selected_store() -> Store:
    if config.MATCH_STORE == "supabase":
        if not config.supabase_configured():
            raise RuntimeError(
                "AXIOM_MATCH_STORE=supabase requires SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY."
            )
        from .supabase_match_store import SupabaseMatchStore

        return SupabaseMatchStore()
    return Store()


store = _selected_store()
