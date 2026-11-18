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
    username TEXT NOT NULL,
    attributes TEXT NOT NULL,
    style TEXT,
    matches INTEGER DEFAULT 0,
    updated_at REAL NOT NULL
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
            c.execute("CREATE INDEX IF NOT EXISTS idx_match_players_auth_uid"
                      " ON match_players(auth_uid)")

    # ---- matches ---------------------------------------------------------
    def record_match(self, summary: dict) -> int:
        with self.conn() as c:
            cur = c.execute(
                "INSERT INTO matches(room, seed, winner, cycles, duration, team_skill, difficulty, created_at, summary)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (summary.get("room"), summary.get("seed"), int(summary.get("winner", 0)),
                 summary.get("cycles", 0), summary.get("duration", 0),
                 summary.get("team_skill", 0), summary.get("difficulty", 0), time.time(),
                 json.dumps(summary)))
            match_id = cur.lastrowid
            for p in summary.get("players", []):
                uid = p.get("uid") if p.get("verified") else None
                if not uid:
                    continue
                c.execute(
                    "INSERT INTO match_players(match_id, username, auth_uid, slot, escaped, eliminated,"
                    " points, revives, predictions, correct, attributes)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (match_id, p.get("name"), uid, p.get("slot"), int(p.get("escaped", 0)),
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
            "INSERT INTO player_models(auth_uid, username, attributes, style, matches, updated_at)"
            " VALUES (?,?,?,?,?,?)"
            " ON CONFLICT(auth_uid) DO UPDATE SET username=excluded.username,"
            " attributes=excluded.attributes, style=excluded.style,"
            " matches=excluded.matches, updated_at=excluded.updated_at",
            (auth_uid, username, json.dumps(attrs), style, n, time.time()))

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

    def leaderboard(self, limit: int = 10) -> list[dict]:
        with self.conn() as c:
            rows = c.execute(
                "SELECT username, matches, attributes FROM player_models"
                " WHERE auth_uid IS NOT NULL ORDER BY matches DESC LIMIT ?",
                (limit,)).fetchall()
        out = []
        for r in rows:
            attrs = json.loads(r["attributes"] or "{}")
            out.append({"username": r["username"], "matches": r["matches"],
                        "pattern": attrs.get("pattern", 0)})
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
