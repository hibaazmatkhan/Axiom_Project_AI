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
import time
from dataclasses import dataclass

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config  # loads backend/.env before the constants below
from . import audit, auth, avatar_store, db, supabase_store
from .avatar_store import is_pfp_preset, pfp_url
from .auth import (
    AppCheckTokenError,
    AuthConfigurationError,
    AuthTokenError,
    AuthUser,
    get_current_user,
    get_verified_user,
    is_admin,
    require_admin,
    verify_app_check,
    verify_token,
)
from .game import MAX_PLAYERS, GameAlreadyStarted, Room
from .room_registry import RoomRegistry, canonicalize_room_code
from .shared_rooms import REDIS_AVAILABLE, RedisRoomGateway, RedisRoomRegistry
from .store_errors import MatchStoreUnavailable

logger = logging.getLogger(__name__)
APP_STARTED_AT = time.time()
INSTANCE_ID = os.getenv("INSTANCE_ID") or f"pid-{os.getpid()}-{int(APP_STARTED_AT)}"
ROUND_SECONDS = os.getenv("ROUND_SECONDS")
MATCH_SECONDS = os.getenv("MATCH_SECONDS")
MIN_PLAYERS = int(os.getenv("MIN_PLAYERS", "1"))
ORIGINS = config.ALLOWED_ORIGINS


class BackendPrefixMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path", "").startswith("/backend/"):
            scope = dict(scope)
            scope["path"] = scope["path"][len("/backend"):] or "/"
            raw_path = scope.get("raw_path")
            if raw_path:
                scope["raw_path"] = raw_path[len("/backend"):] or b"/"
        await self.app(scope, receive, send)


app = FastAPI(title="THE LAST ROOM game server", version="1.0.0")
app.add_middleware(BackendPrefixMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

rooms: dict[str, Room] = {}
REDIS_URL = config.REDIS_URL
if REDIS_URL and REDIS_AVAILABLE:
    registry = RedisRoomRegistry(REDIS_URL)
elif REDIS_URL:
    logger.error("REDIS_URL is set but the redis package is unavailable; using process-local rooms")
    registry = RoomRegistry()
else:
    registry = RoomRegistry()
gateway = RedisRoomGateway(INSTANCE_ID, REDIS_URL if REDIS_AVAILABLE else "", rooms, registry)
room_creation_lock = asyncio.Lock()

_app_check_problem = auth.app_check_config_error()
if _app_check_problem:
    logger.error("App Check startup configuration: %s", _app_check_problem)


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------
class ProfileUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    display_name: str | None = Field(default=None, max_length=48)


class MfaUpdate(BaseModel):
    enabled: bool


class AvatarPresetSelect(BaseModel):
    preset_id: str = Field(min_length=1, max_length=32)


class RoomCreate(BaseModel):
    min_players: int | None = Field(default=None, ge=1, le=MAX_PLAYERS)


class QuickMatchRequest(BaseModel):
    client_key: str = Field(min_length=1, max_length=128)


def _user_public(user: AuthUser, profile: dict | None = None) -> dict:
    return {
        "uid": user.uid,
        "email": user.email,
        "email_verified": user.email_verified,
        "display_name": user.name,
        "photo_url": user.picture,
        "mfa_enabled": auth.mfa_enabled_from_profile(profile, user.mfa_enabled),
    }


def _ensure_profile(user: AuthUser) -> dict:
    try:
        return supabase_store.create_or_update_profile(user)
    except supabase_store.InvalidUsername as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
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
    return {
        "ok": True,
        "status": "healthy",
        "instance_id": INSTANCE_ID,
        "uptime_s": round(time.time() - APP_STARTED_AT, 1),
        "rooms": len(rooms),
        "players": sum(len(r.players) for r in rooms.values()),
    }


@app.get("/api/me")
def me(user: AuthUser = Depends(get_current_user)):
    profile = _ensure_profile(user)
    return {
        "user": _user_public(user, profile),
        "profile": supabase_store.profile_public(profile, user),
        "stats": _stats_for(user, profile),
    }


@app.put("/api/me/profile")
def update_profile(payload: ProfileUpdate, user: AuthUser = Depends(get_current_user)):
    try:
        profile = supabase_store.create_or_update_profile(
            user, requested_username=payload.username, display_name=payload.display_name
        )
    except supabase_store.InvalidUsername as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except supabase_store.UsernameTaken as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except supabase_store.SupabaseUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Profile storage is temporarily unavailable.",
        ) from exc
    return {
        "profile": supabase_store.profile_public(profile, user),
        "stats": _stats_for(user, profile),
    }


