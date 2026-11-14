"""Room and game state for THE LAST ROOM.

The server is authoritative. Clients send intents (choose a coloured door, wait,
unlock, predict, puzzle answer, chat, ready). The server validates them, applies
the round loop, rolls the d10 pedestal, resolves lockdowns/sanctions, asks The
Dealer for the next action, filters information per role and broadcasts.

Game loop
---------
round_start -> shift_grid -> roll_dice -> choose_doors -> resolve_lockdowns
-> resolve_sanctions -> dealer_action -> check_endings -> next_round
"""
from __future__ import annotations

import asyncio
import random
import re
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

from .arena import (
    DIRECTIONS,
    EXIT_ROOM,
    START_ROOM,
    STEP,
    Arena,
    Room as ArenaRoom,
    reachable_after_changes,
)
from .patterns import PatternEngine
from .stages import MAX_STAGE, rules_for_stage, stage_config
from .nexus import Nexus
from .knowledge import KnowledgeBase, PuzzleGenerator
from .roles import ROLES, filter_arena, filter_round, filter_snapshot, filter_visions, role_for_slot
from . import fate, db

MAX_PLAYERS = 4
COLORS = ["#e23b3b", "#3f7bd9", "#e8b53a", "#3f9f6b"]
INTENT_BUCKET = 0.5
INTENT_MAX = 14

