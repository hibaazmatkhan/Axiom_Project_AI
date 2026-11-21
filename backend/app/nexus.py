"""AXIOM NEXUS AI Director (WP6, tasks 36-41).

NEXUS reads the raw event log, extracts features per player, maintains a
six-attribute player model (O5), clusters behaviour, and selects an action each
cycle with a utility function: raise complexity, give a clue, shift a player's
information, or hold. It also exposes tune() for simulated teams so adaptation
can be validated without real players (task 41).

Feature extraction is numpy-based; behaviour clustering uses scikit-learn
KMeans with a fixed random_state so runs are reproducible. Classification
labels a play style from the centroid it lands nearest.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sklearn.cluster import KMeans

from .roles import ROLES

ATTRIBUTES = ("exploration", "risk", "cooperation", "pattern", "puzzle", "leadership")
PLAY_STYLES = ("Scout", "Gambler", "Anchor", "Analyst", "Solver", "Pathfinder")
STYLE_PROTOTYPES = np.array([
    [0.9, 0.2, 0.2, 0.2, 0.2, 0.2],
    [0.2, 0.9, 0.2, 0.2, 0.2, 0.2],
    [0.2, 0.2, 0.9, 0.2, 0.2, 0.2],
    [0.2, 0.2, 0.2, 0.9, 0.2, 0.2],
    [0.2, 0.2, 0.2, 0.2, 0.9, 0.2],
    [0.2, 0.2, 0.2, 0.2, 0.2, 0.9],
], dtype=float)

# Attributes that reflect real competence (used for team skill). Risk is a
# style signal, not a skill signal, so it is excluded.
SKILL_ATTRS = ("pattern", "puzzle", "cooperation", "exploration", "leadership")

# Neutral prior used when an attribute has not been observed yet. Without it a
# brand new team would score 0.0 and the director would always hand out clues.
PRIOR = 0.5

CLUE_PLAYER_COOLDOWN = 45.0
CLUE_TEAM_COOLDOWN = 20.0
CLUE_MAX_PER_STAGE = 6
CLUE_BASE_CHANCE = 0.60
CLUE_LOW_SKILL = 0.40
CLUE_HIGH_SKILL = 0.70
CLUE_SKILL_MODIFIER = 0.20
CLUE_MIN_CHANCE = 0.20
CLUE_MAX_CHANCE = 0.90
CLUE_TIERS = {
    1: (
        "A sanction waits somewhere close to your room.",
        "The Dealer senses a costly room nearby.",
        "Trouble is in the air a short walk from here.",
    ),
    2: (
        "A sanction sits just beyond this room.",
        "The next doorway leads to a sanction.",
        "A sanction is right next door. Choose carefully.",
    ),
}

DIRECTOR_ACTIONS = (
    "raise_complexity",
    "lower_complexity",
    "add_hazard",
    "give_clue",
    "lower_dice",
    "shift_information",
    "hold",
)
ACTION_DIFFICULTY_DELTA = {
    "raise_complexity": 0.2,
    "lower_complexity": -0.15,
    "add_hazard": 0.15,
    "give_clue": -0.12,
    "lower_dice": -0.2,
    "shift_information": -0.1,
    "hold": 0.0,
}
MIN_COMPLEXITY = 1
MAX_COMPLEXITY = 3
DICE_RELIEF_ROUNDS = 2
ROLE_NUDGES = {
    "pathfinder": "Pathfinder: reveal the wristband map before calling a route.",
    "watcher": "Watcher: warn the team before the KING'S first room is revealed.",
    "timekeeper": "Timekeeper: call the countdown before the next shift.",
    "decoder": "Decoder: solve the puzzle with the key the Timekeeper passes you.",
}
UTILITY_WEIGHTS = {
    "skill_fit": 0.45,
    "progress": 0.2,
    "cooperation_balance": 0.15,
    "frustration": 0.2,
}
TARGET_BAND_HALF_WIDTH = 0.2
STUCK_THRESHOLD = 2.0


def commit_bounded_action(director: Any, action: str) -> None:
    delta = ACTION_DIFFICULTY_DELTA.get(action, 0.0)
    director.difficulty = float(max(-1.0, min(1.0, director.difficulty + delta)))
    level = int(getattr(director, "complexity_level", MIN_COMPLEXITY))
    if action == "raise_complexity":
        director.complexity_level = min(MAX_COMPLEXITY, max(MIN_COMPLEXITY, level) + 1)
    elif action == "lower_complexity":
        director.complexity_level = max(MIN_COMPLEXITY, level - 1)


def band_error(team_skill: float, difficulty: float) -> float:
    target = max(-0.8, min(0.8, (team_skill - 0.5) * 1.2))
    low = max(-1.0, target - TARGET_BAND_HALF_WIDTH)
    high = min(1.0, target + TARGET_BAND_HALF_WIDTH)
    if difficulty < low:
        return float(low - difficulty)
    if difficulty > high:
        return float(difficulty - high)
    return 0.0


@dataclass
class PlayerModel:
    pid: str
    name: str = ""
    attrs: dict[str, float] = field(default_factory=lambda: {a: 0.0 for a in ATTRIBUTES})
    style: str = "Scout"
    moves: int = 0
    predictions: int = 0
    correct: int = 0
    wrong: int = 0
    prediction_streak: int = 0
    best_prediction_streak: int = 0
    stuck_seconds: float = 0.0
    last_action_at: float | None = None
    late_actions: int = 0
    shares: int = 0
    bumps: int = 0
    follows: int = 0
    waits: int = 0
    gate_blocks: int = 0
    unlocks: int = 0
    hazards: int = 0
    rounds_survived: int = 0
    puzzle_attempts: int = 0
    puzzle_correct: int = 0
    escaped: bool = False
    distinct_tiles: set = field(default_factory=set)
    distinct_rooms: set = field(default_factory=set)

    def note_action(self, now: float) -> None:
        if self.last_action_at is not None:
            gap = max(0.0, now - self.last_action_at)
            if gap >= STUCK_THRESHOLD:
                self.stuck_seconds += min(gap, 30.0)
        self.last_action_at = now

    def vector(self) -> np.ndarray:
        return np.array([self.attrs[a] for a in ATTRIBUTES], dtype=float)

    def update_derived(self, total_maze_tiles: int) -> None:
        """Recompute the six attributes from raw counters.

        Idempotent: safe to call every cycle without drifting.
        """
        # Exploration: how much of the labyrinth the player has uncovered,
        # relative to a good-play coverage of 35% of the tiles.
        if self.moves:
            covered = len(self.distinct_rooms) if self.distinct_rooms else len(self.distinct_tiles)
            coverage = covered / max(1, total_maze_tiles)
            self.attrs["exploration"] = min(1.0, coverage / 0.35)
        else:
            self.attrs["exploration"] = PRIOR

        if self.moves:
            late_rate = min(0.3, self.late_actions / max(1, self.predictions) * 0.3)
            self.attrs["risk"] = min(1.0, self.bumps / max(1, self.moves) + late_rate)
        else:
            self.attrs["risk"] = PRIOR

        # Cooperation: sharing information and freeing locked teammates.
        cooperative_acts = self.shares + self.unlocks * 2
        self.attrs["cooperation"] = min(1.0, cooperative_acts / 3.0) if cooperative_acts else PRIOR

        if self.predictions:
            accuracy = self.correct / self.predictions
            streak_bonus = min(0.2, self.best_prediction_streak * 0.05)
            self.attrs["pattern"] = min(1.0, accuracy + streak_bonus)
            error_penalty = min(0.3, self.wrong * 0.05)
            self.attrs["puzzle"] = min(1.0, max(0.0, accuracy - error_penalty + streak_bonus))
        else:
            self.attrs["pattern"] = PRIOR
            self.attrs["puzzle"] = PRIOR
        if self.puzzle_attempts:
            self.attrs["puzzle"] = min(1.0, self.puzzle_correct / self.puzzle_attempts)

        # Leadership: how often the team clusters around this player.
        self.attrs["leadership"] = min(1.0, self.follows / 3.0) if self.follows else PRIOR

    def skill(self) -> float:
        """Composite competence score for this player."""
        return float(np.mean([self.attrs[a] for a in SKILL_ATTRS]))

    def public(self) -> dict:
        return {"pid": self.pid, "name": getattr(self, "name", ""), "style": self.style,
                "attrs": {k: round(v, 3) for k, v in self.attrs.items()},
                "predictions": self.predictions, "correct": self.correct,
                "wrong": self.wrong, "prediction_streak": self.prediction_streak,
                "puzzle_attempts": self.puzzle_attempts,
                "puzzle_correct": self.puzzle_correct,
                "stuck_seconds": round(self.stuck_seconds, 3)}


class Nexus:
    """The AI Director."""

    def __init__(self, seed: int = 0):
        self.rng = np.random.default_rng(seed)
        self.models: dict[str, PlayerModel] = {}
        self.events: list[dict] = []
        self.team_skill = 0.5
        self.difficulty = 0.0  # -1 easy .. +1 hard
        self.complexity_level = MIN_COMPLEXITY
        self.last_action: dict | None = None
        self.log: list[dict] = []
        self._centroids: np.ndarray | None = None
        self._last_clue_at: float | None = None
        self._last_clue_by_player: dict[str, float] = {}
        self._clue_stage = 0
        self._clues_this_stage = 0
        self.clue_count = 0
        self.puzzle_generated = 0
        self.puzzle_attempts = 0
        self.puzzle_solved = 0
        self.puzzle_difficulty = "easy"
        self.puzzle_complexity = 1
        self.info_nudges = 0
        self.dice_relief_rounds = 0

    # ---- event ingestion -------------------------------------------------
    def ingest(self, event: dict) -> None:
        self.events.append(event)
        if len(self.events) > 8000:
            del self.events[:2000]
        kind = event.get("kind")
        data = event.get("data", {})
        if kind == "puzzle_generated":
            self.puzzle_generated += 1
            self.puzzle_difficulty = str(data.get("difficulty", "easy"))
            try:
                self.puzzle_complexity = max(MIN_COMPLEXITY, min(MAX_COMPLEXITY,
                                                                 int(data.get("complexity", 1))))
            except (TypeError, ValueError):
                self.puzzle_complexity = 1
            return
        if kind in ("puzzle_attempt", "puzzle_solved"):
            self.puzzle_attempts += 1
            correct = kind == "puzzle_solved" or bool(data.get("correct"))
            if correct:
                self.puzzle_solved += 1
            pid = event.get("player")
            model = self.models.get(pid) if pid else None
            if model is not None:
                model.puzzle_attempts += 1
                if correct:
                    model.puzzle_correct += 1
            return
        if kind == "info_nudge":
            self.info_nudges += 1
            return
        if kind == "dice_relief":
            try:
                self.dice_relief_rounds = max(0, min(DICE_RELIEF_ROUNDS,
                                                    int(data.get("rounds", 0))))
            except (TypeError, ValueError):
                self.dice_relief_rounds = 0
            return
        pid = event.get("player")
        if not pid:
            return
        m = self.models.get(pid)
        if m is None:
            m = self.models[pid] = PlayerModel(pid)
        try:
            now = float(event.get("t", time.time()))
        except (TypeError, ValueError):
            now = time.time()

        def add_room(value) -> None:
            if value is None:
                return
            if isinstance(value, (list, tuple)):
                m.distinct_rooms.add(tuple(value))
            else:
                m.distinct_rooms.add(str(value))

        active_kinds = {
            "join", "move", "cross", "door_open", "bump", "gate_blocked",
            "lockdown", "wait", "unlock", "hazard", "predict", "predict_ok",
            "predict_bad", "share", "followed", "escaped",
        }
        if kind in active_kinds:
            m.note_action(now)
        if kind == "join":
            if data.get("name"):
                m.name = data["name"]
        elif kind == "move":
            m.moves += 1
            if data.get("x") is not None and data.get("y") is not None:
                m.distinct_tiles.add((data.get("x"), data.get("y")))
            add_room(data.get("room"))
        elif kind == "cross":
            m.moves += 1
            add_room(data.get("room"))
            add_room(data.get("from"))
        elif kind == "bump":
            m.bumps += 1
        elif kind in ("gate_blocked", "lockdown"):
            m.gate_blocks += 1
        elif kind == "wait":
            m.waits += 1
        elif kind == "unlock":
            m.unlocks += 1
        elif kind == "hazard":
            m.hazards += 1
        elif kind == "round":
            m.rounds_survived += 1
        elif kind == "predict":
            m.predictions += 1
            time_left = data.get("time_left")
            if data.get("late") or (time_left is not None and time_left < 2.0):
                m.late_actions += 1
        elif kind == "predict_ok":
            m.correct += 1
            m.predictions = max(m.predictions, 1)
            m.prediction_streak += 1
            m.best_prediction_streak = max(m.best_prediction_streak, m.prediction_streak)
        elif kind == "predict_bad":
            m.wrong += 1
            m.predictions = max(m.predictions, 1)
            m.prediction_streak = 0
        elif kind == "share":
            m.shares += 1
        elif kind == "followed":
            m.follows += 1
        elif kind == "escaped":
            m.escaped = True

    # ---- feature extraction / team skill ---------------------------------
    def extract(self, total_maze_tiles: int) -> None:
        for m in self.models.values():
            m.update_derived(total_maze_tiles)
        if self.models:
            self.team_skill = float(np.mean([m.skill() for m in self.models.values()]))

    def target_difficulty(self) -> float:
        value = (self.team_skill - 0.5) * 1.2
        return float(max(-0.8, min(0.8, value)))

    def difficulty_error_at(self, difficulty: float) -> float:
        return band_error(self.team_skill, difficulty)

    def difficulty_fit_error(self) -> float:
        return self.difficulty_error_at(self.difficulty)

    def team_progress(self) -> float:
        if not self.models:
            return 0.0
        streak = max(m.best_prediction_streak for m in self.models.values())
        return float(min(1.0, streak / 4.0))

    def cooperation_balance(self) -> float:
        if len(self.models) < 2:
            return 0.5
        values = np.array([m.attrs["cooperation"] for m in self.models.values()], dtype=float)
        mean = float(np.mean(values))
        spread = float(np.std(values))
        return float(max(0.0, min(1.0, mean * (1.0 - spread))))

    def frustration(self) -> float:
        if not self.models:
            return 0.0
        stuck = float(np.mean([m.stuck_seconds for m in self.models.values()]))
        predictions = sum(m.predictions for m in self.models.values())
        wrong = sum(m.wrong for m in self.models.values())
        wrong_rate = wrong / max(1, predictions)
        return float(max(0.0, min(1.0, 0.6 * min(1.0, stuck / 8.0) + 0.4 * wrong_rate)))

    def utility_terms(self, action: str) -> dict:
        delta = ACTION_DIFFICULTY_DELTA.get(action, 0.0)
        current_error = self.difficulty_error_at(self.difficulty)
        next_difficulty = max(-1.0, min(1.0, self.difficulty + delta))
        next_error = self.difficulty_error_at(next_difficulty)
        skill_fit = (current_error - next_error) / TARGET_BAND_HALF_WIDTH
        if action == "hold" and current_error == 0.0:
            skill_fit += 0.5
        balance = self.cooperation_balance()
        frustration = self.frustration()
        if action in ("give_clue", "shift_information", "hold"):
            cooperation = 0.2 + (1.0 - balance) * 0.6
        else:
            cooperation = 0.2 + balance * 0.6
        if delta > 0:
            frustration_term = -frustration
        elif delta < 0:
            frustration_term = frustration * 0.6
        else:
            frustration_term = frustration * 0.2
        if action == "give_clue":
            frustration_term += frustration * 0.25
        return {
            "skill_fit": skill_fit,
            "progress": delta * (self.team_progress() - 0.5),
            "cooperation_balance": cooperation,
            "frustration": frustration_term,
        }

    def clue_chance(self, skill: float | None = None) -> float:
        value = self.team_skill if skill is None else skill
        chance = CLUE_BASE_CHANCE
        if value < CLUE_LOW_SKILL:
            chance += CLUE_SKILL_MODIFIER
        elif value > CLUE_HIGH_SKILL:
            chance -= CLUE_SKILL_MODIFIER
        return float(max(CLUE_MIN_CHANCE, min(CLUE_MAX_CHANCE, chance)))

    def clue_allowed(self, player_id: str, now: float, stage: int) -> bool:
        if stage != self._clue_stage:
            self._clue_stage = stage
            self._clues_this_stage = 0
        if self._clues_this_stage >= CLUE_MAX_PER_STAGE:
            return False
        if self._last_clue_at is not None and now - self._last_clue_at < CLUE_TEAM_COOLDOWN:
            return False
        last = self._last_clue_by_player.get(player_id)
        if last is not None and now - last < CLUE_PLAYER_COOLDOWN:
            return False
        return True

    def note_clue(self, player_id: str, now: float, stage: int) -> None:
        if stage != self._clue_stage:
            self._clue_stage = stage
            self._clues_this_stage = 0
        self._last_clue_at = now
        self._last_clue_by_player[player_id] = now
        self._clues_this_stage += 1
        self.clue_count += 1

    def make_clue(self, player_id: str, tier: int, now: float, stage: int,
                  skill: float | None = None) -> dict | None:
        level = int(tier)
        phrases = CLUE_TIERS.get(level)
        if not phrases or not self.clue_allowed(player_id, now, stage):
            return None
        if self.rng.random() > self.clue_chance(skill):
            return None
        self.note_clue(player_id, now, stage)
        return {"tier": level, "text": str(self.rng.choice(phrases))}

    def cluster(self) -> None:
        """scikit-learn KMeans over player vectors; label nearest style."""
        if len(self.models) < 2:
            for m in self.models.values():
                m.style = "Scout"
            self._centroids = None
            return
        X = np.vstack([m.vector() for m in self.models.values()])
        k = min(len(PLAY_STYLES), len(X), len(np.unique(X, axis=0)))
        # Deterministic, spread-out initial centres; fixed random_state below.
        idx = np.linspace(0, len(X) - 1, k).astype(int)
        init = X[idx].copy()
        model = KMeans(n_clusters=k, init=init, n_init=1, max_iter=25,
                       random_state=0)
        labels = model.fit_predict(X)
        self._centroids = model.cluster_centers_
        label_to_style: dict[int, str] = {}
        used: set[int] = set()
        for label, centroid in enumerate(model.cluster_centers_):
            distances = [
                (index, float(np.sum((centroid - prototype) ** 2)))
                for index, prototype in enumerate(STYLE_PROTOTYPES)
                if index not in used
            ]
            best = min(distances, key=lambda item: item[1])[0]
            used.add(best)
            label_to_style[label] = PLAY_STYLES[best]
        for m, lab in zip(self.models.values(), labels):
            m.style = label_to_style.get(int(lab), PLAY_STYLES[0])

    # ---- utility-based decision making -----------------------------------
    def decide(self, cycle: int, solvable: bool, cycle_time_left: float) -> dict:
        candidates: dict[str, float] = {}
        terms_by_action: dict[str, dict] = {}
        for name in DIRECTOR_ACTIONS:
            terms = self.utility_terms(name)
            terms_by_action[name] = terms
            score = sum(UTILITY_WEIGHTS[key] * terms[key] for key in UTILITY_WEIGHTS)
            if not solvable:
                if name in ("raise_complexity", "add_hazard"):
                    score -= 2.0
                elif name == "give_clue":
                    score += 2.0
                elif name == "shift_information":
                    score += 1.4
                elif name in ("lower_dice", "lower_complexity"):
                    score += 1.2
            if name == "raise_complexity" and self.complexity_level >= MAX_COMPLEXITY:
                score -= 1.5
            if name == "lower_complexity" and self.complexity_level <= MIN_COMPLEXITY:
                score -= 1.5
            if cycle_time_left < 2.0 and name in ("raise_complexity", "add_hazard"):
                score -= 0.1
            candidates[name] = score + float(self.rng.normal(0, 0.01))

        action = max(candidates, key=candidates.get)
        self.last_action = {"action": action, "utility": round(candidates[action], 3),
                            "alternatives": {k: round(v, 3) for k, v in candidates.items()},
                            "terms": {k: round(v, 3) for k, v in terms_by_action[action].items()}}
        if action == "lower_dice":
            self.last_action["dice_relief"] = {"rounds": DICE_RELIEF_ROUNDS}
        if action == "shift_information":
            self.last_action["nudge"] = self.role_nudge(cycle, ROLES)
        self.log.append({"cycle": cycle, **self.last_action})
        return self.last_action

    def apply_action_effects(self, action: str) -> None:
        if action == "raise_complexity":
            self.complexity_level = min(MAX_COMPLEXITY,
                                        max(MIN_COMPLEXITY, self.complexity_level) + 1)
        elif action == "lower_complexity":
            self.complexity_level = max(MIN_COMPLEXITY, self.complexity_level - 1)

    def commit_action(self, action: dict | str) -> None:
        kind = action.get("action") if isinstance(action, dict) else str(action)
        commit_bounded_action(self, str(kind))

    def choose_action(self, team_state: dict) -> dict:
        action = self.decide(
            int(team_state.get("cycle", 0)),
            bool(team_state.get("solvable", True)),
            float(team_state.get("cycle_time_left", 0.0)),
        )
        self.commit_action(action)
        return action

    @staticmethod
    def role_nudge(cycle: int, available_roles) -> dict:
        """A public, role-appropriate nudge; never carries another role's data."""
        options = [r for r in ROLES if r in set(available_roles)]
        pool = options or list(ROLES)
        role = pool[int(cycle) % len(pool)]
        return {
            "role": role,
            "text": ROLE_NUDGES.get(role, f"{role.title()}: share what you can see."),
            "cycle": int(cycle),
        }

    def puzzle_metrics(self) -> dict:
        return {
            "generated": self.puzzle_generated,
            "difficulty": self.puzzle_difficulty,
            "complexity": self.puzzle_complexity,
            "attempts": self.puzzle_attempts,
            "solved": self.puzzle_solved,
            "success_rate": round(self.puzzle_solved / max(1, self.puzzle_attempts), 3),
            "info_nudges": self.info_nudges,
        }

    def team_report(self) -> dict:
        return {
            "team_skill": round(self.team_skill, 3),
            "difficulty": round(self.difficulty, 3),
            "difficulty_fit_error": round(self.difficulty_fit_error(), 3),
            "progress": round(self.team_progress(), 3),
            "frustration": round(self.frustration(), 3),
            "complexity_level": self.complexity_level,
            "dice_relief_rounds": self.dice_relief_rounds,
            "puzzle": self.puzzle_metrics(),
            "players": [m.public() for m in self.models.values()],
            "last_action": self.last_action,
        }

    # ---- simulated player tuning (task 41) -------------------------------
    @staticmethod
    def tune(team_skill: float, cycles: int = 8, seed: int = 0) -> dict:
        """Run a synthetic team through NEXUS and report the difficulty path."""
        nx = Nexus(seed=seed)
        nx.models["sim"] = PlayerModel("sim")
        nx.team_skill = team_skill
        path = []
        for c in range(cycles):
            act = nx.choose_action({
                "cycle": c, "solvable": True, "cycle_time_left": 5,
            })
            path.append((act["action"], round(nx.difficulty, 2)))
        return {"team_skill": team_skill, "final_difficulty": round(nx.difficulty, 2), "path": path}