@app.put("/api/me/avatar/preset")
def select_pfp_preset(payload: AvatarPresetSelect, user: AuthUser = Depends(get_current_user)):
    if not is_pfp_preset(payload.preset_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown PFP preset.")
    old_path = avatar_store.storage_path_for(user.uid)
    url = pfp_url(payload.preset_id)
    try:
        avatar_store.persist(user.uid, None, url)
        avatar_store.delete_storage(old_path)
    except avatar_store.AvatarUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    audit.log(user.uid, "avatar_preset_select", {"preset_id": payload.preset_id})
    return {"profile": supabase_store.profile_public(_ensure_profile(user), user)}


@app.post("/api/me/avatar/upload")
async def upload_avatar(file: UploadFile = File(...), user: AuthUser = Depends(get_current_user)):
    old_path = avatar_store.storage_path_for(user.uid)
    try:
        data = await file.read(avatar_store.MAX_UPLOAD_BYTES + 1)
        if len(data) > avatar_store.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Avatar images must be 5 MB or smaller.",
            )
        meta = avatar_store.validate_upload(data, file.content_type or "")
        path, url = avatar_store.upload(user.uid, meta["data"], meta["content_type"])
        meta["storage_path"] = path
        avatar_store.persist(user.uid, None, url, meta)
        if old_path != path:
            avatar_store.delete_storage(old_path)
    except avatar_store.AvatarInvalid as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except avatar_store.AvatarUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    audit.log(user.uid, "avatar_upload", {"bytes": meta["bytes"], "content_type": meta["content_type"]})
    return {"profile": supabase_store.profile_public(_ensure_profile(user), user)}


@app.delete("/api/me/avatar")
def delete_avatar(user: AuthUser = Depends(get_current_user)):
    old_path = avatar_store.storage_path_for(user.uid)
    try:
        avatar_store.clear(user.uid)
        avatar_store.delete_storage(old_path)
    except avatar_store.AvatarUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    audit.log(user.uid, "avatar_clear", {})
    return {"profile": supabase_store.profile_public(_ensure_profile(user), user)}


@app.get("/api/me/export")
def export_me(user: AuthUser = Depends(get_current_user)):
    audit.log(user.uid, "data_export", {})
    if config.supabase_configured():
        return supabase_store.export_user(user.uid)
    return db.store.export_user(user.uid)


@app.delete("/api/me")
def delete_me(user: AuthUser = Depends(get_current_user)):
    avatar_store.clear_uploaded_storage(user.uid)
    if config.supabase_configured():
        supabase_store.delete_user(user.uid)
    else:
        db.store.delete_user(user.uid)
    audit.log(user.uid, "data_delete", {})
    return {"ok": True}


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


@app.post("/api/admin/revoke/{uid}")
def revoke_sessions(uid: str, _: AuthUser = Depends(require_admin)):
    from firebase_admin import auth as firebase_auth

    try:
        firebase_auth.revoke_refresh_tokens(uid)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not revoke sessions.") from exc
    audit.log(_.uid, "session_revoke", {"target_uid": uid})
    return {"ok": True, "uid": uid}


def _normalize_code(code: str) -> str:
    return canonicalize_room_code(code)


