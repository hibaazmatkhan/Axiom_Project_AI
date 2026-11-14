"""AXIOM persistence layer (WP7, task 42).

SQLite-backed store for users, matches, statistics and NEXUS player-model data.
The proposal specifies PostgreSQL; SQLite keeps the project runnable anywhere
while exposing the same schema and repository interface. Swap DB_URL and the
`sqlite3` calls for `psycopg` to move to Postgres.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from typing import Iterator

DB_PATH = os.getenv("AXIOM_DB", os.path.join(os.path.dirname(__file__), "..", "axiom.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    pw_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at REAL NOT NULL
);
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
    username TEXT PRIMARY KEY,
    attributes TEXT NOT NULL,
    style TEXT,
    matches INTEGER DEFAULT 0,
    updated_at REAL NOT NULL
);
"""


def _hash_pw(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()


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
                               ("revives", "INTEGER DEFAULT 0")):
                if name not in cols:
                    c.execute(f"ALTER TABLE match_players ADD COLUMN {name} {decl}")

    # ---- accounts --------------------------------------------------------
    def create_user(self, username: str, password: str) -> bool:
        username = username.strip()
        if not (3 <= len(username) <= 24) or len(password) < 4:
            return False
        salt = secrets.token_hex(16)
        try:
            with self.conn() as c:
                c.execute("INSERT INTO users(username, pw_hash, salt, created_at) VALUES (?,?,?,?)",
                          (username, _hash_pw(password, salt), salt, time.time()))
            return True
        except sqlite3.IntegrityError:
            return False

    def verify_user(self, username: str, password: str) -> bool:
        with self.conn() as c:
            row = c.execute("SELECT pw_hash, salt FROM users WHERE username=?", (username,)).fetchone()
        if not row:
            return False
        return _hash_pw(password, row["salt"]) == row["pw_hash"]

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
                c.execute(
                    "INSERT INTO match_players(match_id, username, slot, escaped, eliminated,"
                    " points, revives, predictions, correct, attributes)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (match_id, p.get("name"), p.get("slot"), int(p.get("escaped", 0)),
                     int(p.get("eliminated", 0)), int(p.get("points", 0)),
                     int(p.get("revives", 0)), p.get("predictions", 0), p.get("correct", 0),
                     json.dumps(p.get("attrs", {}))))
                if p.get("name"):
                    self._upsert_model(c, p["name"], p.get("attrs", {}), p.get("style", ""))
            return match_id

    def _upsert_model(self, c, username: str, attrs: dict, style: str) -> None:
        row = c.execute("SELECT matches FROM player_models WHERE username=?", (username,)).fetchone()
        n = (row["matches"] if row else 0) + 1
        c.execute(
            "INSERT INTO player_models(username, attributes, style, matches, updated_at) VALUES (?,?,?,?,?)"
            " ON CONFLICT(username) DO UPDATE SET attributes=excluded.attributes, style=excluded.style,"
            " matches=excluded.matches, updated_at=excluded.updated_at",
            (username, json.dumps(attrs), style, n, time.time()))

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

    def leaderboard(self, limit: int = 10) -> list[dict]:
        with self.conn() as c:
            rows = c.execute(
                "SELECT username, matches, attributes FROM player_models ORDER BY matches DESC LIMIT ?",
                (limit,)).fetchall()
        out = []
        for r in rows:
            attrs = json.loads(r["attributes"] or "{}")
            out.append({"username": r["username"], "matches": r["matches"],
                        "pattern": attrs.get("pattern", 0)})
        return out


store = Store()
