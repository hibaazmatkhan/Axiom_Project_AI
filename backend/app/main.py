"""THE LAST ROOM web + WebSocket server (WP3/WP5/WP7).

HTTP endpoints: Firebase-authenticated profiles, match history, leaderboard,
health. WebSocket: real-time authoritative game loop with optional Firebase
first-frame authentication and guest play.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config  # loads backend/.env before the constants below
from . import db, supabase_store
from .auth import (
    AuthConfigurationError,
    AuthTokenError,
    AuthUser,
    get_current_user,
    get_verified_user,
    require_admin,
    verify_token,
)
from .game import Room
from .store_errors import MatchStoreUnavailable

ROUND_SECONDS = os.getenv("ROUND_SECONDS")
MIN_PLAYERS = int(os.getenv("MIN_PLAYERS", "1"))
ORIGINS = config.ALLOWED_ORIGINS

app = FastAPI(title="THE LAST ROOM game server", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

rooms: dict[str, Room] = {}


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------
class ProfileUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    display_name: str | None = Field(default=None, max_length=48)


class MfaUpdate(BaseModel):
    enabled: bool


def _user_public(user: AuthUser) -> dict:
    return {
        "uid": user.uid,
        "email": user.email,
        "email_verified": user.email_verified,
        "display_name": user.name,
        "photo_url": user.picture,
    }


def _ensure_profile(user: AuthUser) -> dict:
    try:
        return supabase_store.create_or_update_profile(user)
    except supabase_store.UsernameTaken as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except supabase_store.SupabaseUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Profile storage is temporarily unavailable.",
        ) from exc


def _stats_for(user: AuthUser, profile: dict) -> dict:
    try:
        return db.store.player_stats_for_uid(user.uid, profile["username"])
    except MatchStoreUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Match storage is temporarily unavailable.",
        ) from exc


def _history_for(user: AuthUser, profile: dict, limit: int) -> list[dict]:
    try:
        return db.store.match_history_for_uid(user.uid, limit)
    except MatchStoreUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Match storage is temporarily unavailable.",
        ) from exc


@app.get("/health")
def health():
    return {"ok": True, "rooms": len(rooms), "players": sum(len(r.players) for r in rooms.values())}


@app.get("/api/me")
def me(user: AuthUser = Depends(get_current_user)):
    profile = _ensure_profile(user)
    return {
        "user": _user_public(user),
        "profile": supabase_store.profile_public(profile),
        "stats": _stats_for(user, profile),
    }


@app.put("/api/me/profile")
def update_profile(payload: ProfileUpdate, user: AuthUser = Depends(get_current_user)):
    try:
        profile = supabase_store.create_or_update_profile(
            user, requested_username=payload.username, display_name=payload.display_name
        )
    except supabase_store.UsernameTaken as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except supabase_store.SupabaseUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Profile storage is temporarily unavailable.",
        ) from exc
    return {
        "profile": supabase_store.profile_public(profile),
        "stats": _stats_for(user, profile),
    }


@app.post("/api/me/mfa")
def update_mfa(payload: MfaUpdate, user: AuthUser = Depends(get_current_user)):
    try:
        profile = supabase_store.set_mfa_enabled(user.uid, payload.enabled)
    except supabase_store.SupabaseUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Profile storage is temporarily unavailable.",
        ) from exc
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    return {"profile": supabase_store.profile_public(profile)}


@app.get("/api/me/history")
def my_history(limit: int = 20, user: AuthUser = Depends(get_verified_user)):
    profile = _ensure_profile(user)
    return {
        "matches": _history_for(user, profile, min(max(limit, 1), 100)),
        "username": profile["username"],
    }


@app.get("/api/leaderboard")
def leaderboard(limit: int = 10):
    try:
        leaders = db.store.leaderboard(min(max(limit, 1), 100))
    except MatchStoreUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Match storage is temporarily unavailable.",
        ) from exc
    return {"leaders": leaders}


@app.get("/api/admin/rooms")
def admin_rooms(_: AuthUser = Depends(require_admin)):
    """Read-only room inventory for authenticated administrators."""
    return {
        "rooms": [
            {
                "id": rid,
                "status": r.status,
                "round": r.round,
                "stage": r.stage,
                "players": len(r.players),
                "connected": sum(1 for p in r.players.values() if p.connected),
                "spectators": len(r.spectators),
                "seed": r.seed,
            }
            for rid, r in rooms.items()
        ]
    }


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
@dataclass
class WsIdentity:
    uid: str | None
    name: str
    pid: str | None
    verified: bool


async def _ws_identity(ws: WebSocket, name: str, pid: str, auth_frame_required: bool) -> WsIdentity | None:
    if not auth_frame_required:
        return WsIdentity(uid=None, name=name, pid=pid or None, verified=False)

    try:
        frame = await asyncio.wait_for(ws.receive_json(), timeout=8.0)
    except asyncio.TimeoutError:
        await ws.send_json({"type": "error", "code": "auth_timeout",
                            "message": "Authentication timed out."})
        await ws.close(code=1008)
        return None
    except (json.JSONDecodeError, ValueError):
        await ws.send_json({"type": "error", "code": "auth_invalid",
                            "message": "Authentication frame was not valid JSON."})
        await ws.close(code=1008)
        return None

    if not isinstance(frame, dict) or frame.get("type") != "auth":
        await ws.send_json({"type": "error", "code": "auth_required",
                            "message": "An auth frame is required for this connection."})
        await ws.close(code=1008)
        return None

    frame_name = str(frame.get("name") or name or "Player")
    frame_pid = str(frame.get("pid") or pid or "")
    token = frame.get("token")
    if not token:
        return WsIdentity(uid=None, name=frame_name, pid=frame_pid or None, verified=False)

    try:
        user = await asyncio.to_thread(verify_token, str(token))
    except AuthConfigurationError:
        await ws.send_json({"type": "error", "code": "auth_unavailable",
                            "message": "Authentication is not configured."})
        await ws.close(code=1013)
        return None
    except AuthTokenError as exc:
        await ws.send_json({"type": "error", "code": "auth_invalid", "message": str(exc)})
        await ws.close(code=1008)
        return None

    profile = None
    try:
        profile = await asyncio.to_thread(supabase_store.create_or_update_profile, user)
    except supabase_store.SupabaseUnavailable:
        logging.warning("profile lookup failed during websocket authentication")

    display_name = (
        (profile or {}).get("display_name")
        or user.name
        or (user.email or "").split("@")[0]
        or "Player"
    )
    return WsIdentity(
        uid=user.uid,
        name=display_name,
        pid=frame_pid or None,
        verified=bool(profile and user.email_verified),
    )


@app.websocket("/ws/{room_id}")
async def game_socket(ws: WebSocket, room_id: str, name: str = "Player", pid: str = "",
                      spectator: int = 0, auth: int = 0):
    await ws.accept()
    room_id = re.sub(r"[^A-Za-z0-9]", "", room_id).upper()[:8] or "LOBBY"
    room = rooms.get(room_id)
    if room is None:
        ts = float(ROUND_SECONDS) if ROUND_SECONDS else None
        room = rooms[room_id] = Room(room_id, round_seconds=ts, min_players=MIN_PLAYERS)
    if spectator:
        await room.watch(ws)
        try:
            while True:
                try:
                    msg = await ws.receive_json()
                except (json.JSONDecodeError, ValueError):
                    continue
                if isinstance(msg, dict) and msg.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
        except WebSocketDisconnect:
            pass
        finally:
            await room.unwatch(ws)
            if not any(p.connected for p in room.players.values()) and not room.spectators:
                rooms.pop(room_id, None)
        return

    identity = await _ws_identity(ws, name, pid, bool(auth))
    if identity is None:
        return
    player = await room.join(ws, identity.name, identity.pid,
                             uid=identity.uid, verified=identity.verified)
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
        if not any(p.connected for p in room.players.values()) and not room.spectators:
            rooms.pop(room_id, None)
