"""AXIOM NEXUS AI Director (WP6, tasks 36-41).

NEXUS reads the raw event log, extracts features per player, maintains a
six-attribute player model (O5), clusters behaviour, and selects an action each
cycle with a utility function: raise complexity, give a clue, shift a player's
information, or hold. It also exposes tune() for simulated teams so adaptation
can be validated without real players (task 41).

Pure-Python + numpy so it runs anywhere. Clustering is k-means implemented on
numpy; classification labels a play style from the centroid it lands nearest.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

ATTRIBUTES = ("exploration", "risk", "cooperation", "pattern", "puzzle", "leadership")
PLAY_STYLES = ("Scout", "Gambler", "Anchor", "Analyst", "Solver", "Navigator")

# Attributes that reflect real competence (used for team skill). Risk is a
# style signal, not a skill signal, so it is excluded.
SKILL_ATTRS = ("pattern", "puzzle", "cooperation", "exploration", "leadership")

# Neutral prior used when an attribute has not been observed yet. Without it a
# brand new team would score 0.0 and the director would always hand out clues.
PRIOR = 0.5


@dataclass
class PlayerModel:
    pid: str
    name: str = ""
    attrs: dict[str, float] = field(default_factory=lambda: {a: 0.0 for a in ATTRIBUTES})
    style: str = "Scout"
    moves: int = 0
    predictions: int = 0
    correct: int = 0
    shares: int = 0
    bumps: int = 0
    follows: int = 0
    puzzle_attempts: int = 0
    puzzle_correct: int = 0
    escaped: bool = False
    distinct_tiles: set = field(default_factory=set)

    def vector(self) -> np.ndarray:
        return np.array([self.attrs[a] for a in ATTRIBUTES], dtype=float)

    def update_derived(self, total_maze_tiles: int) -> None:
        """Recompute the six attributes from raw counters.

        Idempotent: safe to call every cycle without drifting.
        """
        # Exploration: how much of the labyrinth the player has uncovered,
        # relative to a good-play coverage of 35% of the tiles.
        if self.moves:
            coverage = len(self.distinct_tiles) / max(1, total_maze_tiles)
            self.attrs["exploration"] = min(1.0, coverage / 0.35)
        else:
            self.attrs["exploration"] = PRIOR

        # Risk: how often the player walks into walls.
        if self.moves:
            self.attrs["risk"] = min(1.0, self.bumps / max(1, self.moves))
        else:
            self.attrs["risk"] = PRIOR

        # Cooperation: how often the player shares information with the team.
        self.attrs["cooperation"] = min(1.0, self.shares / 3.0) if self.shares else PRIOR

        # Pattern: accuracy on transition predictions.
        self.attrs["pattern"] = (self.correct / self.predictions) if self.predictions else PRIOR

        # Puzzle: accuracy on the cooperative puzzle.
        self.attrs["puzzle"] = (self.puzzle_correct / self.puzzle_attempts) if self.puzzle_attempts else PRIOR

        # Leadership: how often the team clusters around this player.
        self.attrs["leadership"] = min(1.0, self.follows / 3.0) if self.follows else PRIOR

    def skill(self) -> float:
        """Composite competence score for this player."""
        return float(np.mean([self.attrs[a] for a in SKILL_ATTRS]))

    def public(self) -> dict:
        return {"pid": self.pid, "name": getattr(self, "name", ""), "style": self.style,
                "attrs": {k: round(v, 3) for k, v in self.attrs.items()},
                "predictions": self.predictions, "correct": self.correct}


class Nexus:
    """The AI Director."""

    def __init__(self, seed: int = 0):
        self.rng = np.random.default_rng(seed)
        self.models: dict[str, PlayerModel] = {}
        self.events: list[dict] = []
        self.team_skill = 0.5
        self.difficulty = 0.0  # -1 easy .. +1 hard
        self.complexity_level = 0
        self.last_action: dict | None = None
        self.log: list[dict] = []
        self._centroids: np.ndarray | None = None

    # ---- event ingestion -------------------------------------------------
    def ingest(self, event: dict) -> None:
        self.events.append(event)
        if len(self.events) > 8000:
            del self.events[:2000]
        pid = event.get("player")
        if not pid:
            return
        m = self.models.get(pid)
        if m is None:
            m = self.models[pid] = PlayerModel(pid)
        kind = event.get("kind")
        data = event.get("data", {})
        if kind == "join" and data.get("name"):
            m.name = data["name"]
        if kind == "move":
            m.moves += 1
            m.distinct_tiles.add((data.get("x"), data.get("y")))
        elif kind == "bump":
            m.bumps += 1
        elif kind == "predict":
            m.predictions += 1
        elif kind == "predict_ok":
            m.correct += 1
            m.predictions = max(m.predictions, 1)
        elif kind == "share":
            m.shares += 1
        elif kind == "followed":
            m.follows += 1
        elif kind == "puzzle_step":
            m.puzzle_attempts += 1
        elif kind == "puzzle_ok":
            m.puzzle_attempts += 1
            m.puzzle_correct += 1
        elif kind == "escaped":
            m.escaped = True

    # ---- feature extraction / team skill ---------------------------------
    def extract(self, total_maze_tiles: int) -> None:
        for m in self.models.values():
            m.update_derived(total_maze_tiles)
        if self.models:
            self.team_skill = float(np.mean([m.skill() for m in self.models.values()]))

    def cluster(self) -> None:
        """k-means over player vectors; assign each player the nearest style."""
        if len(self.models) < 2:
            for m in self.models.values():
                m.style = "Scout"
            return
        X = np.vstack([m.vector() for m in self.models.values()])
        k = min(len(PLAY_STYLES), len(X))
        # deterministic init: pick k spread-out rows
        idx = np.linspace(0, len(X) - 1, k).astype(int)
        C = X[idx].copy()
        for _ in range(25):
            d = np.linalg.norm(X[:, None, :] - C[None, :, :], axis=2)
            labels = d.argmin(axis=1)
            for j in range(k):
                if np.any(labels == j):
                    C[j] = X[labels == j].mean(axis=0)
        self._centroids = C
        for m, lab in zip(self.models.values(), labels):
            m.style = PLAY_STYLES[int(lab) % len(PLAY_STYLES)]

    # ---- utility-based decision making -----------------------------------
    def decide(self, cycle: int, solvable: bool, cycle_time_left: float) -> dict:
        """Score candidate actions and pick the highest-utility one.

        Actions: raise_complexity, give_clue, shift_information, hold."""
        self.team_skill = self.team_skill or 0.0
        candidates: dict[str, float] = {}

        # Strong teams -> raise complexity; weak teams -> hold/clue.
        candidates["raise_complexity"] = (self.team_skill - 0.5) * 2.0 + (0.1 if cycle > 3 else 0)
        candidates["give_clue"] = (0.5 - self.team_skill) * 1.8
        # If unsolvable risk appears, prioritise easing.
        candidates["shift_information"] = 0.25 * (1.0 - self.team_skill)
        candidates["hold"] = 0.2
        if not solvable:
            candidates["give_clue"] += 1.0
            candidates["raise_complexity"] -= 1.0

        # Add a small deterministic jitter so ties break reproducibly.
        for k in candidates:
            candidates[k] += float(self.rng.normal(0, 0.01))

        action = max(candidates, key=candidates.get)
        self.last_action = {"action": action, "utility": round(candidates[action], 3),
                            "alternatives": {k: round(v, 3) for k, v in candidates.items()}}
        self.log.append({"cycle": cycle, **self.last_action})

        # Apply the chosen action's effect on difficulty.
        if action == "raise_complexity":
            self.difficulty = min(1.0, self.difficulty + 0.15)
            self.complexity_level += 1
        elif action in ("give_clue", "shift_information"):
            self.difficulty = max(-1.0, self.difficulty - 0.15)
        return self.last_action

    def team_report(self) -> dict:
        return {
            "team_skill": round(self.team_skill, 3),
            "difficulty": round(self.difficulty, 3),
            "complexity_level": self.complexity_level,
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
            act = nx.decide(c, solvable=True, cycle_time_left=5)
            path.append((act["action"], round(nx.difficulty, 2)))
        return {"team_skill": team_skill, "final_difficulty": round(nx.difficulty, 2), "path": path}