async def _room_response(code: str) -> dict:
    room = rooms.get(code)
    if room is not None:
        connected = sum(1 for p in room.players.values() if p.connected)
        return {
            "room_id": room.id,
            "code": code,
            "status": room.status,
            "players": len(room.players),
            "connected": connected,
            "full": len(room.players) >= MAX_PLAYERS,
            "started": room.status != "lobby",
            "joinable": room.status == "lobby" and len(room.players) < MAX_PLAYERS,
            "instance_id": INSTANCE_ID,
        }
    if gateway.enabled:
        meta = await gateway.get_meta(code)
        if meta is not None:
            return {
                "room_id": meta.get("room_id") or code,
                "code": code,
                "status": meta.get("status") or "lobby",
                "players": int(meta.get("players") or 0),
                "connected": int(meta.get("connected") or 0),
                "full": bool(meta.get("full")),
                "started": bool(meta.get("started")),
                "joinable": bool(meta.get("joinable")),
                "instance_id": meta.get("instance_id") or INSTANCE_ID,
            }
        if await gateway.owner_exists(code):
            return {
                "room_id": code,
                "code": code,
                "status": "lobby",
                "players": 0,
                "connected": 0,
                "full": False,
                "started": False,
                "joinable": True,
                "instance_id": INSTANCE_ID,
            }
    if registry.expired_reservation(code):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Room code expired.")
    reservation = registry.get_reservation(code)
    if reservation is not None:
        return {
            "room_id": reservation.room_id,
            "code": code,
            "status": "lobby",
            "players": 0,
            "connected": 0,
            "full": False,
            "started": False,
            "joinable": True,
            "instance_id": INSTANCE_ID,
        }
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")


@app.post("/api/rooms")
async def create_room(payload: RoomCreate | None = None):
    min_players = (payload.min_players if payload else None) or MIN_PLAYERS
    async with room_creation_lock:
        reservation = registry.reserve(min_players, existing_codes=rooms.keys())
        if gateway.enabled:
            try:
                ts = float(ROUND_SECONDS) if ROUND_SECONDS else None
                ms = float(MATCH_SECONDS) if MATCH_SECONDS else None
                await gateway.create_room(reservation.code, min_players, ts, ms)
                registry.consume(reservation.code)
            except Exception:
                registry.restore(reservation)
                raise
    audit.log(None, "room_create", {"room_id": reservation.room_id, "code": reservation.code,
                                    "instance_id": INSTANCE_ID})
    logger.info("room_create instance=%s code=%s room_id=%s",
                INSTANCE_ID, reservation.code, reservation.room_id)
    return {"room_id": reservation.room_id, "code": reservation.code,
            "instance_id": INSTANCE_ID}


@app.post("/api/rooms/quick-match")
async def quick_match(payload: QuickMatchRequest):
    try:
        async with room_creation_lock:
            result = registry.queue(payload.client_key, MIN_PLAYERS, existing_codes=rooms.keys())
            if gateway.enabled and result.get("status") == "matched":
                reservation = registry.get_reservation(result["code"])
                if reservation is not None:
                    try:
                        ts = float(ROUND_SECONDS) if ROUND_SECONDS else None
                        ms = float(MATCH_SECONDS) if MATCH_SECONDS else None
                        await gateway.create_room(
                            result["code"], reservation.min_players, ts, ms
                        )
                        registry.consume(result["code"])
                    except Exception:
                        registry.restore(reservation)
                        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if result.get("status") == "matched":
        audit.log(None, "room_quick_match", {"code": result["code"], "instance_id": INSTANCE_ID})
        logger.info("quick_match instance=%s code=%s", INSTANCE_ID, result["code"])
        return {**result, "instance_id": INSTANCE_ID}
    return result


@app.get("/api/rooms/quick-match/{client_key}")
def quick_match_status(client_key: str):
    result = registry.queue_status(client_key)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Quick-match client not found."
        )
    return result


@app.get("/api/rooms/{code}")
async def room_status(code: str):
    normalized = _normalize_code(code)
    logger.info("room_status instance=%s code=%s normalized=%s", INSTANCE_ID, code, normalized)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
    return await _room_response(normalized)


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
    avatar_url: str | None = None
    character_id: str | None = None


async def _read_auth_frame(ws: WebSocket) -> dict | None:
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
    return frame


async def _enforce_frame_app_check(ws: WebSocket, frame: dict) -> bool:
    if not config.APP_CHECK_ENFORCE:
        return True
    try:
        await asyncio.to_thread(
            verify_app_check,
            frame.get("app_check") or frame.get("appCheck"),
        )
    except (AppCheckTokenError, AuthConfigurationError) as exc:
        code = "app_check_invalid" if isinstance(exc, AppCheckTokenError) else "app_check_unavailable"
        await ws.send_json({"type": "error", "code": code, "message": str(exc)})
        await ws.close(code=1008 if code == "app_check_invalid" else 1013)
        return False
    return True


