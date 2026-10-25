"""Room and game state (WP3, tasks 21-28).

The server is authoritative: clients only send intents (move, predict, clue
fragment, ready). The server validates them, updates state, runs the pattern
engine on a timer, asks NEXUS for the next action, filters information per role
and broadcasts. It also handles disconnect/reconnect and rate limiting.
"""
from __future__ import annotations

import asyncio
import random
import re
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

from .maze import Maze, reachable_after_changes
from .patterns import PatternEngine
from .stages import MAX_STAGE, rules_for_stage, stage_config
from .nexus import Nexus
from .knowledge import PuzzleGenerator
from .roles import ROLES, filter_transition, filter_snapshot, role_for_slot
from . import db

MAX_PLAYERS = 4
COLORS = ["#ff4d6d", "#4dd2ff", "#ffd24d", "#7dff6b"]
MOVE_COOLDOWN = 0.08
INTENT_BUCKET = 0.5  # seconds
INTENT_MAX = 14  # intents allowed per bucket (rate limit, task 44)


def clean_name(name: str) -> str:
    return re.sub(r"[^\w \-]", "", name or "")[:16].strip()


@dataclass
class Player:
    id: str
    name: str
    slot: int
    color: str
    role: str
    x: int
    y: int
    escaped: bool = False
    ready: bool = False
    connected: bool = True
    disconnected_at: float = 0.0
    last_move: float = 0.0
    predictions: int = 0
    correct: int = 0
    streak: int = 0
    puzzle_inputs: dict = field(default_factory=dict)
    ws: WebSocket | None = field(default=None, repr=False)
    # rate limit state
    bucket_at: float = 0.0
    bucket_n: int = 0

    def public(self) -> dict:
        return {
            "id": self.id, "name": self.name, "slot": self.slot, "color": self.color,
            "role": self.role, "x": self.x, "y": self.y, "escaped": self.escaped,
            "ready": self.ready, "connected": self.connected,
            "correct": self.correct, "predictions": self.predictions, "streak": self.streak,
        }

    def allow(self, now: float) -> bool:
        if now - self.bucket_at > INTENT_BUCKET:
            self.bucket_at = now
            self.bucket_n = 0
        self.bucket_n += 1
        return self.bucket_n <= INTENT_MAX