START_POINTS = fate.START_POINTS
MAX_ROUNDS = fate.MAX_ROUNDS
DOOR_COST = fate.DOOR_COST
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
    escaped: bool = False
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
    waits: int = 0
    revives: int = 0
    last_room_id: str | None = None
    last_door: str | None = None
    entered_round: int = 0
    puzzle_inputs: dict = field(default_factory=dict)
    ws: WebSocket | None = field(default=None, repr=False)
    bucket_at: float = 0.0
    bucket_n: int = 0

    def public(self) -> dict:
        return {
            "id": self.id, "name": self.name, "slot": self.slot, "color": self.color,
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


class Room:
    def __init__(self, room_id: str, seed: int | None = None,
                 round_seconds: float | None = None, min_players: int = 1):
        self.id = room_id
        self.seed = seed if seed is not None else random.randrange(1 << 30)
        self.arena = Arena.generate(size=5, seed=self.seed)
        self.stage = 1
        cfg = stage_config(self.stage)
        self.round_override = round_seconds
        self.round_seconds = round_seconds or cfg["round_seconds"]
        self.min_players = min_players
        self.engines = [PatternEngine(r, self.arena.size)
                        for r in rules_for_stage(self.stage, self.seed)]
        self.nexus = Nexus(seed=self.seed)
        self.puzzle_gen = PuzzleGenerator(size=5)
        self.puzzle: dict | None = None
        self.players: dict[str, Player] = {}
        self.status = "lobby"  # lobby | running | won | over
        self.round = 0
        self.max_rounds = MAX_ROUNDS
        self.next_round_at: float | None = None
        self.events: list[dict] = []
        self.prev_arena: dict | None = None
        self.pa = "THE LAST ROOM. FIND THE FINAL DOOR."
        self.rng = random.Random(self.seed ^ 0x9E3779B9)
        self.dice: dict = {}
        self.visions: dict = {}
        self.last_shift: dict = {"pattern_type": None, "moved": [], "ops": [], "repairs": []}
        self._task: asyncio.Task | None = None
        self._counter = 0
        self._pending_finish = False
        self.started_at = time.time()

    # ---- stage / rules ---------------------------------------------------
    def _load_stage(self) -> None:
        cfg = stage_config(self.stage)
        self.engines = [PatternEngine(r, self.arena.size)
                        for r in rules_for_stage(self.stage, self.seed)]
        self.round_seconds = self.round_override if self.round_override is not None else cfg["round_seconds"]
        self.pa = f"STAGE {self.stage}: {cfg['name'].upper()}."

    # ---- helpers ----------------------------------------------------------
    def log(self, player_id: str | None, kind: str, data: dict | None = None) -> None:
        ev = {"t": time.time(), "player": player_id, "kind": kind, "data": data or {}}
        self.events.append(ev)
        if len(self.events) > 5000:
            del self.events[:1000]
        self.nexus.ingest(ev)

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
                doors[d] = {
                    "color": door.color,
                    "sealed": door.sealed,
                    "open": self.arena.door_open(room, d),
                    "capacity": door.capacity,
                    "roll": door.last_roll,
                }
        return {
            "id": p.id, "room_id": p.room_id,
            "room_code": room.code if room else None,
            "room": [room.bx, room.by] if room else None,
            "doors": doors, "locked": p.locked, "eliminated": p.eliminated,
            "escaped": p.escaped, "points": p.points, "role": p.role,
        }

    def snapshot(self, for_player: Player | None = None) -> dict:
        remaining = None
        if self.status == "running" and self.next_round_at is not None:
            remaining = max(0.0, self.next_round_at - time.time())
        role = for_player.role if for_player else "navigator"
        snap = {
            "room": self.id, "status": self.status, "round": self.round,
            "max_rounds": self.max_rounds,
            "stage": self.stage, "stage_name": stage_config(self.stage)["name"],
            "max_stage": MAX_STAGE,
            "arena": self.arena.to_public(), "players": self.players_public(),
            "you": self.you_public(for_player) if for_player else None,
            "next_round_in": remaining, "round_seconds": self.round_seconds,
            "min_players": self.min_players, "rule_count": len(self.engines),
            "nexus": self.nexus.team_report(), "pa": self.pa,
            "dice": self.dice, "futures": filter_visions(self.visions, role),
            "puzzle": self.puzzle_public(role) if (self.puzzle and for_player) else None,
            "exit_unsealed": self.arena.exit_unsealed,
        }
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

    # ---- lifecycle ----------------------------------------------------------
    async def join(self, ws: WebSocket, name: str, player_id: str | None = None) -> Player | None:
        if player_id and player_id in self.players:
            p = self.players[player_id]
            p.ws = ws
            p.connected = True
            if self.arena.room_by_id(p.room_id) is None:
                p.room_id = self.arena.start_room().rid
            self.log(p.id, "reconnect")
            await self.send(p, {"type": "welcome", "you": p.id, "state": self.snapshot(p)})
            await self.broadcast_state()
            return p
        if len(self.players) >= MAX_PLAYERS:
            return None
        used = {p.slot for p in self.players.values()}
        slot = next(i for i in range(MAX_PLAYERS) if i not in used)
        self._counter += 1
        pid = f"p{self._counter}"
        player = Player(pid, clean_name(name) or f"Player {slot + 1}", slot,
                        COLORS[slot], role_for_slot(slot), self.arena.start_room().rid, ws=ws)
        self.players[pid] = player
        self.log(pid, "join", {"role": player.role, "name": player.name})
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
        await self.broadcast_state()

    def purge_disconnected(self) -> None:
        dead = [pid for pid, p in self.players.items()
                if not p.connected and time.time() - getattr(p, "disconnected_at", time.time()) > 120]
        for pid in dead:
            self.players.pop(pid, None)

    # ---- input --------------------------------------------------------------
    async def handle(self, player: Player, msg: dict) -> None:
        now = time.monotonic()
        if not player.allow(now):
            await self.send(player, {"type": "error", "code": "rate_limited",
                                     "message": "Slow down."})
            return
        kind = msg.get("type")
        if kind in ("choose_door", "choose_gate"):
            await self.move(player, door=msg.get("door"), color=msg.get("color"))
        elif kind == "move":
            door = msg.get("door")
            if door is None and msg.get("dx") is not None:
                step = (msg.get("dx"), msg.get("dy"))
                door = next((d for d, s in STEP.items() if s == step), None)
            await self.move(player, door=door, color=msg.get("color"))
        elif kind == "wait":
            await self.wait(player)
        elif kind == "unlock":
            await self.unlock(player, msg.get("target"))
        elif kind == "predict":
            await self.predict(player, msg)
        elif kind == "puzzle_answer":
            await self.puzzle_answer(player, msg.get("choice"))
        elif kind == "clue_share":
            await self.clue_share(player, msg.get("role"), msg.get("text"))
        elif kind == "ready":
            player.ready = bool(msg.get("value"))
            await self.maybe_start()
        elif kind == "chat":
            await self.team_chat(player, msg.get("text"))
        elif kind == "ping":
            await self.send(player, {"type": "pong"})

    # ---- movement / doors ---------------------------------------------------
    async def move(self, player: Player, door=None, color=None) -> None:
        if self.status != "running" or player.escaped or player.eliminated:
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
        if not self.arena.door_open(room, door):
            await self.send(player, {
                "type": "door_result", "accepted": False, "door": door,
                "room_code": room.code, "message": "That door is sealed.",
            })
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
        accepted, remaining = self.arena.consume(room, door)
        if not accepted:
            player.locked = True
            self.log(player.id, "lockdown", {"door": door, "room": room.code})
            await self.broadcast({
                "type": "lockdown", "player": player.id, "room_code": room.code,
                "door": door,
                "message": "LOCKDOWN. Two teammates must scan the wristband.",
            })
            await self.send(player, {
                "type": "door_result", "accepted": False, "locked": True,
                "door": door, "color": room.doors[door].color, "remaining": 0,
                "room_code": room.code,
                "message": "The door is sealed. You are locked in.",
            })
            await self.broadcast_state()
            return

        player.last_room_id = room.rid
        player.last_door = door
        player.entered_round = self.round
        player.room_id = target.rid
        player.last_move = now
        player.points -= DOOR_COST
        self.log(player.id, "move", {"room": target.code, "from": room.code, "door": door})

        if fate.reveal(self.arena, target) and target.sanction:
            player.points -= target.sanction
            self.log(player.id, "hazard", {"penalty": target.sanction, "room": target.code})
            await self.broadcast({
                "type": "hazard", "player": player.id, "room_code": target.code,
                "penalty": target.sanction, "points": player.points,
            })
            self.pa = "A SANCTION ROOM DRAINS THE TEAM."

        await self.broadcast({
            "type": "door_result", "accepted": True, "player": player.id,
            "door": door, "color": room.doors[door].color, "remaining": remaining,
            "room_code": room.code, "target_code": target.code,
        })

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
            if self.arena.exit_unsealed:
                for p in alive:
                    p.escaped = True
                await self.finish(won=True)
            else:
                self.pa = "THE FINAL DOOR IS SEALED. SOLVE THE CIPHER."

    # ---- prediction / puzzle ------------------------------------------------
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
        self.log(player.id, "predict", {"guess": guess})
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

    async def puzzle_answer(self, player: Player, choice) -> None:
        if self.puzzle is None or type(choice) is not int:
            return
        ok = choice == self.puzzle["solution"]
        player.puzzle_inputs["answer"] = choice
        player.puzzle_inputs["correct"] = ok
        self.log(player.id, "puzzle_ok" if ok else "puzzle_step", {"choice": choice})
        if ok:
            self.arena.exit_unsealed = True
            self.puzzle = None
            self.pa = "FINAL DOOR UNSEALED. REACH A5."
            for p in self.players.values():
                if p.connected and not p.eliminated:
                    p.points += 2
                    p.puzzle_inputs.clear()
            await self.broadcast({"type": "exit_unsealed", "message": self.pa})
            await self._check_endings()
        await self.send(player, {
            "type": "puzzle_result", "correct": ok, "solved": ok,
            "message": "Accepted. The final door is open." if ok
            else "The cipher rejects that code.",
        })
        await self.broadcast_state()

    async def clue_share(self, player: Player, role, text) -> None:
        text = re.sub(r"[^\w \-.,!?']", "", str(text or ""))[:160]
        self.log(player.id, "share", {"text": text})
        await self.broadcast({"type": "team_note", "from": player.name, "role": role,
                              "text": text}, exclude=player.id)
        await self.send(player, {"type": "team_note_ack"})

    async def team_chat(self, player: Player, text) -> None:
        text = re.sub(r"[^\w \-.,!?']", "", str(text or ""))[:200]
        if text:
            await self.broadcast({"type": "chat", "from": player.name, "color": player.color,
                                  "text": text})

    async def maybe_start(self) -> None:
        connected = [p for p in self.players.values() if p.connected]
        if (self.status == "lobby" and len(connected) >= self.min_players
                and all(p.ready for p in connected)):
            self.status = "running"
            self.started_at = time.time()
            self.round = 0
            self.dice = fate.roll_round(self.arena, self.rng)
            self.visions = fate.build_visions(self.arena, self.rng, 0)
            self.next_round_at = time.time() + self.round_seconds
            self.pa = "THE LAST ROOM IS OPEN. FIND THE FINAL DOOR."
            if self.puzzle is None:
                self.puzzle = self._make_puzzle()
            await self.broadcast_state()

    # ---- rounds -------------------------------------------------------------
    def step_round(self) -> dict:
        self.prev_arena = self.arena.to_public()
        moved: list[dict] = []
        ops: list[dict] = []
        for engine in self.engines:
            res = engine.apply(self.arena)
            moved.extend(res["moved"])
            ops.extend(res["ops"])
        repairs = self.arena.ensure_connected()
        self.round += 1

        self.dice = fate.roll_round(self.arena, self.rng)
        self.visions = fate.build_visions(self.arena, self.rng, self.round)
        self.last_shift = {
            "pattern_type": self.engines[0].rule.pattern_type if self.engines else None,
            "moved": moved, "ops": ops, "repairs": repairs,
        }

        self._maybe_advance_stage()
        self.nexus.extract(len(self.arena.rooms))
        self.nexus.cluster()
        solvable = self.arena.solvable() and reachable_after_changes(
            self.arena, self.engines, START_ROOM, EXIT_ROOM, horizon=3)
        action = self.nexus.decide(self.round, solvable, self.round_seconds)
        self._apply_director(action)
        self.log(None, "round", {
            "round": self.round,
            "pattern_types": [e.rule.pattern_type for e in self.engines],
            "action": action["action"], "repairs": len(repairs),
        })

        self.next_round_at = time.time() + self.round_seconds
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
            "moved": moved, "ops": ops, "arena": self.arena.to_public(),
            "players": self.players_public(), "next_round_in": self.round_seconds,
            "dice": self.dice, "visions": self.visions, "pa": self.pa,
            "exit_unsealed": self.arena.exit_unsealed,
        }

    def _apply_director(self, action: dict) -> None:
        kind = action.get("action")
        if kind == "raise_complexity":
            candidates = [
                (room, d) for room in self.arena.rooms for d in DIRECTIONS
                if self.arena.door_open(room, d)
            ]
            if candidates:
                room, d = self.rng.choice(candidates)
                room.doors[d].sealed = True
                self.arena.ensure_connected()
            self.pa = "THE DEALER SEALS A DOOR."
        elif kind == "add_hazard":
            candidates = [r for r in self.arena.rooms
                          if not r.is_exit and r.sanction == 0]
            if candidates:
                room = self.rng.choice(candidates)
                room.sanction = self.rng.choice([1, 2])
                room.revealed = False
            self.pa = "THE DEALER SEEDS A SANCTION ROOM."
        elif kind == "lower_dice":
            for room in self.arena.rooms:
                for d in DIRECTIONS:
                    if self.arena.door_open(room, d):
                        room.doors[d].capacity = min(4, room.doors[d].capacity + 1)
            self.pa = "THE DEALER OPENS THE DOORS."
        elif kind in ("give_clue", "shift_information"):
            hidden = [r for r in self.arena.rooms if r.sanction and not r.revealed]
            if hidden and kind == "give_clue":
                self.rng.choice(hidden).revealed = True
            if self.round_override is None:
                self.round_seconds = min(26.0, self.round_seconds + 0.5)
            self.pa = "THE DEALER OFFERS A VISION."
        else:
            self.pa = "THE DEALER WATCHES."

    def _maybe_advance_stage(self) -> None:
        target = min(MAX_STAGE, 1 + self.round // 4)
        if target > self.stage:
            self.stage = target
            self._load_stage()

    def _make_puzzle(self) -> dict:
        p = self.puzzle_gen.generate_many(1, seeds=self.seed)[0]
        return {
            "question": p.question, "options": p.options,
            "solution": p.solution, "clues_by_role": p.clues,
        }

    def maybe_puzzle(self) -> None:
        if self.puzzle is None and self.status == "running" and not self.arena.exit_unsealed:
            self.puzzle = self._make_puzzle()

    async def broadcast_round(self) -> None:
        payload = self.step_round()
        for p in list(self.players.values()):
            if not p.connected:
                continue
            room = self.arena.room_by_id(p.room_id)
            current = room.code if room else None
            view = filter_round(payload, p.role, self.prev_arena)
            view["state"] = self.snapshot(p)
            view["puzzle"] = self.puzzle_public(p.role) if self.puzzle else None
            view["arena"] = filter_arena(payload["arena"], p.role, current)
            view["players"] = payload["players"]
            view["next_round_in"] = payload["next_round_in"]
            view["pa"] = self.pa
            if p.role == "timekeeper":
                view["dice"] = payload["dice"]
            else:
                view["dice"] = {current: payload["dice"].get(current, {})} if current else {}
            await self.send(p, view)

    def puzzle_public(self, role: str) -> dict | None:
        if not self.puzzle:
            return None
        return {
            "question": self.puzzle["question"],
            "options": self.puzzle["options"],
            "clues": self.puzzle["clues_by_role"].get(role, []),
        }

    # ---- endings ------------------------------------------------------------
    async def finish(self, won: bool) -> None:
        self.status = "won" if won else "over"
        self.next_round_at = None
        if won:
            for p in self.alive():
                p.escaped = True
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
            "eliminated": sum(1 for p in self.players.values() if p.eliminated),
            "players": [
                {
                    "name": p.name, "slot": p.slot, "escaped": p.escaped,
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
            db.store.record_match(summary)
        except Exception:
            pass
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
                if (self.status == "running" and self.next_round_at is not None
                        and time.time() >= self.next_round_at):
                    await self.broadcast_round()
                    if self._pending_finish:
                        self._pending_finish = False
                        await self.finish(won=False)
        except asyncio.CancelledError:
            pass
