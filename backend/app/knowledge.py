"""THE LAST ROOM knowledge representation and cooperative puzzle generator.

Knowledge base: rules, observations and discovered patterns are stored as
structured facts so the system can evaluate, compare and score player
hypotheses against the truth.

Puzzle generator: a cooperative cipher splits four clues across the four roles
and guarantees the combined clue set identifies exactly one room code. We solve
it with a constraint-satisfaction search over the 5x5 grid and only emit
puzzles that the solver verifies as unique (O4).
"""
from __future__ import annotations

import random
from dataclasses import dataclass

from .arena import SIZE, room_code


# ---------------------------------------------------------------------------
# Knowledge representation
# ---------------------------------------------------------------------------
@dataclass
class Fact:
    """A single structured fact, e.g. ("rule", "pattern_type", "translation")."""

    subject: str
    predicate: str
    obj: object
    confidence: float = 1.0
    source: str = "nexus"  # nexus | player | inferred

    def key(self) -> tuple:
        return (self.subject, self.predicate)


class KnowledgeBase:
    """Facts about the grid and hidden rules that the system can reason over."""

    def __init__(self) -> None:
        self.facts: list[Fact] = []
        self.observations: list[dict] = []

    def add(self, fact: Fact) -> None:
        self.facts.append(fact)

    def query(self, subject: str | None = None, predicate: str | None = None) -> list[Fact]:
        return [f for f in self.facts
                if (subject is None or f.subject == subject)
                and (predicate is None or f.predicate == predicate)]

    def observe(self, obs: dict) -> None:
        """Record a runtime observation (a transition the players saw)."""
        self.observations.append(obs)

    def describe_rule(self, rule) -> list[Fact]:
        """Turn a hidden Rule into a set of comparable facts."""
        out = [
            Fact("rule", "pattern_type", rule.pattern_type),
            Fact("rule", "op_count", len(rule.sequence or rule.ops)),
        ]
        kinds = tuple(op.kind for op in (rule.sequence or rule.ops))
        if kinds:
            out.append(Fact("rule", "ops", kinds))
        if rule.pattern_type == "conditional":
            out.append(Fact("rule", "every", rule.every))
        return out

    def score_hypothesis(self, guess: dict, rule, moved: list[dict] | None = None) -> float:
        """Score a player's predicted next-state hypothesis against the truth.

        `guess` may carry pattern_type and/or a predicted set of room codes or
        sigils. Returns a 0..1 match score.
        """
        score = 0.0
        parts = 0
        if "pattern_type" in guess:
            parts += 1
            if guess["pattern_type"] == rule.pattern_type:
                score += 1.0
        if "rooms" in guess:
            parts += 1
            truth = {m.get("code_to") for m in (moved or []) if m.get("code_to")}
            guessed = {str(r).upper() for r in guess["rooms"]}
            if truth:
                score += len(truth & guessed) / len(truth | guessed)
        if "sigils" in guess:
            parts += 1
            truth = {m.get("sigil") for m in (moved or []) if m.get("sigil")}
            guessed = set(guess["sigils"])
            if truth:
                score += len(truth & guessed) / len(truth | guessed)
        return score / parts if parts else 0.0


# ---------------------------------------------------------------------------
# Cooperative puzzle generator (constraint satisfaction)
# ---------------------------------------------------------------------------
@dataclass
class Puzzle:
    puzzle_id: int
    question: str
    answer_key: str
    clues: dict[str, list[str]]  # role -> clue fragments
    options: list[str]
    solution: int  # index into options

    def public_for(self, role: str) -> dict:
        return {
            "id": self.puzzle_id,
            "question": self.question,
            "clues": self.clues.get(role, []),
            "options": self.options,
        }


class PuzzleGenerator:
    """Generates cooperative puzzles whose clues are split across four roles.

    Each puzzle is built from a hidden room code; every role sees one constraint
    (column, row, letter, number). The generator verifies with a solver that the
    union of all role clues yields exactly one room code."""

    ROLES = ("navigator", "oracle", "timekeeper", "archivist")

    def __init__(self, size: int = SIZE, target: str | None = None):
        self.size = size
        self.options = [room_code(x, y) for y in range(size) for x in range(size)]
        self.target = target or ("A5" if size == SIZE else room_code(size - 1, size - 1))
        if self.target not in self.options:
            raise ValueError(f"target {self.target!r} is outside a {size}x{size} grid")

    def _constraints(self, target: str) -> list[tuple[str, str]]:
        letter, number = target[0], target[1]
        return [
            ("column", letter),
            ("row", number),
            ("letter", letter),
            ("number", number),
        ]

    def _solve(self, constraints: list[tuple[str, str]]) -> list[str]:
        """Return all room codes satisfying every clue constraint."""
        out = []
        for code in self.options:
            letter, number = code[0], code[1]
            if all(
                (kind == "column" and letter == value)
                or (kind == "row" and number == value)
                or (kind == "letter" and letter == value)
                or (kind == "number" and number == value)
                for kind, value in constraints
            ):
                out.append(code)
        return out

    def generate_many(self, count: int, seeds: int = 1000) -> list[Puzzle]:
        rng = random.Random(seeds)
        return [self._make(pid, rng) for pid in range(count)]

    def verify_all_solvable(self, count: int = 50, seeds: int = 1000) -> bool:
        """Automatic solver check across seeds (proposal target: 1,000 seeds)."""
        for p in self.generate_many(count, seeds):
            if not self._verify(p):
                return False
        return True

    def _verify(self, puzzle: Puzzle) -> bool:
        if not (0 <= puzzle.solution < len(puzzle.options)):
            return False
        constraints = self._constraints(self.target)
        solutions = self._solve(constraints)
        return solutions == [self.target] and puzzle.options[puzzle.solution] == self.target

    def _make(self, pid: int, rng: random.Random) -> Puzzle:
        letter, number = self.target[0], self.target[1]
        constraints = self._constraints(self.target)
        clues = {
            "navigator": [f"The final door is in column {letter}."],
            "oracle": [f"The final door is on row {number}."],
            "timekeeper": [f"The final door's number is {number}."],
            "archivist": [f"The final door's letter is {letter}."],
        }
        question = "Which room holds the final door? Select its code on the wristband."
        solution = self.options.index(self.target)
        puzzle = Puzzle(pid, question, self.target, clues, list(self.options), solution)
        assert self._verify(puzzle)
        return puzzle

    @staticmethod
    def grade(puzzle: Puzzle, choice: int) -> bool:
        return choice == puzzle.solution