async def _verify_frame_token(ws: WebSocket, token: object) -> AuthUser | None:
    try:
        return await asyncio.to_thread(verify_token, str(token))
    except AuthConfigurationError:
        await ws.send_json({"type": "error", "code": "auth_unavailable",
                            "message": "Authentication is not configured."})
        await ws.close(code=1013)
        return None
    except AuthTokenError as exc:
        await ws.send_json({"type": "error", "code": "auth_invalid", "message": str(exc)})
        await ws.close(code=1008)
        return None


async def _ws_profile_error(ws: WebSocket, code: str, message: str, close_code: int) -> None:
    await ws.send_json({"type": "error", "code": code, "message": message})
    await ws.close(code=close_code)


async def _ws_room_error(ws: WebSocket, code: str, message: str,
                         close_code: int = 1008) -> None:
    await ws.send_json({
        "type": "error", "code": code, "message": message,
        "instance_id": INSTANCE_ID,
    })
    await ws.close(code=close_code)


async def _ws_identity(ws: WebSocket, name: str, pid: str, auth_frame_required: bool) -> WsIdentity | None:
    if not auth_frame_required:
        return WsIdentity(uid=None, name=name, pid=pid or None, verified=False)

    frame = await _read_auth_frame(ws)
    if frame is None:
        return None

    frame_name = str(frame.get("name") or name or "Player")
    frame_pid = str(frame.get("pid") or pid or "")
    token = frame.get("token")
    if token and not await _enforce_frame_app_check(ws, frame):
        return None
    if not token:
        guest_payload = {
            "avatar": frame.get("avatar"),
            "pfp_preset_id": frame.get("pfp_preset_id"),
        }
        avatar_url, _ = avatar_store.guest_avatar(guest_payload, frame_pid or frame_name)
        return WsIdentity(
            uid=None, name=frame_name, pid=frame_pid or None, verified=False,
            avatar_url=avatar_url, character_id=None,
        )

    user = await _verify_frame_token(ws, token)
    if user is None:
        return None

    try:
        profile = await asyncio.to_thread(supabase_store.create_or_update_profile, user)
    except supabase_store.InvalidUsername as exc:
        await _ws_profile_error(ws, "invalid_username", str(exc), 1008)
        return None
    except supabase_store.UsernameTaken as exc:
        await _ws_profile_error(ws, "username_taken", str(exc), 1008)
        return None
    except supabase_store.SupabaseUnavailable as exc:
        logger.warning("profile lookup failed during websocket authentication: %s", exc)
        await _ws_profile_error(
            ws, "profile_unavailable", "Profile storage is temporarily unavailable.", 1013,
        )
        return None

    display_name = (
        (profile or {}).get("display_name")
        or user.name
        or (user.email or "").split("@")[0]
        or "Player"
    )
    avatar_url, _ = avatar_store.normalize_avatar(
        (profile or {}).get("avatar_url"),
        (profile or {}).get("character_id"),
        user.uid,
    )
    return WsIdentity(
        uid=user.uid,
        name=display_name,
        pid=frame_pid or None,
        verified=user.email_verified,
        avatar_url=avatar_url,
        character_id=None,
    )


async def _ws_admin_identity(ws: WebSocket) -> AuthUser | None:
    frame = await _read_auth_frame(ws)
    if frame is None or not await _enforce_frame_app_check(ws, frame):
        return None
    token = frame.get("token")
    if not token:
        await ws.send_json({
            "type": "error", "code": "auth_required",
            "message": "A Firebase token is required for spectator access.",
        })
        await ws.close(code=1008)
        return None
    user = await _verify_frame_token(ws, token)
    if user is None:
        return None
    if not is_admin(user):
        await ws.send_json({
            "type": "error", "code": "admin_required",
            "message": "Administrator access is required.",
        })
        await ws.close(code=1008)
        return None
    return user


