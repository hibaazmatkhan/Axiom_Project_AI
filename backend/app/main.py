"""AXIOM web + WebSocket server (WP3/WP5/WP7).

HTTP endpoints: accounts, profiles, match history, leaderboard, health.
WebSocket: real-time authoritative game loop.
"""
import json
import logging
import os
import re

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .game import Room
from . import db

TRANSITION_SECONDS = os.getenv("TRANSITION_SECONDS")
MIN_PLAYERS = int(os.getenv("MIN_PLAYERS", "1"))
ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app = FastAPI(title="AXIOM game server", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])

rooms: dict[str, Room] = {}


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------
class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=4, max_length=128)


@app.get("/health")
def health():
    return {"ok": True, "rooms": len(rooms), "players": sum(len(r.players) for r in rooms.values())}


@app.post("/api/signup")
def signup(creds: Credentials):
    ok = db.store.create_user(creds.username, creds.password)
    return {"ok": ok, "error": None if ok else "username taken or invalid"}


@app.post("/api/login")
def login(creds: Credentials):
    ok = db.store.verify_user(creds.username, creds.password)
    return {"ok": ok, "error": None if ok else "invalid credentials"}


@app.get("/api/profile/{username}")
def profile(username: str):
    return db.store.player_stats(username)


@app.get("/api/history/{username}")
def history(username: str, limit: int = 20):
    return {"matches": db.store.match_history(username, limit)}


@app.get("/api/leaderboard")
def leaderboard(limit: int = 10):
    return {"leaders": db.store.leaderboard(limit)}


@app.get("/api/stages")
def stages():
    from .stages import STAGES
    return {"stages": STAGES, "max": len(STAGES)}


@app.get("/api/nexus/tune")
def nexus_tune(team_skill: float = 0.8, cycles: int = 8):
    from .nexus import Nexus
    return Nexus.tune(team_skill, cycles)


# ---------------------------------------------------------------------------
# WebSocket game loop
# ---------------------------------------------------------------------------
@app.websocket("/ws/{room_id}")
async def game_socket(ws: WebSocket, room_id: str, name: str = "Player", pid: str = ""):
    await ws.accept()
    room_id = re.sub(r"[^A-Za-z0-9]", "", room_id).upper()[:8] or "LOBBY"
    room = rooms.get(room_id)
    if room is None:
        ts = float(TRANSITION_SECONDS) if TRANSITION_SECONDS else None
        room = rooms[room_id] = Room(room_id, transition_seconds=ts, min_players=MIN_PLAYERS)
    player = await room.join(ws, name, pid or None)
    if player is None:
        await ws.send_json({"type": "error", "code": "room_full", "message": "Room is full (4 players max)."})
        await ws.close(code=1008)
        return
    try:
        while True:
            try:
                msg = await ws.receive_json()
            except (json.JSONDecodeError, ValueError):
                continue
            if isinstance(msg, dict):
                try:
                    await room.handle(player, msg)
                except Exception as exc:  # never let one bad intent kill the match
                    logging.exception("intent failed: %s", exc)
                    await ws.send_json({"type": "error", "code": "internal",
                                        "message": "That action could not be processed."})
    except WebSocketDisconnect:
        pass
    finally:
        await room.leave(player)
        # only drop the room when nobody is around to reconnect
        if not any(p.connected for p in room.players.values()):
            rooms.pop(room_id, None)
