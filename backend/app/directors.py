from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np

from .nexus import (
    CLUE_TIERS,
    DIRECTOR_ACTIONS,
    MIN_COMPLEXITY,
    Nexus,
    band_error,
    commit_bounded_action,
)


class Director(ABC):
    @abstractmethod
    def choose_action(self, team_state: dict) -> dict:
        raise NotImplementedError

    @abstractmethod
    def ingest(self, event: dict) -> None:
        raise NotImplementedError

    @abstractmethod
    def extract(self, total_maze_tiles: int) -> None:
        raise NotImplementedError

    @abstractmethod
    def cluster(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def decide(self, cycle: int, solvable: bool, cycle_time_left: float) -> dict:
        raise NotImplementedError

    @abstractmethod
    def commit_action(self, action: dict | str) -> None:
        raise NotImplementedError

    @abstractmethod
    def make_clue(self, player_id: str, tier: int, now: float, stage: int,
                  skill: float | None = None) -> dict | None:
        raise NotImplementedError

    @abstractmethod
    def team_report(self) -> dict:
        raise NotImplementedError


class StaticDirector(Director):
    def __init__(self, seed: int = 0, action: str = "hold"):
        self.rng = np.random.default_rng(seed)
        self._observer = Nexus(seed=seed)
        self.fixed_action = action if action in DIRECTOR_ACTIONS else "hold"
        self.models: dict = {}
        self.events: list[dict] = []
        self.team_skill = 0.5
        self.difficulty = 0.0
        self.complexity_level = MIN_COMPLEXITY
        self.last_action: dict | None = None
        self.log: list[dict] = []
        self.clue_count = 0

    def choose_action(self, team_state: dict) -> dict:
        action = self.decide(
            int(team_state.get("cycle", 0)),
            bool(team_state.get("solvable", True)),
            float(team_state.get("cycle_time_left", 0.0)),
        )
        self.commit_action(action)
        return action

    def ingest(self, event: dict) -> None:
        self._observer.ingest(event)

    def extract(self, total_maze_tiles: int) -> None:
        self._observer.extract(total_maze_tiles)
        self.team_skill = float(self._observer.team_skill)
        self.models = self._observer.models

    def cluster(self) -> None:
        self._observer.cluster()

    def difficulty_fit_error(self) -> float:
        return band_error(self.team_skill, self.difficulty)

    def decide(self, cycle: int, solvable: bool, cycle_time_left: float) -> dict:
        alternatives = {name: 0.0 for name in DIRECTOR_ACTIONS}
        alternatives[self.fixed_action] = 1.0
        self.last_action = {
            "action": self.fixed_action,
            "utility": 1.0,
            "alternatives": alternatives,
            "terms": {},
        }
        self.log.append({"cycle": cycle, **self.last_action})
        return self.last_action

    def commit_action(self, action: dict | str) -> None:
        return None

    def clue_chance(self, skill: float | None = None) -> float:
        return 0.0

    def make_clue(self, player_id: str, tier: int, now: float, stage: int,
                  skill: float | None = None) -> dict | None:
        return None

    def team_report(self) -> dict:
        return {
            "director": "static",
            "team_skill": round(self.team_skill, 3),
            "difficulty": round(self.difficulty, 3),
            "difficulty_fit_error": round(self.difficulty_fit_error(), 3),
            "progress": 0.0,
            "frustration": 0.0,
            "complexity_level": self.complexity_level,
            "puzzle": self._observer.puzzle_metrics(),
            "players": [m.public() for m in self.models.values()],
            "last_action": self.last_action,
        }


class RandomDirector(Director):
    def __init__(self, seed: int = 0):
        self.rng = np.random.default_rng(seed ^ 0xA5A5A5A5)
        self._observer = Nexus(seed=seed)
        self.models: dict = {}
        self.events: list[dict] = []
        self.team_skill = 0.5
        self.difficulty = 0.0
        self.complexity_level = MIN_COMPLEXITY
        self.last_action: dict | None = None
        self.log: list[dict] = []
        self.clue_count = 0

    def choose_action(self, team_state: dict) -> dict:
        action = self.decide(
            int(team_state.get("cycle", 0)),
            bool(team_state.get("solvable", True)),
            float(team_state.get("cycle_time_left", 0.0)),
        )
        self.commit_action(action)
        return action

    def ingest(self, event: dict) -> None:
        self._observer.ingest(event)

    def extract(self, total_maze_tiles: int) -> None:
        self._observer.extract(total_maze_tiles)
        self.team_skill = float(self._observer.team_skill)
        self.models = self._observer.models

    def cluster(self) -> None:
        self._observer.cluster()

    def difficulty_fit_error(self) -> float:
        return band_error(self.team_skill, self.difficulty)

    def decide(self, cycle: int, solvable: bool, cycle_time_left: float) -> dict:
        action = str(self.rng.choice(DIRECTOR_ACTIONS))
        alternatives = {name: 0.0 for name in DIRECTOR_ACTIONS}
        alternatives[action] = 1.0
        self.last_action = {
            "action": action,
            "utility": 1.0,
            "alternatives": alternatives,
            "terms": {},
        }
        self.log.append({"cycle": cycle, **self.last_action})
        return self.last_action

    def commit_action(self, action: dict | str) -> None:
        kind = action.get("action") if isinstance(action, dict) else str(action)
        commit_bounded_action(self, str(kind))

    def clue_chance(self, skill: float | None = None) -> float:
        return 1.0

    def make_clue(self, player_id: str, tier: int, now: float, stage: int,
                  skill: float | None = None) -> dict | None:
        phrases = CLUE_TIERS.get(int(tier))
        if not phrases:
            return None
        self.clue_count += 1
        return {"tier": int(tier), "text": str(self.rng.choice(phrases))}

    def team_report(self) -> dict:
        return {
            "director": "random",
            "team_skill": round(self.team_skill, 3),
            "difficulty": round(self.difficulty, 3),
            "difficulty_fit_error": round(self.difficulty_fit_error(), 3),
            "progress": 0.0,
            "frustration": 0.0,
            "complexity_level": self.complexity_level,
            "puzzle": self._observer.puzzle_metrics(),
            "players": [m.public() for m in self.models.values()],
            "last_action": self.last_action,
        }


class NexusDirector(Nexus, Director):
    def team_report(self) -> dict:
        report = super().team_report()
        report["director"] = "nexus"
        return report


def make_director(name: str, seed: int = 0, **kwargs) -> Director:
    key = str(name).strip().lower().replace("_", "")
    if key in ("nexus", "nexusdirector"):
        return NexusDirector(seed=seed)
    if key in ("static", "staticdirector"):
        return StaticDirector(seed=seed, action=kwargs.get("action", "hold"))
    if key in ("random", "randomdirector"):
        return RandomDirector(seed=seed)
    raise ValueError(f"unknown director: {name}")