async def _spectator_socket(ws: WebSocket, room_id: str) -> None:
    user = await _ws_admin_identity(ws)
    if user is None:
        return
    if gateway.enabled:
        audit.log(user.uid, "spectator_connect", {"room_id": room_id})
        try:
            await gateway.spectator_socket(ws, room_id, user)
        finally:
            audit.log(user.uid, "spectator_disconnect", {"room_id": room_id})
        return
    room = rooms.get(room_id)
    if room is None:
        await ws.send_json({
            "type": "error", "code": "room_not_found",
            "message": "Room not found.",
        })
        await ws.close(code=1008)
        return

    audit.log(user.uid, "spectator_connect", {"room_id": room_id})
    await room.watch(ws)
    try:
        while True:
            try:
                msg = await ws.receive_json()
            except (json.JSONDecodeError, ValueError, RuntimeError):
                continue
            if isinstance(msg, dict) and msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await room.unwatch(ws)
        audit.log(user.uid, "spectator_disconnect", {"room_id": room_id})


async def _cleanup_disconnected_room(room_id: str, room: Room) -> None:
    await asyncio.sleep(120)
    async with room_creation_lock:
        current = rooms.get(room_id)
        if current is not room or any(p.connected for p in room.players.values()):
            return
        if room.spectators:
            return
        registry.hold(room_id, room.id, room.min_players)
        rooms.pop(room_id, None)
    audit.room_delete(room_id)


async def _player_socket(ws: WebSocket, room_id: str, name: str, pid: str,
                         auth_required: bool) -> None:
    identity = await _ws_identity(ws, name, pid, auth_required)
    if identity is None:
        return
    if gateway.enabled:
        await gateway.player_socket(ws, room_id, identity)
        return
    async with room_creation_lock:
        room = rooms.get(room_id)
        created = False
        reservation = None
        if room is None:
            if registry.expired_reservation(room_id):
                logger.info("room_join_expired instance=%s code=%s", INSTANCE_ID, room_id)
                await _ws_room_error(ws, "room_expired", "That room code expired. Create a new room.")
                return
            reservation = registry.get_reservation(room_id)
            if reservation is None:
                logger.info("room_join_missing instance=%s code=%s", INSTANCE_ID, room_id)
                await _ws_room_error(
                    ws, "room_not_found", "Room not found. Create or quick-match a room first.",
                )
                return
            ts = float(ROUND_SECONDS) if ROUND_SECONDS else None
            ms = float(MATCH_SECONDS) if MATCH_SECONDS else None
            room = Room(
                room_id, round_seconds=ts,
                min_players=reservation.min_players or MIN_PLAYERS, match_seconds=ms,
            )
            created = True

        try:
            player = await room.join(
                ws, identity.name, identity.pid,
                uid=identity.uid, verified=identity.verified,
                avatar_url=identity.avatar_url, character_id=identity.character_id,
                instance_id=INSTANCE_ID,
            )
        except GameAlreadyStarted:
            await _ws_room_error(
                ws, "game_started", "This match has already started. Joining is closed.",
            )
            return
        if player is None:
            await _ws_room_error(ws, "room_full", "Room is full (4 players max).")
            return

        if created and reservation is not None:
            rooms[room_id] = room
            registry.consume(room_id)
            audit.room_upsert(room_id, room)
        logger.info("room_join instance=%s code=%s room_id=%s uid=%s",
                    INSTANCE_ID, room_id, room.id, identity.uid or "guest")

    audit.log(player.uid, "room_join", {"room_id": room_id, "verified": player.verified,
                                        "instance_id": INSTANCE_ID})
    audit.room_upsert(room_id, room)
    try:
        while True:
            try:
                msg = await ws.receive_json()
            except (json.JSONDecodeError, ValueError, RuntimeError):
                continue
            if isinstance(msg, dict):
                try:
                    await room.handle(player, msg)
                except Exception as exc:  # never let one bad intent kill the match
                    logger.exception("intent failed: %s", exc)
                    await ws.send_json({"type": "error", "code": "internal",
                                        "message": "That action could not be processed."})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await room.leave(player)
        audit.room_upsert(room_id, room)
        if not any(p.connected for p in room.players.values()) and not room.spectators:
            asyncio.create_task(_cleanup_disconnected_room(room_id, room))


@app.websocket("/ws/{room_id}")
async def game_socket(ws: WebSocket, room_id: str, name: str = "Player", pid: str = "",
                      spectator: int = 0, auth: int = 0):
    await ws.accept()
    room_id = _normalize_code(room_id) or "LOBBY"
    if spectator:
        await _spectator_socket(ws, room_id)
        return
    await _player_socket(ws, room_id, name, pid, bool(auth))
