"""Room and game state for THE LAST ROOM.

The server is authoritative. Clients send intents (choose a coloured door, wait,
unlock, predict, chat, ready). The server validates them, applies the round loop,
rolls the d10 pedestal, resolves lockdowns/sanctions, asks The Dealer for the
next action, filters information per role and broadcasts.

Game loop
---------
round_start -> shift_grid -> roll_dice -> choose_doors -> resolve_lockdowns
-> resolve_sanctions -> dealer_action -> check_endings -> next_round
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

from .arena import (
    DIRECTIONS,
    OPPOSITE,
    START_ROOM,
    STEP,
    Arena,
    Room as ArenaRoom,
    reachable_after_changes,
)
from .avatar_store import normalize_avatar
from .patterns import PatternEngine
from .stages import MAX_STAGE, rules_for_stage, stage_config
from .directors import Director, NexusDirector
from .knowledge import KnowledgeBase, LEVEL_DIFFICULTIES
from .nexus import DICE_RELIEF_ROUNDS, MAX_COMPLEXITY, Nexus
from .roles import ROLES, filter_arena, filter_round, filter_snapshot, filter_visions
from . import audit, fate, db, puzzles

logger = logging.getLogger(__name__)


class GameAlreadyStarted(Exception):
    pass


MAX_PLAYERS = 4
COLORS = ["#e23b3b", "#3f7bd9", "#e8b53a", "#3f9f6b"]
INTENT_BUCKET = 0.5
INTENT_MAX = 14
DEFAULT_MATCH_SECONDS = 300.0

START_POINTS = fate.START_POINTS
MAX_ROUNDS = fate.MAX_ROUNDS
DOOR_COST = fate.DOOR_COST
DOOR_OPEN_SECONDS = 10.0
PATHFINDER_REVEAL_COOLDOWN = 120.0
DELAY_CONFIG = {
    "answer_ms": {1: 30000, 2: 40000, 3: 50000},
    "delay_s": {1: 6, 2: 12, 3: 18},
    "penalty_s": {1: -3, 2: -6, 3: -9},
    "cooldown_s": 45,
    "attempts_per_stage": 2,
    "max_shift_delay_s": 18,
    "second_success_multiplier": 0.5,
    "min_shift_s": 15,
    "max_shift_s": 60,
    "min_time_before_shift_s": 3,
}
WAIT_COST = fate.WAIT_COST
REVIVE_COST = fate.REVIVE_COST


def clean_name(name: str) -> str:
    return re.sub(r"[^\w \-]", "", name or "")[:16].strip()


@dataclass
class Player:
    id: str
    name: str
    slot: int
    color: str
    role: str
    room_id: str
    uid: str | None = None
    verified: bool = False
    avatar_url: str | None = None
    character_id: str | None = None
    escaped: bool = False
    exit_found: bool = False
    ready: bool = False
    connected: bool = True
    disconnected_at: float = 0.0
    last_move: float = 0.0
    predictions: int = 0
    correct: int = 0
    streak: int = 0
    points: int = START_POINTS
    locked: bool = False
    eliminated: bool = False
    sealed_strikes: int = 0
    waits: int = 0
    revives: int = 0
    last_room_id: str | None = None
    last_door: str | None = None
    entered_round: int = 0
    wristband_revealed: bool = False
    wristband_cooldown_until: float = 0.0
    ws: WebSocket | None = field(default=None, repr=False)
    bucket_at: float = 0.0
    bucket_n: int = 0

    def public(self) -> dict:
        return {
            "id": self.id, "name": self.name, "slot": self.slot, "color": self.color,
            "avatar_url": self.avatar_url, "character_id": self.character_id,
            "role": self.role, "room_id": self.room_id, "escaped": self.escaped,
            "ready": self.ready, "connected": self.connected,
            "correct": self.correct, "predictions": self.predictions, "streak": self.streak,
            "points": self.points, "locked": self.locked, "eliminated": self.eliminated,
            "waits": self.waits, "revives": self.revives,
        }

    def allow(self, now: float) -> bool:
        if now - self.bucket_at > INTENT_BUCKET:
            self.bucket_at = now
            self.bucket_n = 0
        self.bucket_n += 1
        return self.bucket_n <= INTENT_MAX


@dataclass
class TemporaryDoor:
    a_rid: str
    b_rid: str
    a_dir: str
    b_dir: str
    opened_by: str
    expires_at: float
    cost: int


class Room:
    def __init__(self, room_id: str, seed: int | None = None,
                 round_seconds: float | None = None, min_players: int = 1,
                 match_seconds: float | None = None, director: Director | None = None):
        self.id = room_id
        self.seed = seed if seed is not None else random.randrange(1 << 30)
        self.arena = Arena.generate(size=5, seed=self.seed)
        self.stage = 1
        cfg = stage_config(self.stage)
        self.round_override = round_seconds
        self.round_seconds = round_seconds or cfg["round_seconds"]
        self.shift_seconds = self.round_seconds
        self.match_seconds = match_seconds if match_seconds and match_seconds > 0 else DEFAULT_MATCH_SECONDS
        self.match_deadline: float | None = None
        self.min_players = min_players
        self.engines = [PatternEngine(r, self.arena.size)
                        for r in rules_for_stage(self.stage, self.seed)]
        self.nexus = director if director is not None else NexusDirector(seed=self.seed)
        self.players: dict[str, Player] = {}
        self.status = "lobby"  # lobby | running | won | over
        self.round = 0
        self.knowledge = KnowledgeBase()
        self.complexity_override = 1
        if hasattr(self.nexus, "complexity_level"):
            self.nexus.complexity_level = self.complexity_override
        self.puzzle = None
        self.puzzle_rewarded = False
        self.puzzle_contributions: dict[str, str] = {}
        self.puzzle_contributors: dict[str, str] = {}
        self._director_seals: list[tuple[str, str]] = []
        self.dice_relief_rounds = 0
        self.pending_nudges: list[tuple[str, dict]] = []
        self.info_nudges: dict[str, int] = {}
        self.max_rounds = MAX_ROUNDS
        self.next_round_at: float | None = None
        self.delay_puzzle: dict | None = None
        self.delay_deadline: float | None = None
        self.delay_cooldown_until = 0.0
        self.delay_puzzle_counter = 0
        self.delay_attempts: dict[int, int] = {}
        self.shift_delay_applied = 0.0
        self.shift_successes = 0
        self.events: list[dict] = []
        self.prev_arena: dict | None = None
        self.pa = "THE LAST ROOM. FIND THE HIDDEN EXIT."
        self.sanction_total = 0
        self.sanction_found = 0
        self.pending_clues: list[tuple[str, dict]] = []
        self.puzzle = self._new_puzzle()
        self._recompute_sanctions()
        self.rng = random.Random(self.seed ^ 0x9E3779B9)
        self._role_rng = random.Random(self.seed ^ 0x51ED270B)
        self.role_pool = list(ROLES)
        self._role_rng.shuffle(self.role_pool)
        self.dice: dict = {}
        self.visions: dict = {}
        self.open_doors: dict[frozenset[str], TemporaryDoor] = {}
        self.last_shift: dict = {"pattern_type": None, "moved": [], "ops": [], "repairs": []}
        self._task: asyncio.Task | None = None
        self._counter = 0
        self._pending_finish = False
        self.started_at = time.time()
        # Read-only admin observers. They never take a player slot and receive
        # the unfiltered arena, dice, visions and event timeline.
        self.spectators: list[WebSocket] = []
        self._admin_push_at = 0.0

    # ---- stage / rules ---------------------------------------------------
    def _load_stage(self) -> None:
        cfg = stage_config(self.stage)
        self.engines = [PatternEngine(r, self.arena.size)
                        for r in rules_for_stage(self.stage, self.seed,
                                                 complexity=self.complexity_override)]
        self.round_seconds = self.round_override if self.round_override is not None else cfg["round_seconds"]
        self.pa = f"STAGE {self.stage}: {cfg['name'].upper()}."

    # ---- cooperative CSP puzzle -------------------------------------------
    def _puzzle_complexity(self) -> int:
        return max(1, min(MAX_COMPLEXITY, int(self.complexity_override or 1)))

    def _new_puzzle(self):
        level = self._puzzle_complexity()
        puzzle = self.knowledge.generate_puzzle(
            self.seed ^ (self.round * 7919) ^ (self.stage * 104729),
            difficulty=LEVEL_DIFFICULTIES.get(level, "easy"),
            complexity=level,
        )
        self.puzzle_rewarded = False
        self.puzzle_contributions = {}
        self.puzzle_contributors = {}
        self.log(None, "puzzle_generated", puzzle.public())
        return puzzle

    async def submit_puzzle(self, player: Player, assignment) -> None:
        if self.status != "running" or player.eliminated or player.escaped:
            return
        if self.puzzle is None or self.puzzle_rewarded:
            await self.send(player, {"type": "puzzle_result", "correct": False,
                                     "code": "unavailable"})
            return
        role = player.role
        if role not in self.puzzle.domains:
            await self.send(player, {"type": "puzzle_result", "correct": False,
                                     "code": "role_unavailable"})
            return
        value = assignment.get(role) if isinstance(assignment, dict) else None
        if not isinstance(value, str) or value not in self.puzzle.domains[role]:
            await self.send(player, {"type": "puzzle_result", "correct": False,
                                     "code": "invalid_mark"})
            return

        self.puzzle_contributions[role] = value
        self.puzzle_contributors[role] = player.id
        self.log(player.id, "puzzle_attempt", {"role": role, "value": value})
        complete = all(name in self.puzzle_contributions for name in self.puzzle.domains)
        correct = False
        attempts = len(self.puzzle_contributions)
        if complete:
            attempts = self.knowledge.submit_puzzle(dict(self.puzzle_contributions))
            correct = attempts["correct"]
        if correct:
            self.puzzle_rewarded = True
            for contributor in set(self.puzzle_contributors.values()):
                recipient = self.players.get(contributor)
                if recipient is not None and not recipient.eliminated:
                    recipient.points += 1
            self.log(None, "puzzle_solved", {"attempts": attempts["attempts"]})
            audit.room_upsert(self.id, self)
            self.pa = "THE ROLE MARKS ALIGN. THE PUZZLE IS SOLVED."
        elif complete:
            self.pa = "THE MARKS DO NOT ALIGN. KEEP SHARING."
        else:
            self.pa = "ONE ROLE MARK IS SET. WAIT FOR THE OTHERS."
        await self.send(player, {
            "type": "puzzle_result", "correct": correct,
            "attempts": attempts if isinstance(attempts, int) else attempts["attempts"],
            "points": player.points,
            "complete": complete,
            "marks": len(self.puzzle_contributions),
            "message": self.pa,
        })
        await self.broadcast_state()

    # ---- helpers ----------------------------------------------------------
    def _nexus_report(self) -> dict:
        report = self.nexus.team_report()
        report["dice_relief_rounds"] = self.dice_relief_rounds
        return report

    def _audit_room(self) -> None:
        audit.room_upsert(self.id, self)

    def log(self, player_id: str | None, kind: str, data: dict | None = None) -> None:
        ev = {"t": time.time(), "player": player_id, "kind": kind, "data": data or {}}
        self.events.append(ev)
        if len(self.events) > 5000:
            del self.events[:1000]
        self.nexus.ingest(ev)

    def _roll_shift_seconds(self) -> float:
        base = self.round_override if self.round_override is not None else self.round_seconds
        if base <= 0:
            return DELAY_CONFIG["min_shift_s"]
        rolled = self.rng.uniform(base * 0.8, base * 1.2)
        return round(max(DELAY_CONFIG["min_shift_s"], min(DELAY_CONFIG["max_shift_s"], rolled)), 1)

    def _temporary_for(self, room: ArenaRoom, d: str) -> TemporaryDoor | None:
        target = self.arena.door_target(room, d)
        if target is None:
            return None
        temp = self.open_doors.get(frozenset((room.rid, target.rid)))
        if temp is None or temp.expires_at <= time.time():
            return None
        return temp

    def arena_public(self) -> dict:
        pub = self.arena.to_public()
        for pub_room, room in zip(pub["rooms"], self.arena.rooms):
            for d in DIRECTIONS:
                temp = self._temporary_for(room, d)
                pub_room["doors"][d]["temporary_open"] = bool(temp)
                pub_room["doors"][d]["open_until"] = temp.expires_at if temp else None
                if temp:
                    pub_room["open"][d] = True
        return pub

    def wristband_public(self, revealed: bool = False) -> dict:
        return {
            room.code: {
                d: not self.arena.door_open(room, d) if revealed else False
                for d in DIRECTIONS
            }
            for room in self.arena.rooms
        }

    def _recompute_sanctions(self) -> None:
        hidden = [room for room in self.arena.rooms if room.sanction]
        self.sanction_total = len(hidden)
        self.sanction_found = sum(1 for room in hidden if room.revealed)

    def _prune_open_doors(self, now: float) -> list[TemporaryDoor]:
        expired: list[TemporaryDoor] = []
        for key, temp in list(self.open_doors.items()):
            if temp.expires_at <= now:
                self.open_doors.pop(key, None)
                expired.append(temp)
        return expired

    async def expire_open_doors(self) -> None:
        expired = self._prune_open_doors(time.time())
        if not expired:
            return
        for temp in expired:
            a = self.arena.room_by_id(temp.a_rid)
            b = self.arena.room_by_id(temp.b_rid)
            public = {
                "type": "door_closed",
                "door": temp.a_dir,
                "message": "The doorway slammed shut.",
            }
            private = {
                **public,
                "room_code": a.code if a else None,
                "target_code": b.code if b else None,
            }
            for player in list(self.players.values()):
                if not player.connected:
                    continue
                if player.room_id in (temp.a_rid, temp.b_rid):
                    await self.send(player, private)
                else:
                    await self.send(player, public)
        await self.broadcast_state()

    def alive(self) -> list[Player]:
        return [p for p in self.players.values() if p.connected and not p.eliminated]

    def player_public(self, p: Player) -> dict:
        out = p.public()
        room = self.arena.room_by_id(p.room_id)
        out["room_code"] = room.code if room else None
        out["room"] = [room.bx, room.by] if room else None
        return out

    def players_public(self) -> list[dict]:
        return [self.player_public(p) for p in self.players.values()]

    def players_message(self) -> dict:
        return {"type": "players", "status": self.status, "players": self.players_public()}

    def you_public(self, p: Player) -> dict:
        room = self.arena.room_by_id(p.room_id)
        doors: dict[str, dict] = {}
        if room:
            for d in DIRECTIONS:
                door = room.doors[d]
                temp = self._temporary_for(room, d)
                doors[d] = {
                    "color": door.color,
                    "open": self.arena.door_open(room, d) or temp is not None,
                    "temporary_open": temp is not None,
                    "open_until": temp.expires_at if temp else None,
                }
        return {
            "id": p.id, "room_id": p.room_id,
            "room_code": room.code if room else None,
            "room": [room.bx, room.by] if room else None,
            "doors": doors, "locked": p.locked, "eliminated": p.eliminated,
            "escaped": p.escaped,             "points": p.points, "role": p.role,
            "wristband_revealed": p.wristband_revealed,
            "wristband_cooldown_remaining": max(0.0, p.wristband_cooldown_until - time.time()),
            "exit_found": p.exit_found,
            "exit_code": self.arena.exit_room().code if p.exit_found else None,
        }

    def snapshot(self, for_player: Player | None = None) -> dict:
        role = for_player.role if for_player else "unassigned"
        remaining = None
        if role == "timekeeper" and self.status == "running" and self.next_round_at is not None:
            remaining = max(0.0, self.next_round_at - time.time())
        match_remaining = None
        if self.status == "running" and self.match_deadline is not None:
            match_remaining = max(0.0, self.match_deadline - time.time())
        wristband_revealed = bool(
            for_player and for_player.role == "pathfinder" and for_player.wristband_revealed
        )
        snap = {
            "room": self.id, "status": self.status, "round": self.round,
            "max_rounds": self.max_rounds,
            "stage": self.stage, "stage_name": stage_config(self.stage)["name"],
            "max_stage": MAX_STAGE,
            "arena": self.arena_public(),
            "wristband": self.wristband_public(wristband_revealed),
            "wristband_sanctions": [
                room.code for room in self.arena.rooms if wristband_revealed and room.sanction
            ],
            "players": self.players_public(),
            "you": self.you_public(for_player) if for_player else None,
            "next_round_in": remaining, "round_seconds": self.round_seconds,
            "match_time_left": match_remaining, "match_seconds": self.match_seconds,
            "min_players": self.min_players, "rule_count": len(self.engines),
            "sanction_total": self.sanction_total, "sanction_found": self.sanction_found,
            "nexus": self._nexus_report(), "pa": self.pa,
            "dice": {}, "futures": filter_visions(self.visions, role),
            "dice_relief_rounds": self.dice_relief_rounds,
            "puzzle": {
                "public": self.puzzle.public() if self.puzzle else {},
                "you": self.puzzle.role_view(role) if self.puzzle and role in self.puzzle.domains else None,
            },
        }
        if role in ("timekeeper", "decoder"):
            snap["delay_status"] = self._delay_status()
        return filter_snapshot(snap, role)

    async def send(self, player: Player, payload: dict) -> None:
        if player.ws is None:
            return
        try:
            await player.ws.send_json(payload)
        except Exception:
            pass

    async def broadcast(self, payload: dict, exclude: str | None = None) -> None:
        for p in list(self.players.values()):
            if p.id != exclude and p.connected:
                await self.send(p, payload)

    async def broadcast_state(self) -> None:
        for p in list(self.players.values()):
            if p.connected:
                await self.send(p, {"type": "state", "state": self.snapshot(p)})
        await self.broadcast_admin()

    # ---- admin observers ----------------------------------------------------
    def admin_arena(self) -> dict:
        """Unfiltered arena: every sigil, sanction and exit."""
        arena = self.arena.to_public(include_exit=True)
        for pub, room in zip(arena["rooms"], self.arena.rooms):
            pub["sigil"] = room.sigil
            pub["sanction"] = room.sanction
            pub["revealed"] = True
            pub["future"] = room.future
        return arena

    def timeline_public(self, limit: int = 160) -> list[dict]:
        names = {p.id: p.name for p in self.players.values()}
        start = max(0, len(self.events) - limit)
        out = []
        for i in range(start, len(self.events)):
            ev = self.events[i]
            pid = ev.get("player")
            out.append({
                "i": i + 1,
                "t": round(ev.get("t", 0.0), 3),
                "player": names.get(pid, "The Dealer" if not pid else str(pid)),
                "player_id": pid,
                "kind": ev.get("kind", "event"),
                "data": ev.get("data", {}),
            })
        return out

    def admin_public(self) -> dict:
        remaining = None
        if self.status == "running" and self.next_round_at is not None:
            remaining = max(0.0, self.next_round_at - time.time())
        match_remaining = None
        if self.status == "running" and self.match_deadline is not None:
            match_remaining = max(0.0, self.match_deadline - time.time())
        return {
            "type": "admin_state",
            "room": self.id,
            "status": self.status,
            "round": self.round,
            "max_rounds": self.max_rounds,
            "stage": self.stage,
            "stage_name": stage_config(self.stage)["name"],
            "max_stage": MAX_STAGE,
            "arena": self.admin_arena(),
            "players": self.players_public(),
            "dice": self.dice,
            "visions": self.visions,
            "next_round_in": remaining,
            "round_seconds": self.round_seconds,
            "match_time_left": match_remaining,
            "match_seconds": self.match_seconds,
            "min_players": self.min_players,
            "rule_count": len(self.engines),
            "sanction_total": self.sanction_total,
            "sanction_found": self.sanction_found,
            "nexus": self._nexus_report(),
            "pa": self.pa,
            "puzzle": {
                "public": self.puzzle.public() if self.puzzle else {},
                "solution": dict(self.puzzle.solution) if self.puzzle else {},
            },
            "dice_relief_rounds": self.dice_relief_rounds,
            "last_shift": self.last_shift,
            "timeline": self.timeline_public(),
            "seed": self.seed,
            "started_at": self.started_at,
            "updated_at": time.time(),
        }

    async def watch(self, ws: WebSocket) -> None:
        self.spectators.append(ws)
        try:
            await ws.send_json(self.admin_public())
        except Exception:
            pass

    async def unwatch(self, ws: WebSocket) -> None:
        if ws in self.spectators:
            self.spectators.remove(ws)

    async def broadcast_admin(self, force: bool = False) -> None:
        if not self.spectators:
            return
        now = time.time()
        if not force and now - self._admin_push_at < 0.4:
            return
        self._admin_push_at = now
        payload = self.admin_public()
        dead: list[WebSocket] = []
        for ws in list(self.spectators):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.unwatch(ws)

    # ---- lifecycle ----------------------------------------------------------
    async def join(self, ws: WebSocket, name: str, player_id: str | None = None,
                   uid: str | None = None, verified: bool = False,
                   avatar_url: str | None = None,
                   character_id: str | None = None) -> Player | None:
        avatar_url, _ = normalize_avatar(avatar_url, character_id, uid or player_id or name)
        if player_id and player_id in self.players:
            p = self.players[player_id]
            if (p.uid or None) == (uid or None):
                p.ws = ws
                p.connected = True
                p.verified = verified
                p.avatar_url = avatar_url
                p.character_id = None
                if self.arena.room_by_id(p.room_id) is None:
                    p.room_id = self.arena.start_room().rid
                self.log(p.id, "reconnect")
                self._audit_room()
                await self.send(p, {"type": "welcome", "you": p.id, "state": self.snapshot(p)})
                await self.broadcast_state()
                return p
            player_id = None
        if self.status != "lobby":
            raise GameAlreadyStarted()
        if len(self.players) >= MAX_PLAYERS:
            return None
        used = {p.slot for p in self.players.values()}
        slot = next(i for i in range(MAX_PLAYERS) if i not in used)
        used_roles = {p.role for p in self.players.values()}
        role = next((r for r in self.role_pool if r not in used_roles), None)
        if role is None:
            return None
        self._counter += 1
        pid = f"p{self._counter}"
        player = Player(pid, clean_name(name) or f"Player {slot + 1}", slot,
                        COLORS[slot], role, self.arena.start_room().rid,
                        uid=uid, verified=verified, avatar_url=avatar_url,
                        character_id=None, ws=ws)
        self.players[pid] = player
        self.log(pid, "join", {"role": player.role, "name": player.name})
        self._audit_room()
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())
        await self.send(player, {"type": "welcome", "you": pid, "state": self.snapshot(player)})
        await self.broadcast_state()
        return player

    async def leave(self, player: Player) -> None:
        if player.id not in self.players:
            return
        player.connected = False
        player.ws = None
        player.disconnected_at = time.time()
        self.log(player.id, "disconnect")
        self._audit_room()
        await self.broadcast_state()

    def purge_disconnected(self) -> None:
        dead = [pid for pid, p in self.players.items()
                if not p.connected and time.time() - getattr(p, "disconnected_at", time.time()) > 120]
        for pid in dead:
            self.players.pop(pid, None)
        if dead:
            self._audit_room()

    # ---- input --------------------------------------------------------------
    async def handle(self, player: Player, msg: dict) -> None:
        now = time.monotonic()
        if not player.allow(now):
            await self.send(player, {"type": "error", "code": "rate_limited",
                                     "message": "Slow down."})
            return
        kind = msg.get("type")
        if kind in ("open_door", "choose_door", "choose_gate"):
            await self.open_door(player, door=msg.get("door"), color=msg.get("color"))
        elif kind == "cross_door":
            await self.cross_door(player, msg.get("door"))
        elif kind == "move":
            door = msg.get("door")
            if door is None and msg.get("dx") is not None:
                step = (msg.get("dx"), msg.get("dy"))
                door = next((d for d, s in STEP.items() if s == step), None)
            await self.open_door(player, door=door, color=msg.get("color"))
        elif kind == "wait":
            await self.wait(player)
        elif kind == "unlock":
            await self.unlock(player, msg.get("target"))
        elif kind == "predict":
            await self.predict(player, msg)
        elif kind in ("puzzle_submit", "solve_puzzle"):
            await self.submit_puzzle(player, msg.get("assignment"))
        elif kind == "delay_queue":
            await self.queue_delay(player, msg.get("tier"))
        elif kind == "delay_answer":
            await self.answer_delay(player, msg.get("puzzle_id"), msg.get("answer"))
        elif kind == "ready":
            player.ready = bool(msg.get("value"))
            self._audit_room()
            await self.broadcast_state()
            await self.maybe_start()
        elif kind == "chat":
            await self.team_chat(player, msg.get("text"))
        elif kind in ("pathfinder_reveal", "reveal_wristband"):
            await self.reveal_wristband(player)
        elif kind == "ping":
            await self.send(player, {"type": "pong"})

    async def reveal_wristband(self, player: Player) -> None:
        if self.status != "running" or player.eliminated or player.escaped:
            await self.send(player, {
                "type": "error", "code": "unavailable",
                "message": "The wristband scan is unavailable.",
            })
            return
        if player.role != "pathfinder":
            await self.send(player, {
                "type": "error", "code": "role_unavailable",
                "message": "Only the Pathfinder can scan the wristband.",
            })
            return
        if player.wristband_revealed:
            await self.send(player, {
                "type": "error", "code": "already_revealed",
                "message": "The wristband is already revealed until the next shift.",
            })
            return
        remaining = player.wristband_cooldown_until - time.time()
        if remaining > 0:
            await self.send(player, {
                "type": "error", "code": "cooldown",
                "message": f"Wristband scan recharges in {int(remaining)}s.",
            })
            return
        player.wristband_revealed = True
        self.log(player.id, "wristband_reveal", {"until": "next_shift"})
        await self.send(player, {
            "type": "wristband_reveal", "active": True,
            "message": "WRISTBAND REVEALED — READ IT BEFORE THE NEXT SHIFT.",
        })
        await self.broadcast_state()

    def _delay_pair(self):
        keeper = next((p for p in self.players.values()
                       if p.role == "timekeeper" and p.connected and not p.eliminated and not p.escaped), None)
        decoder = next((p for p in self.players.values()
                        if p.role == "decoder" and p.connected and not p.eliminated and not p.escaped), None)
        return keeper, decoder

    def _delay_attempts_left(self) -> int:
        used = self.delay_attempts.get(self.stage, 0)
        return max(0, DELAY_CONFIG["attempts_per_stage"] - used)

    def _delay_status(self) -> dict:
        now = time.time()
        if self.delay_puzzle is not None:
            state = "solving"
            cooldown_s = 0.0
        elif self.delay_cooldown_until > now:
            state = "cooldown"
            cooldown_s = self.delay_cooldown_until - now
        else:
            state = "idle"
            cooldown_s = 0.0
        return {
            "state": state, "cooldown_s": round(cooldown_s, 1),
            "attempts_left": self._delay_attempts_left(),
        }

    async def _send_delay_status(self) -> None:
        status = self._delay_status()
        keeper, decoder = self._delay_pair()
        for player in (keeper, decoder):
            if player is not None:
                await self.send(player, {"type": "delay_status", **status})

    async def queue_delay(self, player: Player, tier) -> None:
        if self.status != "running" or player.eliminated or player.escaped:
            await self.send(player, {"type": "error", "code": "unavailable",
                                     "message": "The delay puzzle is unavailable."})
            return
        if player.role != "timekeeper":
            await self.send(player, {"type": "error", "code": "role_unavailable",
                                     "message": "Only the Timekeeper can queue a delay."})
            return
        keeper, decoder = self._delay_pair()
        if keeper is None or decoder is None:
            await self.send(player, {
                "type": "error", "code": "delay_pair_unavailable",
                "message": "The Timekeeper and Decoder must both be alive and connected.",
            })
            return
        try:
            tier = int(tier)
        except (TypeError, ValueError):
            tier = 0
        if tier not in DELAY_CONFIG["answer_ms"]:
            await self.send(player, {"type": "error", "code": "bad_tier",
                                     "message": "Choose tier 1, 2 or 3."})
            return
        if self.delay_puzzle is not None:
            await self.send(player, {"type": "error", "code": "puzzle_open",
                                     "message": "A puzzle is already open."})
            return
        if self.delay_cooldown_until > time.time():
            await self.send(player, {"type": "error", "code": "cooldown",
                                     "message": "The delay puzzle is recharging."})
            return
        if self._delay_attempts_left() <= 0:
            await self.send(player, {"type": "error", "code": "no_attempts",
                                     "message": "No delay attempts remain this stage."})
            return
        self.delay_puzzle_counter += 1
        puzzle = puzzles.generate(self.seed, self.delay_puzzle_counter, tier)
        self.delay_puzzle = puzzle
        self.delay_deadline = time.time() + DELAY_CONFIG["answer_ms"][tier] / 1000
        self.delay_attempts[self.stage] = self.delay_attempts.get(self.stage, 0) + 1
        self.log(player.id, "delay_queue", {"tier": tier, "puzzle_id": puzzle["puzzle_id"]})
        await self.send(decoder, {
            "type": "puzzle",
            **puzzles.public_view(puzzle, DELAY_CONFIG["answer_ms"][tier]),
        })
        await self.send(keeper, {"type": "puzzle_key", **puzzles.key_view(puzzle)})
        await self._send_delay_status()

    async def answer_delay(self, player: Player, puzzle_id, answer) -> None:
        if self.status != "running" or player.eliminated or player.escaped:
            return
        if player.role != "decoder":
            await self.send(player, {"type": "error", "code": "role_unavailable",
                                     "message": "Only the Decoder can answer the puzzle."})
            return
        if self.delay_puzzle is None or puzzle_id != self.delay_puzzle["puzzle_id"]:
            await self.send(player, {"type": "error", "code": "stale_puzzle",
                                     "message": "That puzzle is no longer open."})
            return
        if self.delay_deadline is not None and time.time() >= self.delay_deadline:
            await self._finish_delay(False)
            return
        await self._finish_delay(puzzles.check_answer(self.delay_puzzle, answer))

    def _apply_delay(self, tier: int, ok: bool) -> float:
        if self.next_round_at is None:
            return 0.0
        now = time.time()
        before = max(0.0, self.next_round_at - now)
        if ok:
            amount = DELAY_CONFIG["delay_s"][tier]
            if self.shift_successes:
                amount *= DELAY_CONFIG["second_success_multiplier"]
            amount = min(amount, max(0.0, DELAY_CONFIG["max_shift_delay_s"] - self.shift_delay_applied))
            after = min(DELAY_CONFIG["max_shift_s"], before + amount)
            after = max(DELAY_CONFIG["min_shift_s"], after)
            self.shift_delay_applied += max(0.0, after - before)
            self.shift_successes += 1
        else:
            after = before + DELAY_CONFIG["penalty_s"][tier]
            after = max(DELAY_CONFIG["min_time_before_shift_s"], after)
            after = min(DELAY_CONFIG["max_shift_s"], after)
        self.next_round_at = now + after
        return round(after - before, 3)

    async def _finish_delay(self, ok: bool) -> None:
        puzzle = self.delay_puzzle
        if puzzle is None:
            return
        delta = self._apply_delay(puzzle["tier"], bool(ok))
        self.delay_puzzle = None
        self.delay_deadline = None
        self.delay_cooldown_until = time.time() + DELAY_CONFIG["cooldown_s"]
        self.log(None, "delay_result", {"ok": bool(ok), "delta_s": delta})
        self.pa = "THE DEALER BUYS TIME." if ok else "THE DEALER TAKES TIME BACK."
        for player in list(self.players.values()):
            result = {"type": "delay_result", "ok": bool(ok), "message": self.pa}
            if player.role == "timekeeper":
                result["delta_s"] = delta
            await self.send(player, result)
        await self._send_delay_status()
        await self.broadcast_state()

    # ---- movement / doors ---------------------------------------------------
    def _visible_exit_code(self, player: Player) -> str | None:
        room = self.arena.room_by_id(player.room_id)
        if room is None:
            return None
        if self.arena.is_exit(room):
            return room.code
        for direction in DIRECTIONS:
            if self._temporary_for(room, direction) is None:
                continue
            target = self.arena.door_target(room, direction)
            if target is not None and self.arena.is_exit(target):
                return target.code
        return None

    async def _refresh_exit_visibility(self, player: Player) -> None:
        if player.exit_found or player.eliminated or player.escaped:
            return
        code = self._visible_exit_code(player)
        if code is None:
            return
        player.exit_found = True
        self.log(player.id, "exit_found", {"room": code, "visible": True})
        await self.send(player, {
            "type": "exit_found", "room_code": code,
            "message": f"EXIT SIGHTED — ROOM {code}. TELL YOUR TEAM.",
        })

    async def _lock_player(self, player: Player, room: Room, door: str, message: str) -> None:
        player.locked = True
        self.log(player.id, "lockdown", {"door": door, "room": room.code, "message": message})
        await self.broadcast({
            "type": "lockdown", "player": player.id, "room_code": room.code,
            "door": door, "message": message,
        })
        await self.send(player, {
            "type": "door_result", "accepted": False, "locked": True,
            "door": door, "color": room.doors[door].color,
            "room_code": room.code, "message": message,
        })
        await self.broadcast_state()

    async def _strike_sealed_door(self, player: Player, room: Room, door: str) -> None:
        player.sealed_strikes += 1
        player.points -= 1
        self.log(player.id, "bump", {"door": door, "room": room.code})
        if player.sealed_strikes >= 2:
            await self._lock_player(
                player, room, door,
                "Two sealed doors in one round. You are locked in.",
            )
            if player.points <= 0:
                await self._eliminate(player, "Points drained by a sealed door")
            return
        await self.send(player, {
            "type": "door_result", "accepted": False, "door": door,
            "room_code": room.code, "message": "That door is sealed.",
        })
        if player.points <= 0:
            await self._eliminate(player, "Points drained by a sealed door")
            return
        await self.broadcast_state()

    async def open_door(self, player: Player, door=None, color=None) -> None:
        if self.status != "running" or player.escaped or player.eliminated:
            return
        if self.delay_puzzle and player.role == "decoder":
            await self.send(player, {
                "type": "error", "code": "decoder_busy",
                "message": "Answer the puzzle before moving through a door.",
            })
            return
        if player.locked:
            await self.send(player, {
                "type": "door_result", "accepted": False, "locked": True,
                "message": "You are locked. Two teammates must scan you free.",
            })
            return
        now = time.monotonic()
        if now - player.last_move < 0.08:
            return
        room = self.arena.room_by_id(player.room_id)
        if room is None:
            player.room_id = self.arena.start_room().rid
            return
        if color:
            door = next((d for d in DIRECTIONS
                         if room.doors[d].color == str(color).lower()), None)
        door = str(door or "").upper()
        if door not in DIRECTIONS:
            return
        if not self.arena.door_open(room, door) or room.doors[door].rolled_sealed:
            await self._strike_sealed_door(player, room, door)
            return
        target = self.arena.door_target(room, door)
        if target is None:
            return
        if target.rid == player.last_room_id and self.round == player.entered_round:
            await self.send(player, {
                "type": "door_result", "accepted": False, "door": door,
                "room_code": room.code,
                "message": "You cannot return through that door this round.",
            })
            return
        key = frozenset((room.rid, target.rid))
        existing = self.open_doors.get(key)
        if existing is not None and existing.expires_at > time.time():
            await self.send(player, {
                "type": "door_result", "accepted": False, "door": door,
                "room_code": room.code, "open_until": existing.expires_at,
                "message": "That doorway is already open.",
            })
            return
        player.last_move = now
        player.points -= DOOR_COST
        expires_at = time.time() + DOOR_OPEN_SECONDS
        self.open_doors[key] = TemporaryDoor(
            a_rid=room.rid, b_rid=target.rid, a_dir=door,
            b_dir=OPPOSITE[door], opened_by=player.id,
            expires_at=expires_at, cost=DOOR_COST,
        )
        self.log(player.id, "door_open", {
            "room": room.code, "target": target.code, "door": door,
        })
        public = {
            "type": "door_opened", "accepted": True, "player": player.id,
            "door": door, "color": room.doors[door].color,
            "cost": DOOR_COST, "open_until": expires_at,
            "message": f"Door open for {int(DOOR_OPEN_SECONDS)}s. Walk through.",
        }
        private = {**public, "room_code": room.code, "target_code": target.code}
        for other in list(self.players.values()):
            if not other.connected:
                continue
            if other.room_id in (room.rid, target.rid):
                await self.send(other, private)
            else:
                await self.send(other, public)
        for other in list(self.players.values()):
            if other.room_id in (room.rid, target.rid):
                await self._refresh_exit_visibility(other)
        if player.points <= 0:
            await self._eliminate(player, "Points spent to open a door")
            return
        await self.broadcast(self.players_message())
        await self.broadcast_state()

    async def cross_door(self, player: Player, door=None) -> None:
        if self.status != "running" or player.escaped or player.eliminated:
            return
        if self.delay_puzzle and player.role == "decoder":
            await self.send(player, {
                "type": "error", "code": "decoder_busy",
                "message": "Answer the puzzle before moving through a door.",
            })
            return
        if player.locked:
            await self.send(player, {
                "type": "door_result", "accepted": False, "locked": True,
                "message": "You are locked. Two teammates must scan you free.",
            })
            return
        now = time.monotonic()
        if now - player.last_move < 0.08:
            return
        room = self.arena.room_by_id(player.room_id)
        if room is None:
            player.room_id = self.arena.start_room().rid
            return
        door = str(door or "").upper()
        if door not in DIRECTIONS:
            return
        if not self.arena.door_open(room, door) or room.doors[door].rolled_sealed:
            await self._strike_sealed_door(player, room, door)
            return
        target = self.arena.door_target(room, door)
        if target is None:
            return
        temp = self.open_doors.get(frozenset((room.rid, target.rid)))
        if temp is None or temp.expires_at <= time.time():
            await self.send(player, {
                "type": "door_result", "accepted": False, "door": door,
                "room_code": room.code, "message": "That doorway is closed.",
            })
            return
        if target.rid == player.last_room_id and self.round == player.entered_round:
            await self.send(player, {
                "type": "door_result", "accepted": False, "door": door,
                "room_code": room.code,
                "message": "You cannot return through that door this round.",
            })
            return
        await self._complete_crossing(player, room, target, door)

    async def move(self, player: Player, door=None, color=None) -> None:
        await self.open_door(player, door=door, color=color)

    async def _complete_crossing(
        self, player: Player, room: ArenaRoom, target: ArenaRoom, door: str,
    ) -> None:
        player.last_room_id = room.rid
        player.last_door = door
        player.entered_round = self.round
        player.room_id = target.rid
        player.last_move = time.monotonic()
        self.log(player.id, "cross", {"room": target.code, "from": room.code, "door": door})

        await self._refresh_exit_visibility(player)

        await self.broadcast({
            "type": "room_entered", "player": player.id, "door": door,
            "cost": 0,
        })

        if fate.reveal(self.arena, target) and target.sanction:
            player.points -= target.sanction
            self.log(player.id, "hazard", {"penalty": target.sanction, "room": target.code})
            await self.broadcast({
                "type": "hazard", "player": player.id, "room_code": target.code,
                "penalty": target.sanction, "points": player.points,
            })
            self.pa = "A SANCTION ROOM DRAINS THE TEAM."
            self._recompute_sanctions()

        if player.points <= 0:
            await self._eliminate(player, "Points drained to zero")
            return

        await self._check_endings()
        for other in self.players.values():
            if other.id != player.id and other.connected and other.room_id == player.room_id:
                self.log(other.id, "followed", {"by": player.id})

        await self.broadcast(self.players_message())
        await self.broadcast_state()

    async def wait(self, player: Player) -> None:
        if self.status != "running" or player.eliminated or player.escaped:
            return
        player.points -= WAIT_COST
        player.waits += 1
        self.log(player.id, "wait", {"points": player.points})
        if player.points <= 0:
            await self._eliminate(player, "Points drained while waiting")
            return
        await self.broadcast(self.players_message())
        await self.broadcast_state()

    async def unlock(self, helper: Player, target_id) -> None:
        if self.status != "running" or helper.eliminated or helper.escaped:
            return
        target = self.players.get(str(target_id))
        if target is None or not target.locked:
            return
        target_room = self.arena.room_by_id(target.room_id)
        if target_room is None:
            target.locked = False
            return
        valid = {target.room_id}
        for _, nb in self.arena.neighbours(target_room):
            valid.add(nb.rid)
        helpers = [
            p for p in self.players.values()
            if p.connected and not p.eliminated and not p.escaped
            and p.id != target.id and p.room_id in valid
        ]
        if helper.id not in {h.id for h in helpers}:
            await self.send(helper, {
                "type": "error", "code": "not_adjacent",
                "message": "Stand in or beside the locked room to scan.",
            })
            return
        if len(helpers) < 2:
            await self.send(helper, {
                "type": "error", "code": "need_two",
                "message": "Two teammates must scan a locked player free.",
            })
            return
        spenders = helpers[:2]
        for h in spenders:
            h.points -= REVIVE_COST
        target.locked = False
        target.revives += 1
        self.log(target.id, "revive", {"by": [h.id for h in spenders]})
        for h in spenders:
            self.log(h.id, "unlock", {"target": target.id})
        await self.broadcast({
            "type": "revive", "player": target.id,
            "by": [h.id for h in spenders],
            "points": {h.id: h.points for h in spenders},
        })
        for h in spenders:
            if h.points <= 0:
                await self._eliminate(h, "Points spent to free a teammate")
        await self.broadcast(self.players_message())
        await self.broadcast_state()

    async def _eliminate(self, player: Player, reason: str) -> None:
        if player.eliminated:
            return
        player.eliminated = True
        player.locked = False
        player.points = max(0, player.points)
        self.log(player.id, "eliminated", {"reason": reason})
        await self.broadcast({"type": "elimination", "player": player.id, "reason": reason})
        await self.broadcast(self.players_message())
        await self._check_endings()

    async def _check_endings(self) -> None:
        if self.status != "running":
            return
        alive = self.alive()
        if not alive:
            await self.finish(won=False)
            return
        exit_room = self.arena.exit_room()
        in_exit = [p for p in alive if p.room_id == exit_room.rid]
        if len(in_exit) == len(alive):
            self.pa = "THE EXIT IS OPEN. THE TEAM ESCAPED."
            for p in alive:
                p.escaped = True
            await self.finish(won=True)

    async def _expire_match(self) -> None:
        if self.status != "running":
            return
        self.match_deadline = None
        self.next_round_at = None
        self.pa = "TIME EXPIRED. THE TEAM WAS ELIMINATED."
        living = [p for p in self.players.values() if not p.eliminated]
        for p in living:
            p.eliminated = True
            p.locked = False
            p.points = max(0, p.points)
            self.log(p.id, "eliminated", {"reason": "match timer expired"})
        await self.broadcast({"type": "time_up", "message": self.pa})
        for p in living:
            await self.broadcast({
                "type": "elimination", "player": p.id,
                "reason": "The match timer expired.",
            })
        await self.broadcast(self.players_message())
        await self.finish(won=False)

    # ---- prediction ----------------------------------------------------------
    async def predict(self, player: Player, msg: dict) -> None:
        if self.status != "running" or player.eliminated:
            return
        guess: dict = {}
        if msg.get("pattern_type"):
            guess["pattern_type"] = msg["pattern_type"]
        if msg.get("rooms"):
            guess["rooms"] = msg["rooms"]
        if msg.get("sigils"):
            guess["sigils"] = msg["sigils"]
        kb = KnowledgeBase()
        moved = self.last_shift.get("moved", [])
        scores = [kb.score_hypothesis(guess, e.rule, moved) for e in self.engines] or [0.0]
        score = max(scores)
        ok = score >= 0.5
        player.predictions += 1
        if ok:
            player.correct += 1
            player.streak += 1
            player.points += 1
            if self.next_round_at is not None:
                self.next_round_at += 2.0
        else:
            player.streak = 0
            player.points -= 1
            self.next_round_at = max(time.time() + 2,
                                     (self.next_round_at or time.time()) - 2.0)
        time_left = max(0.0, (self.next_round_at or time.time()) - time.time())
        self.log(player.id, "predict", {"guess": guess, "time_left": round(time_left, 2)})
        self.log(player.id, "predict_ok" if ok else "predict_bad", {"score": round(score, 2)})
        self.pa = ("CORRECT CALL. THE NEXT SHIFT IS DELAYED." if ok
                   else "THAT VISION MISSED. THE NEXT SHIFT COMES SOONER.")
        await self.send(player, {
            "type": "prediction_result", "correct": ok, "score": round(score, 2),
            "points": player.points, "message": self.pa,
        })
        if player.points <= 0:
            await self._eliminate(player, "Points lost to a failed prediction")
            return
        await self.broadcast_state()

    async def team_chat(self, player: Player, text) -> None:
        text = re.sub(r"[^\w \-.,!?']", "", str(text or ""))[:200]
        if text:
            self.log(player.id, "share", {"length": len(text)})
            await self.broadcast({"type": "chat", "from": player.name, "color": player.color,
                                  "text": text})
            await self.broadcast_admin()

    async def maybe_start(self) -> None:
        connected = [p for p in self.players.values() if p.connected]
        if (self.status == "lobby" and len(connected) >= self.min_players
                and all(p.ready for p in connected)):
            self.status = "running"
            self._audit_room()
            self.started_at = time.time()
            self.match_deadline = self.started_at + self.match_seconds
            self.round = 0
            self.dice = fate.roll_round(self.arena, self.rng)
            self.visions = fate.build_visions(self.arena, self.rng, 0)
            self.shift_seconds = self._roll_shift_seconds()
            self.next_round_at = time.time() + self.shift_seconds
            self.pa = "THE LAST ROOM IS OPEN. FIND THE HIDDEN EXIT."
            await self.broadcast_state()

    # ---- rounds -------------------------------------------------------------
    def step_round(self) -> dict:
        self.prev_arena = self.arena_public()
        if self.delay_puzzle is not None:
            puzzle_id = self.delay_puzzle["puzzle_id"]
            used = self.delay_attempts.get(self.stage, 0)
            self.delay_attempts[self.stage] = max(0, used - 1)
            self.delay_puzzle = None
            self.delay_deadline = None
            self.log(None, "delay_cancelled", {"puzzle_id": puzzle_id})
        for player in self.players.values():
            if player.wristband_revealed:
                player.wristband_revealed = False
                player.wristband_cooldown_until = time.time() + PATHFINDER_REVEAL_COOLDOWN
                self.log(player.id, "wristband_reveal_expired", {
                    "cooldown_seconds": PATHFINDER_REVEAL_COOLDOWN,
                })
        self.open_doors.clear()
        moved: list[dict] = []
        ops: list[dict] = []
        for engine in self.engines:
            res = engine.apply(self.arena)
            moved.extend(res["moved"])
            ops.extend(res["ops"])
        repairs = self.arena.ensure_connected()
        self.round += 1
        self.shift_delay_applied = 0.0
        self.shift_successes = 0
        self._audit_room()
        for player in self.players.values():
            player.sealed_strikes = 0
            if not player.eliminated and not player.escaped:
                self.log(player.id, "round", {"round": self.round})

        relief = self.dice_relief_rounds
        self.dice = fate.roll_round(self.arena, self.rng, relief=relief)
        if relief:
            self.dice_relief_rounds = max(0, relief - 1)
            self.log(None, "dice_relief", {"rounds": self.dice_relief_rounds})
        self.visions = fate.build_visions(self.arena, self.rng, self.round)
        self.last_shift = {
            "pattern_type": self.engines[0].rule.pattern_type if self.engines else None,
            "moved": moved, "ops": ops, "repairs": repairs,
        }

        self._maybe_advance_stage()
        self.nexus.extract(len(self.arena.rooms))
        self.nexus.cluster()
        solvable = self.arena.solvable() and reachable_after_changes(
            self.arena, self.engines, START_ROOM, None, horizon=3)
        action = self.nexus.decide(self.round, solvable, self.shift_seconds)
        self.nexus.commit_action(action)
        self._apply_director(action)
        self._recompute_sanctions()
        self.log(None, "round", {
            "round": self.round,
            "pattern_types": [e.rule.pattern_type for e in self.engines],
            "action": action["action"], "repairs": len(repairs),
            "duration": self.shift_seconds,
        })

        self.shift_seconds = self._roll_shift_seconds()
        self.next_round_at = time.time() + self.shift_seconds
        if repairs:
            self.pa = "THE GRID SHIFTED. THE DEALER REPAIRED A BREACH."
        elif moved:
            self.pa = f"ROUND {self.round}. THE GRID MOVES."
        else:
            self.pa = f"ROUND {self.round}. THE ROOMS HOLD."
        if self.round >= self.max_rounds:
            self._pending_finish = True

        return {
            "type": "round", "round": self.round,
            "pattern_type": self.last_shift["pattern_type"], "active": True,
            "moved": moved, "ops": ops, "arena": self.arena_public(),
            "players": self.players_public(), "next_round_in": self.shift_seconds,
            "dice": self.dice, "visions": self.visions,             "pa": self.pa,
        }

    def _apply_director(self, action: dict) -> None:
        self.pending_clues = []
        self.pending_nudges = []
        kind = action.get("action")
        if kind in ("raise_complexity", "lower_complexity"):
            delta = 1 if kind == "raise_complexity" else -1
            target = max(1, min(MAX_COMPLEXITY, self._puzzle_complexity() + delta))
            self.complexity_override = target
            self._load_stage()
            self.puzzle = self._new_puzzle()
            self.log(None, "complexity", {"level": target, "rules": len(self.engines)})
            self._audit_room()
        if kind == "raise_complexity":
            candidates = [
                (room, d) for room in self.arena.rooms for d in DIRECTIONS
                if self.arena.door_open(room, d)
            ]
            if candidates:
                room, d = self.rng.choice(candidates)
                room.doors[d].sealed = True
                self._director_seals.append((room.rid, d))
                self.arena.ensure_connected()
            self.pa = "THE DEALER SEALS A DOOR."
        elif kind == "lower_complexity":
            if self._director_seals:
                rid, d = self._director_seals.pop()
                room = self.arena.room_by_id(rid)
                if room is not None:
                    room.doors[d].sealed = False
                    self.arena.ensure_connected()
            self.pa = "THE DEALER OPENS A DOOR."
        elif kind == "add_hazard":
            candidates = [r for r in self.arena.rooms
                          if not self.arena.is_exit(r) and r.sanction == 0]
            if candidates:
                room = self.rng.choice(candidates)
                room.sanction = self.rng.choice([1, 2])
                room.revealed = False
                self._recompute_sanctions()
            self.pa = "THE DEALER SEEDS A SANCTION ROOM."
        elif kind == "lower_dice":
            self.dice_relief_rounds = DICE_RELIEF_ROUNDS
            self.log(None, "dice_relief", {"rounds": self.dice_relief_rounds})
            self.pa = "THE DEALER EASES THE DICE."
        elif kind == "give_clue":
            now = time.time()
            hidden = [r for r in self.arena.rooms if r.sanction and not r.revealed]
            for player in self.alive():
                if player.locked or player.escaped or not hidden:
                    continue
                room = self.arena.room_by_id(player.room_id)
                if room is None:
                    continue
                distances = []
                for target in hidden:
                    distance = self.arena.door_distance(room, target)
                    if distance is not None:
                        distances.append(distance)
                if not distances:
                    continue
                nearest = min(distances)
                tier = 1 if nearest == 2 else 2 if nearest == 1 else 0
                if not tier:
                    continue
                clue = self.nexus.make_clue(player.id, tier, now, self.stage)
                if clue:
                    self.pending_clues.append((player.id, clue))
            if self.round_override is None:
                self.round_seconds = min(26.0, self.round_seconds + 0.5)
            self.pa = "THE DEALER OFFERS A VISION."
        elif kind == "shift_information":
            available = [p.role for p in self.alive()]
            nudge = Nexus.role_nudge(self.round, available)
            target = next((p for p in self.alive() if p.role == nudge["role"]), None)
            if target is not None:
                puzzle_clue = (self.puzzle.hint(nudge["role"], level=1)
                               if self.puzzle and nudge["role"] in self.puzzle.domains else "")
                self.pending_nudges.append((target.id, {
                    "type": "dealer_nudge", "role": nudge["role"],
                    "text": nudge["text"], "puzzle": puzzle_clue,
                    "round": self.round,
                }))
                self.info_nudges[target.id] = self.info_nudges.get(target.id, 0) + 1
                self.log(None, "info_nudge", {"role": nudge["role"], "round": self.round})
            if self.round_override is None:
                self.round_seconds = min(26.0, self.round_seconds + 0.5)
            self.pa = "THE DEALER WHISPERS TO ONE ROLE."
        else:
            self.pa = "THE DEALER WATCHES."


    def _maybe_advance_stage(self) -> None:
        target = min(MAX_STAGE, 1 + self.round // 4)
        if target > self.stage:
            self.stage = target
            self._load_stage()
            self.puzzle = self._new_puzzle()
            self._audit_room()

    async def broadcast_round(self) -> None:
        payload = self.step_round()
        for p in list(self.players.values()):
            if not p.connected:
                continue
            await self._refresh_exit_visibility(p)
            room = self.arena.room_by_id(p.room_id)
            current = room.code if room else None
            view = filter_round(payload, p.role, self.prev_arena)
            view["state"] = self.snapshot(p)
            view["arena"] = filter_arena(payload["arena"], p.role, current)
            view["players"] = payload["players"]
            view["pa"] = self.pa
            if p.role == "timekeeper":
                view["next_round_in"] = payload["next_round_in"]
            await self.send(p, view)
        for player_id, clue in self.pending_clues:
            p = self.players.get(player_id)
            if p and p.connected and not p.eliminated:
                await self.send(p, {"type": "dealer_clue", **clue})
        self.pending_clues = []
        for player_id, nudge in self.pending_nudges:
            p = self.players.get(player_id)
            if p and p.connected and not p.eliminated:
                await self.send(p, nudge)
        self.pending_nudges = []
        await self.broadcast_admin(force=True)

    # ---- endings ------------------------------------------------------------
    async def finish(self, won: bool) -> None:
        self.status = "won" if won else "over"
        self._audit_room()
        self.next_round_at = None
        if won:
            for p in self.alive():
                p.escaped = True
                self.log(p.id, "escaped", {"round": self.round})
        duration = time.time() - self.started_at
        self.nexus.extract(len(self.arena.rooms))
        self.nexus.cluster()
        report = self.nexus.team_report()
        by_pid = {m["pid"]: m for m in report["players"]}
        summary = {
            "room": self.id, "seed": self.seed, "winner": int(won),
            "cycles": self.round, "rounds": self.round,
            "duration": round(duration, 1),
            "team_skill": report["team_skill"], "difficulty": report["difficulty"],
            "puzzle": self.knowledge.puzzle_metrics(),
            "eliminated": sum(1 for p in self.players.values() if p.eliminated),
            "players": [
                {
                    "name": p.name, "slot": p.slot, "uid": p.uid,
                    "verified": p.verified, "escaped": p.escaped,
                    "eliminated": p.eliminated, "points": p.points,
                    "revives": p.revives,
                    "predictions": p.predictions, "correct": p.correct,
                    "attrs": by_pid.get(p.id, {}).get("attrs", {}),
                    "style": by_pid.get(p.id, {}).get("style", ""),
                }
                for p in self.players.values()
            ],
        }
        try:
            await asyncio.to_thread(db.store.record_match, summary)
        except Exception:
            logger.exception("failed to persist match")
        self.log(None, "won" if won else "over", {"round": self.round})
        await self.broadcast({"type": "game_over", "won": won, "summary": summary,
                              "nexus": report})

    async def _loop(self) -> None:
        try:
            while self.players:
                await asyncio.sleep(0.2)
                self.purge_disconnected()
                if not any(p.connected for p in self.players.values()):
                    return
                await self.expire_open_doors()
                await self.broadcast_admin()
                if (self.status == "running" and self.match_deadline is not None
                        and time.time() >= self.match_deadline):
                    await self._check_endings()
                    if self.status == "running":
                        await self._expire_match()
                if (self.status == "running" and self.delay_puzzle is not None
                        and self.delay_deadline is not None
                        and time.time() >= self.delay_deadline):
                    await self._finish_delay(False)
                if self.status != "running":
                    continue
                if (self.status == "running" and self.next_round_at is not None
                        and time.time() >= self.next_round_at):
                    await self.broadcast_round()
                    if self._pending_finish:
                        self._pending_finish = False
                        await self.finish(won=False)
        except asyncio.CancelledError:
            pass