class Room:
    def __init__(self, room_id: str, seed: int | None = None,
                 transition_seconds: float | None = None, min_players: int = 1):
        self.id = room_id
        self.seed = seed if seed is not None else random.randrange(1 << 30)
        self.maze = Maze.generate(size=3, seed=self.seed)
        self.stage = 1
        cfg = stage_config(self.stage)
        self.transition_seconds = transition_seconds or cfg["transition"]
        self.min_players = min_players
        self.engines = [PatternEngine(r) for r in rules_for_stage(self.stage, self.seed)]
        self.nexus = Nexus(seed=self.seed)
        self.puzzle_gen = PuzzleGenerator(size=3)
        self.puzzle: dict | None = None
        self.players: dict[str, Player] = {}
        self.status = "lobby"  # lobby | running | won
        self.cycle = 0
        self.next_transition_at: float | None = None
        self.events: list[dict] = []
        self.prev_maze: dict | None = None
        self.nexus_message: str = "NEXUS is watching."
        self._task: asyncio.Task | None = None
        self._counter = 0
        self.started_at = time.time()

    # ---- stage / rules ---------------------------------------------------
    def _load_stage(self) -> None:
        cfg = stage_config(self.stage)
        self.engines = [PatternEngine(r) for r in rules_for_stage(self.stage, self.seed)]
        self.transition_seconds = cfg["transition"]
        self.nexus_message = f"Stage {self.stage}: {cfg['name']}"

    # ---- helpers ----------------------------------------------------------
    def log(self, player_id: str | None, kind: str, data: dict | None = None) -> None:
        ev = {"t": time.time(), "player": player_id, "kind": kind, "data": data or {}}
        self.events.append(ev)
        if len(self.events) > 5000:
            del self.events[:1000]
        self.nexus.ingest(ev)

    def players_public(self) -> list[dict]:
        return [p.public() for p in self.players.values()]

    def players_message(self) -> dict:
        return {"type": "players", "status": self.status, "players": self.players_public()}

    def snapshot(self, for_player: Player | None = None) -> dict:
        remaining = None
        if self.status == "running" and self.next_transition_at is not None:
            remaining = max(0.0, self.next_transition_at - time.time())
        snap = {
            "room": self.id, "status": self.status, "cycle": self.cycle, "stage": self.stage,
            "stage_name": stage_config(self.stage)["name"], "max_stage": MAX_STAGE,
            "maze": self.maze.to_public(), "players": self.players_public(),
            "next_transition_in": remaining, "transition_seconds": self.transition_seconds,
            "min_players": self.min_players,
            "rule_count": len(self.engines),
            "nexus": self.nexus.team_report(),
            "nexus_message": self.nexus_message,
            "puzzle": self.puzzle_public(for_player.role) if (self.puzzle and for_player) else None,
        }
        role = for_player.role if for_player else "mover"
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
        # reconnect: match on id when provided
        if player_id and player_id in self.players:
            p = self.players[player_id]
            p.ws = ws
            p.connected = True
            p.x, p.y = self.maze.nearest_open(p.x, p.y)
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
        x, y = self.maze.start
        player = Player(pid, clean_name(name) or f"Player {slot + 1}", slot,
                        COLORS[slot], role_for_slot(slot), x, y, ws=ws)
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
        # keep the seat for reconnect; mark disconnected
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
        if kind == "move":
            await self.move(player, msg.get("dx"), msg.get("dy"))
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

    async def move(self, player: Player, dx, dy) -> None:
        if self.status != "running" or player.escaped:
            return
        if type(dx) is not int or type(dy) is not int:
            return
        if dx not in (-1, 0, 1) or dy not in (-1, 0, 1) or abs(dx) + abs(dy) != 1:
            return
        now = time.monotonic()
        if now - player.last_move < MOVE_COOLDOWN:
            return
        nx, ny = player.x + dx, player.y + dy
        if not self.maze.is_open(nx, ny):
            self.log(player.id, "bump", {"x": nx, "y": ny})
            return
        player.last_move = now
        player.x, player.y = nx, ny
        self.log(player.id, "move", {"x": nx, "y": ny})
        # Leadership signal: the team closing in on one player.
        for other in self.players.values():
            if other.id == player.id or not other.connected:
                continue
            if abs(other.x - nx) + abs(other.y - ny) <= 1:
                self.log(other.id, "followed", {"by": player.id})
        if (nx, ny) == self.maze.exit:
            player.escaped = True
            self.log(player.id, "escaped")
        if self.players and all(p.escaped for p in self.players.values() if p.connected):
            await self.finish(won=True)
        await self.broadcast(self.players_message())

    async def predict(self, player: Player, msg: dict) -> None:
        if self.status != "running":
            return
        guess = {
            "pattern_type": msg.get("pattern_type"),
            "symbols": msg.get("symbols") or [],
        }
        guess = {k: v for k, v in guess.items() if v}
        # Score against every active rule; the best match wins, so multi-rule
        # stages still reward a correct call.
        from .knowledge import KnowledgeBase
        kb = KnowledgeBase()
        scores = [kb.score_hypothesis(guess, e.rule) for e in self.engines] or [0.0]
        score = max(scores)
        ok = score >= 0.5
        player.predictions += 1
        if ok:
            player.correct += 1
            player.streak += 1
            self.next_transition_at = (self.next_transition_at or time.time()) + 3.0
        else:
            player.streak = 0
            self.next_transition_at = max(time.time() + 2, (self.next_transition_at or time.time()) - 3.0)
        self.log(player.id, "predict", {"guess": guess})
        self.log(player.id, "predict_ok" if ok else "predict_bad", {"score": round(score, 2)})
        self.nexus_message = ("Correct call. The change is delayed." if ok
                             else "That prediction missed. Change comes sooner.")
        await self.send(player, {"type": "prediction_result", "correct": ok,
                                 "score": round(score, 2),
                                 "message": self.nexus_message})
        await self.broadcast_state()

    async def puzzle_answer(self, player: Player, choice) -> None:
        if self.puzzle is None or type(choice) is not int:
            return
        ok = choice == self.puzzle["solution"]
        connected = [p for p in self.players.values() if p.connected]
        if ok:
            player.puzzle_inputs["answer"] = choice
            player.puzzle_inputs["correct"] = True
        else:
            player.puzzle_inputs["answer"] = choice
            player.puzzle_inputs["correct"] = False
        self.log(player.id, "puzzle_ok" if ok else "puzzle_step", {"choice": choice})
        # The puzzle clears when every connected player has answered and at least
        # one of them was correct.
        all_answered = all("answer" in p.puzzle_inputs for p in connected)
        any_correct = any(p.puzzle_inputs.get("correct") for p in connected)
        if all_answered and any_correct:
            self.puzzle = None
            self.nexus_message = "Cooperative puzzle solved. The labyrinth opens."
            for p in connected:
                p.puzzle_inputs.clear()
            self.next_transition_at = (self.next_transition_at or time.time()) + 5.0
        await self.send(player, {"type": "puzzle_result", "correct": ok})
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
            self.next_transition_at = time.time() + self.transition_seconds
            self.nexus_message = "The labyrinth is awake."
            await self.broadcast_state()

    # ---- transitions ---------------------------------------------------------
    def step_transition(self) -> dict:
        self.prev_maze = self.maze.to_public()
        # Remember a guaranteed route before the labyrinth rearranges itself.
        sb = (self.maze.start[0] // 5, self.maze.start[1] // 5)
        eb = (self.maze.exit[0] // 5, self.maze.exit[1] // 5)
        safe_path = self.maze.block_path(sb, eb)
        moved: list[dict] = []
        for engine in self.engines:
            res = engine.apply(self.maze)
            moved.extend(res["moved"])
        self.cycle += 1
        # Solvability fallback (O6): if the change would strand the team, re-open
        # the corridor along the last known good route instead of a dead end.
        repaired = False
        if not self.maze.solvable() and safe_path:
            self.maze.ensure_corridor(safe_path)
            repaired = True
        for p in self.players.values():
            if not self.maze.is_open(p.x, p.y):
                p.x, p.y = self.maze.nearest_open(p.x, p.y)
        # Time-expanded reachability: the exit must remain reachable across the
        # next few changes as well.
        solvable = self.maze.solvable() and reachable_after_changes(
            self.maze, self.engines, self.maze.start, self.maze.exit, horizon=3)
        self._maybe_advance_stage()
        # Refresh the director's read of the team before it decides, so the
        # action it takes is based on how the players are actually performing.
        self.nexus.extract(self.maze.tile_size * self.maze.tile_size)
        self.nexus.cluster()
        # Ask NEXUS for the next action and let it influence timing.
        action = self.nexus.decide(self.cycle, solvable, self.transition_seconds)
        cfg = stage_config(self.stage)
        adapt = cfg["adapt"]
        if action["action"] == "raise_complexity" and adapt > 0.3:
            self.transition_seconds = max(8.0, self.transition_seconds - 0.5 * adapt)
            self.nexus_message = "NEXUS tightens the pattern."
        elif action["action"] in ("give_clue", "shift_information"):
            self.transition_seconds = min(20.0, self.transition_seconds + 0.5)
            self.nexus_message = "NEXUS offers a clue."
        self.next_transition_at = time.time() + self.transition_seconds
        self.log(None, "transition", {"cycle": self.cycle,
                                      "pattern_types": [e.rule.pattern_type for e in self.engines],
                                      "action": action["action"], "repaired": repaired})
        if repaired:
            self.nexus_message = "NEXUS sealed a breach in the labyrinth."
        return {
            "type": "transition", "cycle": self.cycle,
            "moved": moved, "maze": self.maze.to_public(), "players": self.players_public(),
            "next_transition_in": self.transition_seconds,
            "pattern_type": self.engines[0].rule.pattern_type if self.engines else None,
            "active": True,
        }

    def _maybe_advance_stage(self) -> None:
        # advance one stage every 8 transitions, up to the final stage.
        target = min(MAX_STAGE, 1 + self.cycle // 8)
        if target > self.stage:
            self.stage = target
            self._load_stage()

    def maybe_puzzle(self) -> None:
        """Introduce a cooperative puzzle in later stages."""
        if self.stage >= 3 and self.puzzle is None and self.cycle and self.cycle % 6 == 0:
            p = self.puzzle_gen.generate_many(1, seeds=self.seed + self.cycle)[0]
            self.puzzle = {"question": p.question, "options": p.options,
                           "solution": p.solution, "clues_by_role": p.clues}

    async def broadcast_transition(self) -> None:
        payload = self.step_transition()
        self.maybe_puzzle()
        # Per-role filtering (O3): each player gets the shared snapshot plus a
        # role-specific view of what moved.
        for p in list(self.players.values()):
            if not p.connected:
                continue
            view = filter_transition(payload, p.role, self.prev_maze)
            view["state"] = self.snapshot(p)
            view["puzzle"] = self.puzzle_public(p.role) if self.puzzle else None
            view["nexus_message"] = self.nexus_message
            view["maze"] = payload["maze"]
            view["players"] = payload["players"]
            view["next_transition_in"] = payload["next_transition_in"]
            await self.send(p, view)

    def puzzle_public(self, role: str) -> dict | None:
        if not self.puzzle:
            return None
        return {"question": self.puzzle["question"], "options": self.puzzle["options"],
                "clues": self.puzzle["clues_by_role"].get(role, [])}

    async def finish(self, won: bool) -> None:
        self.status = "won" if won else "over"
        self.next_transition_at = None
        duration = time.time() - self.started_at
        self.nexus.extract(self.maze.tile_size * self.maze.tile_size)
        self.nexus.cluster()
        report = self.nexus.team_report()
        by_pid = {m["pid"]: m for m in report["players"]}
        summary = {
            "room": self.id, "seed": self.seed, "winner": int(won), "cycles": self.cycle,
            "duration": round(duration, 1), "team_skill": report["team_skill"],
            "difficulty": report["difficulty"],
            "players": [
                {
                    "name": p.name, "slot": p.slot, "escaped": p.escaped,
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
        self.log(None, "won" if won else "over", {"cycle": self.cycle})
        await self.broadcast({"type": "game_over", "won": won, "summary": summary,
                              "nexus": report})

    async def _loop(self) -> None:
        try:
            while self.players:
                await asyncio.sleep(0.2)
                self.purge_disconnected()
                if (self.status == "running" and self.next_transition_at is not None
                        and time.time() >= self.next_transition_at):
                    await self.broadcast_transition()
        except asyncio.CancelledError:
            pass
