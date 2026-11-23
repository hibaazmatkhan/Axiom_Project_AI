"""Shared room coordination for horizontally scaled Vercel Services.

When ``REDIS_URL`` is configured, reservations, room ownership, status and
WebSocket fan-out are coordinated through Redis. One Function instance owns
the authoritative :class:`~app.game.Room`; other instances forward intents and
local socket frames over Redis pub/sub. Without ``REDIS_URL`` the app keeps its
original process-local behaviour so local development and tests stay simple.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable

from .room_registry import Reservation, canonicalize_room_code

logger = logging.getLogger(__name__)

try:
    import redis as _redis
    import redis.asyncio as _aioredis

    REDIS_AVAILABLE = True
except ImportError:
    _redis = None
    _aioredis = None
    REDIS_AVAILABLE = False


class RedisRoomRegistry:
    """Redis-backed replacement for :class:`RoomRegistry` with the same sync API."""

    def __init__(
        self,
        url: str,
        reservation_ttl: float = 600.0,
        queue_ttl: float = 60.0,
        prefix: str = "axiom:rooms",
        clock: Callable[[], float] = time.time,
    ):
        if not REDIS_AVAILABLE:
            raise RuntimeError("redis package is required for RedisRoomRegistry")
        self.client = _redis.Redis.from_url(
            url, decode_responses=True, health_check_interval=30
        )
        self.reservation_ttl = reservation_ttl
        self.queue_ttl = queue_ttl
        self.prefix = prefix.rstrip(":")
        self._clock = clock

    def _now(self) -> float:
        return self._clock()

    def _res_key(self, code: str) -> str:
        return f"{self.prefix}:reservation:{canonicalize_room_code(code)}"

    def _code_key(self, code: str) -> str:
        return f"{self.prefix}:code:{canonicalize_room_code(code)}"

    def _queue_key(self) -> str:
        return f"{self.prefix}:queue"

    def _matched_key(self) -> str:
        return f"{self.prefix}:matched"

    def _ttl(self, seconds: float) -> int:
        return max(1, int(seconds) + 60)

    def prune(self) -> None:
        now = self._now()
        self.client.zremrangebyscore(self._queue_key(), "-inf", now)
        for key, value in self.client.hgetall(self._matched_key()).items():
            try:
                expiry = float(str(value).split("|", 1)[1])
            except (IndexError, ValueError):
                expiry = 0.0
            if expiry <= now:
                self.client.hdel(self._matched_key(), key)

    def _new_code(self, taken: set[str]) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        for _ in range(100):
            code = "".join(secrets.choice(alphabet) for _ in range(4))
            if code in taken:
                continue
            if self.client.set(self._code_key(code), "1", nx=True, ex=self._ttl(self.reservation_ttl)):
                return code
        raise RuntimeError("Could not allocate a unique room code.")

    def reserve(self, min_players: int = 1, existing_codes: Any = ()) -> Reservation:
        self.prune()
        taken = {canonicalize_room_code(code) for code in existing_codes or ()}
        code = self._new_code(taken)
        now = self._now()
        reservation = Reservation(
            room_id=f"R{secrets.token_hex(6).upper()}",
            code=code,
            min_players=min_players,
            created_at=now,
            expires_at=now + self.reservation_ttl,
        )
        self._write_reservation(reservation)
        return reservation

    def _write_reservation(self, reservation: Reservation) -> None:
        key = self._res_key(reservation.code)
        self.client.hset(key, mapping={
            "room_id": reservation.room_id,
            "code": reservation.code,
            "min_players": reservation.min_players,
            "created_at": reservation.created_at,
            "expires_at": reservation.expires_at,
        })
        self.client.expire(key, self._ttl(self.reservation_ttl))

    def _read_reservation(self, code: str) -> Reservation | None:
        data = self.client.hgetall(self._res_key(code))
        if not data:
            return None
        try:
            return Reservation(
                room_id=str(data["room_id"]),
                code=str(data["code"]),
                min_players=int(data["min_players"]),
                created_at=float(data["created_at"]),
                expires_at=float(data["expires_at"]),
            )
        except (KeyError, TypeError, ValueError):
            return None

    def get_reservation(self, code: str) -> Reservation | None:
        self.prune()
        reservation = self._read_reservation(canonicalize_room_code(code))
        if reservation is None or reservation.expires_at <= self._now():
            return None
        return reservation

    def expired_reservation(self, code: str) -> bool:
        reservation = self._read_reservation(canonicalize_room_code(code))
        return reservation is not None and reservation.expires_at <= self._now()

    def consume(self, code: str) -> Reservation | None:
        normalized = canonicalize_room_code(code)
        reservation = self._read_reservation(normalized)
        self.client.delete(self._res_key(normalized))
        return reservation

    def restore(self, reservation: Reservation) -> None:
        if reservation.expires_at <= self._now():
            return
        if self._read_reservation(reservation.code) is None:
            self._write_reservation(reservation)

    def hold(self, code: str, room_id: str, min_players: int) -> Reservation:
        normalized = canonicalize_room_code(code) or str(code).strip().upper()
        now = self._now()
        reservation = Reservation(
            room_id=room_id, code=normalized, min_players=min_players,
            created_at=now, expires_at=now + self.reservation_ttl,
        )
        self._write_reservation(reservation)
        self.client.set(
            self._code_key(normalized), "1", ex=self._ttl(self.reservation_ttl)
        )
        return reservation

    def queue(
        self,
        client_key: str,
        min_players: int = 2,
        existing_codes: Any = (),
    ) -> dict:
        self.prune()
        key = str(client_key or "").strip()[:128]
        if not key:
            raise ValueError("client_key is required.")
        order = self._queue_key()
        matched = self._matched_key()
        if self.client.zscore(order, key) is not None:
            rank = self.client.zrank(order, key)
            return {"status": "queued", "position": int(rank or 0) + 1}
        existing_match = self.client.hget(matched, key)
        if existing_match:
            return {"status": "matched", "code": str(existing_match).split("|", 1)[0]}

        now = self._now()
        self.client.zadd(order, {key: now + self.queue_ttl})
        waiting = list(self.client.zrange(order, 0, -1))
        if len(waiting) < max(1, min_players):
            return {"status": "queued", "position": len(waiting)}

        chosen = waiting[: max(1, min_players)]
        self.client.zrem(order, *chosen)
        reservation = self.reserve(min_players, existing_codes)
        for waiting_key in chosen:
            self.client.hset(
                matched, waiting_key,
                f"{reservation.code}|{reservation.expires_at}",
            )
        return {"status": "matched", "code": reservation.code}

    def queue_status(self, client_key: str) -> dict | None:
        self.prune()
        key = str(client_key or "").strip()[:128]
        order = self._queue_key()
        if self.client.zscore(order, key) is not None:
            rank = self.client.zrank(order, key)
            return {"status": "queued", "position": int(rank or 0) + 1}
        matched = self.client.hget(self._matched_key(), key)
        if matched:
            return {"status": "matched", "code": str(matched).split("|", 1)[0]}
        return None


@dataclass
class RedisRoomTransport:
    """Adapter used by :class:`Room` to fan-out through Redis."""

    gateway: "RedisRoomGateway"
    code: str

    async def send(self, player_id: str, payload: dict) -> None:
        await self.gateway.publish(self.code, {
            "kind": "send", "target": player_id, "payload": payload,
        })

    async def broadcast(self, payload: dict, exclude: str | None = None) -> None:
        await self.gateway.publish(self.code, {
            "kind": "broadcast", "exclude": exclude, "payload": payload,
        })

    async def broadcast_admin(self, payload: dict) -> None:
        await self.gateway.publish(self.code, {
            "kind": "admin", "payload": payload,
        })

    async def send_spectator(self, token: str, payload: dict) -> None:
        await self.gateway.publish(self.code, {
            "kind": "admin_target", "token": token, "payload": payload,
        })


class _RoomLink:
    """One instance's subscription to one room's Redis channel."""

    def __init__(self, gateway: "RedisRoomGateway", code: str, owner: str):
        self.gateway = gateway
        self.code = code
        self.owner = owner
        self.sockets: dict[str, Any] = {}
        self.pending: dict[str, dict] = {}
        self.spectators: dict[str, Any] = {}
        self.pubsub = gateway.redis.pubsub()
        self.task = asyncio.create_task(self._listen())

    async def publish(self, message: dict) -> None:
        payload = dict(message)
        payload.update({
            "room": self.code,
            "origin": self.gateway.instance_id,
            "owner": self.owner,
        })
        await self.gateway.publish(self.code, payload)

    async def _listen(self) -> None:
        channel = self.gateway.channel(self.code)
        try:
            await self.pubsub.subscribe(channel)
            async for raw in self.pubsub.listen():
                if raw.get("type") != "message":
                    continue
                try:
                    message = json.loads(raw.get("data") or "{}")
                except (TypeError, ValueError):
                    continue
                if message.get("room") != self.code:
                    continue
                await self._dispatch(message)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("room subscription failed for %s", self.code)

    async def _dispatch(self, message: dict) -> None:
        kind = message.get("kind")
        if kind == "welcome":
            token = str(message.get("join_token") or "")
            pending = self.pending.get(token)
            if pending is None:
                return
            player_id = str(message.get("player_id") or "")
            self.sockets[player_id] = pending["ws"]
            pending["player_id"].append(player_id)
            pending["event"].set()
            payload = dict(message.get("payload") or {})
            payload.pop("join_token", None)
            await self._safe_send(pending["ws"], payload)
            return
        if kind == "join_error":
            pending = self.pending.get(str(message.get("token") or ""))
            if pending is None:
                return
            pending["event"].set()
            await self._safe_send(pending["ws"], {
                "type": "error", "code": message.get("code") or "join_failed",
                "message": message.get("message") or "Could not join the room.",
                "instance_id": self.gateway.instance_id,
            })
            try:
                await pending["ws"].close(code=1008)
            except Exception:
                pass
            return
        if kind == "send":
            ws = self.sockets.get(str(message.get("target") or ""))
            if ws is not None:
                await self._safe_send(ws, message.get("payload") or {})
            return
        if kind == "broadcast":
            excluded = str(message.get("exclude") or "")
            for player_id, ws in list(self.sockets.items()):
                if player_id != excluded:
                    await self._safe_send(ws, message.get("payload") or {})
            return
        if kind == "admin":
            for ws in list(self.spectators.values()):
                await self._safe_send(ws, message.get("payload") or {})
            return
        if kind == "admin_target":
            ws = self.spectators.get(str(message.get("token") or ""))
            if ws is not None:
                await self._safe_send(ws, message.get("payload") or {})
            return
        if message.get("owner") != self.gateway.instance_id:
            return
        if kind == "join_request":
            await self.gateway._handle_join_request(message)
        elif kind == "intent":
            await self.gateway._handle_intent(message)
        elif kind == "leave":
            await self.gateway._handle_leave(message)
        elif kind == "spectator_join":
            await self.gateway._handle_spectator_join(message)
        elif kind == "spectator_leave":
            await self.gateway._handle_spectator_leave(message)

    @staticmethod
    async def _safe_send(ws: Any, payload: dict) -> None:
        try:
            await ws.send_json(payload)
        except Exception:
            pass

    def empty(self) -> bool:
        return not (self.sockets or self.pending or self.spectators)

    async def close(self) -> None:
        self.task.cancel()
        try:
            await self.pubsub.unsubscribe(self.gateway.channel(self.code))
        except Exception:
            pass
        try:
            await self.pubsub.close()
        except Exception:
            pass


class RedisRoomGateway:
    """Routes sockets across Vercel Function instances through Redis pub/sub."""

    def __init__(self, instance_id: str, url: str, rooms: dict, registry: Any):
        self.instance_id = instance_id
        self.url = url
        self.rooms = rooms
        self.registry = registry
        self.enabled = bool(url and REDIS_AVAILABLE)
        self.redis = _aioredis.Redis.from_url(url, decode_responses=True) if self.enabled else None
        self.links: dict[str, _RoomLink] = {}
        self._owner_locks: dict[str, asyncio.Lock] = {}
        self._meta_ttl = 3600

    def channel(self, code: str) -> str:
        return f"axiom:rooms:channel:{canonicalize_room_code(code)}"

    def _owner_key(self, code: str) -> str:
        return f"axiom:rooms:owner:{canonicalize_room_code(code)}"

    def _meta_key(self, code: str) -> str:
        return f"axiom:rooms:meta:{canonicalize_room_code(code)}"

    async def publish(self, code: str, message: dict) -> None:
        if not self.enabled:
            return
        await self.redis.publish(self.channel(code), json.dumps(message))

    async def get_meta(self, code: str) -> dict | None:
        if not self.enabled:
            return None
        normalized = canonicalize_room_code(code)
        raw = await self.redis.get(self._meta_key(normalized))
        if not raw:
            return None
        try:
            meta = json.loads(raw)
        except ValueError:
            return None
        if not isinstance(meta, dict):
            return None
        try:
            pipe = self.redis.pipeline()
            pipe.expire(self._meta_key(normalized), self._meta_ttl)
            pipe.expire(self._owner_key(normalized), self._meta_ttl)
            await pipe.execute()
        except Exception:
            logger.debug("could not refresh shared room metadata for %s", normalized)
        return meta

    async def owner_exists(self, code: str) -> bool:
        if not self.enabled:
            return False
        try:
            return bool(await self.redis.exists(self._owner_key(canonicalize_room_code(code))))
        except Exception:
            return False

    async def publish_meta(self, code: str, room: Any) -> None:
        if not self.enabled:
            return
        from .game import MAX_PLAYERS

        connected = sum(1 for p in room.players.values() if p.connected)
        players = len(room.players)
        meta = {
            "room_id": room.id,
            "code": code,
            "status": room.status,
            "players": players,
            "connected": connected,
            "min_players": room.min_players,
            "full": players >= MAX_PLAYERS,
            "started": room.status != "lobby",
            "joinable": room.status == "lobby" and players < MAX_PLAYERS,
            "instance_id": self.instance_id,
            "updated_at": time.time(),
        }
        pipe = self.redis.pipeline()
        pipe.set(self._meta_key(code), json.dumps(meta), ex=self._meta_ttl)
        pipe.expire(self._owner_key(code), self._meta_ttl)
        await pipe.execute()

    async def create_room(self, code: str, min_players: int,
                          round_seconds: float | None = None,
                          match_seconds: float | None = None) -> Any:
        from .game import Room

        normalized = canonicalize_room_code(code)
        room = Room(normalized, round_seconds=round_seconds,
                    min_players=min_players, match_seconds=match_seconds)
        room.transport = RedisRoomTransport(self, normalized)
        room.state_hook = lambda: asyncio.create_task(self.publish_meta(normalized, room))
        self.rooms[normalized] = room
        await self.redis.set(self._owner_key(normalized), self.instance_id, ex=self._meta_ttl)
        self.link(normalized, self.instance_id)
        await self.publish_meta(normalized, room)
        return room

    async def release_room(self, code: str, room: Any) -> None:
        normalized = canonicalize_room_code(code)
        try:
            self.registry.hold(normalized, room.id, room.min_players)
        except Exception:
            logger.exception("could not hold released room %s", normalized)
        await self.publish_meta(normalized, room)

    async def ensure_owner(self, code: str) -> str:
        if not self.enabled:
            return self.instance_id
        normalized = canonicalize_room_code(code)
        lock = self._owner_locks.setdefault(normalized, asyncio.Lock())
        async with lock:
            owner = await self.redis.get(self._owner_key(normalized))
            if owner:
                return str(owner)
            meta = await self.get_meta(normalized)
            if meta and meta.get("instance_id"):
                return str(meta["instance_id"])
            await self.redis.set(
                self._owner_key(normalized), self.instance_id, nx=True, ex=self._meta_ttl
            )
            owner = await self.redis.get(self._owner_key(normalized))
            return str(owner or self.instance_id)

    async def claim_owner(self, code: str, expected: str) -> bool:
        if not self.enabled:
            return True
        script = """
        local current = redis.call('get', KEYS[1])
        if current and current ~= ARGV[1] then
            return 0
        end
        redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3])
        return 1
        """
        claimed = await self.redis.eval(
            script, 1, self._owner_key(code), expected, self.instance_id, self._meta_ttl
        )
        if not claimed:
            return False
        meta = await self.get_meta(code)
        if meta is not None:
            meta["instance_id"] = self.instance_id
            meta["updated_at"] = time.time()
            await self.redis.set(self._meta_key(code), json.dumps(meta), ex=self._meta_ttl)
        return True

    def link(self, code: str, owner: str | None = None) -> _RoomLink:
        normalized = canonicalize_room_code(code)
        link = self.links.get(normalized)
        if link is not None:
            return link
        link = _RoomLink(self, normalized, owner or self.instance_id)
        self.links[normalized] = link
        return link

    async def room_exists(self, code: str) -> bool:
        normalized = canonicalize_room_code(code)
        if normalized in self.rooms:
            return True
        if await self.get_meta(normalized) is not None:
            return True
        if await self.owner_exists(normalized):
            return True
        try:
            return self.registry.get_reservation(code) is not None
        except Exception:
            return False

    async def _room_error(self, ws: Any, code: str, message: str) -> None:
        try:
            await ws.send_json({
                "type": "error", "code": code, "message": message,
                "instance_id": self.instance_id,
            })
        except Exception:
            pass

    async def player_socket(self, ws: Any, code: str, identity: Any) -> None:
        normalized = canonicalize_room_code(code)
        try:
            if (await self.get_meta(normalized)) is None and self.registry.expired_reservation(normalized):
                await self._room_error(
                    ws, "room_expired", "That room code expired. Create a new room."
                )
                try:
                    await ws.close(code=1008)
                except Exception:
                    pass
                return
        except Exception:
            pass
        if not await self.room_exists(normalized):
            await self._room_error(
                ws, "room_not_found", "Room not found. Create or quick-match a room first."
            )
            try:
                await ws.close(code=1008)
            except Exception:
                pass
            return

        owner = await self.ensure_owner(normalized)
        link = self.link(normalized, owner)
        token = secrets.token_hex(8)
        event = asyncio.Event()
        link.pending[token] = {"ws": ws, "event": event, "player_id": []}
        join_request = {
            "kind": "join_request",
            "token": token,
            "name": identity.name,
            "pid": identity.pid,
            "uid": identity.uid,
            "verified": identity.verified,
            "avatar_url": identity.avatar_url,
            "character_id": identity.character_id,
        }

        player_id = None
        for attempt in range(2):
            await link.publish(join_request)
            try:
                await asyncio.wait_for(event.wait(), timeout=10.0)
                player_ids = link.pending[token]["player_id"]
                if not player_ids:
                    link.pending.pop(token, None)
                    return
                player_id = player_ids[0]
                break
            except asyncio.TimeoutError:
                if (attempt == 0 and owner != self.instance_id
                        and await self.claim_owner(normalized, owner)):
                    link.owner = self.instance_id
                    owner = self.instance_id
                    continue
                await self._room_error(ws, "join_timeout", "The room owner did not respond.")
                try:
                    await ws.close(code=1008)
                except Exception:
                    pass
                link.pending.pop(token, None)
                return
            except (IndexError, KeyError):
                link.pending.pop(token, None)
                return
        if player_id is None:
            link.pending.pop(token, None)
            return

        try:
            while True:
                try:
                    message = await ws.receive_json()
                except Exception:
                    break
                if not isinstance(message, dict):
                    continue
                if message.get("type") == "ping":
                    try:
                        await ws.send_json({"type": "pong"})
                    except Exception:
                        break
                    continue
                await link.publish({
                    "kind": "intent", "player_id": player_id, "payload": message,
                })
        finally:
            link.pending.pop(token, None)
            link.sockets.pop(player_id, None)
            await link.publish({"kind": "leave", "player_id": player_id})
            await self._maybe_close_link(normalized, link)

    async def spectator_socket(self, ws: Any, code: str, user: Any) -> None:
        normalized = canonicalize_room_code(code)
        if not await self.room_exists(normalized):
            await self._room_error(ws, "room_not_found", "Room not found.")
            try:
                await ws.close(code=1008)
            except Exception:
                pass
            return
        owner = await self.ensure_owner(normalized)
        link = self.link(normalized, owner)
        token = secrets.token_hex(8)
        link.spectators[token] = ws
        await link.publish({"kind": "spectator_join", "token": token, "uid": user.uid})
        try:
            while True:
                try:
                    message = await ws.receive_json()
                except Exception:
                    break
                if isinstance(message, dict) and message.get("type") == "ping":
                    try:
                        await ws.send_json({"type": "pong"})
                    except Exception:
                        break
        finally:
            link.spectators.pop(token, None)
            await link.publish({"kind": "spectator_leave", "token": token})
            await self._maybe_close_link(normalized, link)

    async def _maybe_close_link(self, code: str, link: _RoomLink) -> None:
        if not link.empty():
            return
        if link.owner == self.instance_id and code in self.rooms:
            return
        self.links.pop(code, None)
        await link.close()

    async def _ensure_owned_room(self, code: str) -> Any | None:
        room = self.rooms.get(code)
        if room is not None:
            return room
        meta = await self.get_meta(code)
        owned = await self.owner_exists(code)
        reservation = None
        try:
            reservation = self.registry.get_reservation(code)
        except Exception:
            pass
        if meta is None and reservation is None and not owned:
            return None
        from .game import Room

        min_players = reservation.min_players if reservation else int((meta or {}).get("min_players") or 2)
        room = Room(code, min_players=min_players)
        room.transport = RedisRoomTransport(self, code)
        room.state_hook = lambda: asyncio.create_task(self.publish_meta(code, room))
        self.rooms[code] = room
        if reservation is not None:
            self.registry.consume(code)
        if self.enabled:
            await self.redis.expire(self._owner_key(code), self._meta_ttl)
        await self.publish_meta(code, room)
        return room

    async def _handle_join_request(self, message: dict) -> None:
        code = canonicalize_room_code(message.get("room") or "")
        token = str(message.get("token") or "")
        room = await self._ensure_owned_room(code)
        if room is None:
            await self.publish(code, {
                "kind": "join_error", "token": token,
                "code": "room_not_found", "message": "Room not found.",
            })
            return
        try:
            player = await room.join(
                None,
                str(message.get("name") or "Player"),
                message.get("pid") or None,
                uid=message.get("uid") or None,
                verified=bool(message.get("verified")),
                avatar_url=message.get("avatar_url") or None,
                character_id=message.get("character_id") or None,
                instance_id=self.instance_id,
                join_token=token,
            )
        except Exception as exc:
            code_name = "game_started" if exc.__class__.__name__ == "GameAlreadyStarted" else "join_failed"
            await self.publish(code, {
                "kind": "join_error", "token": token, "code": code_name,
                "message": str(exc) or "Could not join the room.",
            })
            return
        if player is None:
            await self.publish(code, {
                "kind": "join_error", "token": token, "code": "room_full",
                "message": "Room is full (4 players max).",
            })
            return
        await self.publish_meta(code, room)

    async def _handle_intent(self, message: dict) -> None:
        code = canonicalize_room_code(message.get("room") or "")
        room = self.rooms.get(code)
        if room is None:
            return
        player = room.players.get(str(message.get("player_id") or ""))
        payload = message.get("payload")
        if player is None or not isinstance(payload, dict):
            return
        try:
            await room.handle(player, payload)
        except Exception:
            logger.exception("shared room intent failed for %s", code)

    async def _handle_leave(self, message: dict) -> None:
        code = canonicalize_room_code(message.get("room") or "")
        room = self.rooms.get(code)
        if room is None:
            return
        player = room.players.get(str(message.get("player_id") or ""))
        if player is None:
            return
        await room.leave(player)
        await self.publish_meta(code, room)

    async def _handle_spectator_join(self, message: dict) -> None:
        code = canonicalize_room_code(message.get("room") or "")
        room = await self._ensure_owned_room(code)
        if room is None:
            return
        await room.watch(None, token=str(message.get("token") or ""))

    async def _handle_spectator_leave(self, message: dict) -> None:
        code = canonicalize_room_code(message.get("room") or "")
        room = self.rooms.get(code)
        if room is None:
            return
        await room.unwatch(token=str(message.get("token") or ""))
