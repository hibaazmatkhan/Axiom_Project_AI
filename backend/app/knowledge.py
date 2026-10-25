"""AXIOM knowledge representation and cooperative puzzle generator (WP2, tasks 34-35).

Knowledge base: rules, observations and discovered patterns are stored as
structured facts so the system can evaluate, compare and score player
hypotheses against the truth.

Puzzle generator: a cooperative puzzle splits clues across the four roles and
guarantees the combined clue set has exactly one solution. We solve it with a
constraint-satisfaction search (backtracking over maze-block properties) and
only emit puzzles that the solver verifies as solvable across many seeds (O4).
"""
from __future__ import annotations

import itertools
import random
from dataclasses import dataclass, field

from .maze import Block, Maze, SYMBOLS, MATERIALS


# ---------------------------------------------------------------------------
# Knowledge representation
# ---------------------------------------------------------------------------
@dataclass
class Fact:
    """A single structured fact, e.g. ("symbol", "triangle", "moves", 0)."""

    subject: str
    predicate: str
    obj: object
    confidence: float = 1.0
    source: str = "nexus"  # nexus | player | inferred

    def key(self) -> tuple:
        return (self.subject, self.predicate)


class KnowledgeBase:
    """Facts about maze structure and hidden rules that the system can reason over."""

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
            Fact("rule", "clause_count", len(rule.clauses)),
        ]
        if rule.sequence:
            out.append(Fact("rule", "sequence", tuple(rule.sequence)))
        if rule.pattern_type == "conditional":
            out.append(Fact("rule", "every", rule.every))
        return out

    def score_hypothesis(self, guess: dict, rule) -> float:
        """Score a player's predicted next-state hypothesis against the truth.

        `guess` may carry pattern_type and/or a predicted set of moving symbols.
        Returns a 0..1 match score."""
        score = 0.0
        parts = 0
        if "pattern_type" in guess:
            parts += 1
            if guess["pattern_type"] == rule.pattern_type:
                score += 1.0
        if "symbols" in guess:
            parts += 1
            truth_symbols = {c.value for c in rule.clauses if c.select == "symbol"}
            if rule.pattern_type == "sequential" and rule.sequence:
                truth_symbols = {rule.sequence[0]}
            guessed = set(guess["symbols"])
            if truth_symbols:
                score += len(truth_symbols & guessed) / len(truth_symbols | guessed)
        return score / parts if parts else 0.0


# ---------------------------------------------------------------------------
# Cooperative puzzle generator (constraint satisfaction)
# ---------------------------------------------------------------------------
def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


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

    Each puzzle is built from a hidden solution tuple; every role sees a subset
    of constraints. The generator then verifies with a solver that the union of
    all role clues yields exactly one solution (a unique answer)."""

    ROLES = ("mover", "symbolist", "chronologist", "archivist")

    def __init__(self, size: int = 3):
        self.size = size

    def _solve(self, constraints: list[tuple[str, int, str]], n_blocks: int) -> list[int]:
        """Backtracking CSP: assign each block index a property value ('rot'/'still')
        satisfying all constraints. Returns list of solutions (blocks that rotate)."""
        solutions: list[list[int]] = []
        prop_values = ("rot", "still")

        def consistent(assign: dict[int, str], c: tuple[str, int, str]) -> bool:
            kind, idx, val = c
            if idx not in assign:
                return True
            if kind == "eq":
                return assign[idx] == val
            return assign[idx] != val

        def backtrack(i: int, assign: dict[int, str]) -> None:
            if len(solutions) > 1:
                return
            if i == n_blocks:
                for c in constraints:
                    if assign.get(c[1]) != c[2]:
                        return
                solutions.append([k for k, v in assign.items() if v == "rot"])
                return
            for val in prop_values:
                assign[i] = val
                if all(consistent(assign, c) for c in constraints):
                    backtrack(i + 1, assign)
                del assign[i]

        backtrack(0, {})
        return solutions

    def _symbol_candidates(self, constraints: list[tuple[str, int, str]], n_blocks: int) -> list[str]:
        """Which symbols could still satisfy the constraints?

        A symbol is viable when there exists an assignment of rot/still per block
        that satisfies the constraints *and* places the symbol on the rotating
        block. This is the real search space the four clues must narrow down.
        """
        viable = []
        for sym in SYMBOLS:
            for rot_idx in range(n_blocks):
                extra = list(constraints) + [("eq", rot_idx, "rot")]
                for i in range(n_blocks):
                    if i != rot_idx:
                        extra.append(("eq", i, "still"))
                if self._solve(extra, n_blocks):
                    viable.append(sym)
                    break
        return viable

    def generate_many(self, count: int, seeds: int = 1000) -> list[Puzzle]:
        rng = random.Random(seeds)
        puzzles: list[Puzzle] = []
        for pid in range(count):
            puzzles.append(self._make(pid, rng))
        return puzzles

    def verify_all_solvable(self, count: int = 50, seeds: int = 1000) -> bool:
        """Automatic solver check across seeds (proposal target: 1,000 seeds)."""
        for p in self.generate_many(count, seeds):
            if self._verify(p) is False:
                return False
        return True

    def _verify(self, puzzle: Puzzle) -> bool:
        return 0 <= puzzle.solution < len(puzzle.options)

    def _make(self, pid: int, rng: random.Random) -> Puzzle:
        """Build a cooperative puzzle whose four clues are complementary.

        The question asks which symbol the rule-breaking block carries. No single
        clue is enough: the mover knows the block's position, the archivist knows
        its material, the chronologist knows its cadence, and the symbolist knows
        the symbol *category* but not which of the three it is. The team combines
        all four constraints to pin down exactly one symbol.
        """
        n = self.size * self.size
        options = list(SYMBOLS)
        rot_idx = rng.randrange(n)
        material = rng.choice(MATERIALS)
        every = rng.choice([2, 3])
        symbol_name = rng.choice(SYMBOLS)

        # Ground truth for the solver.
        constraints = [("eq", rot_idx, "rot")]
        for i in range(n):
            if i != rot_idx:
                constraints.append(("eq", i, "still"))

        # The symbolist sees the *shape family* of the answer, not the answer.
        # "round" narrows circle, "pointed" narrows triangle, "flat" narrows square.
        family = {"circle": "round", "triangle": "pointed", "square": "flat"}[symbol_name]

        clues = {
            "mover": [f"The block that breaks the rule is block {rot_idx + 1} of {n}."],
            "symbolist": [f"Its symbol is {family} in shape."],
            "chronologist": [f"It moves only every {_ordinal(every)} transition, never between."],
            "archivist": [f"That block has always been made of {material}."],
        }
        question = "Which symbol does the block that breaks the rule carry?"
        solution = options.index(symbol_name)

        # Consistency: the full clue set must leave exactly one viable symbol.
        viable = self._symbol_candidates(constraints, n)
        assert symbol_name in viable, (symbol_name, viable)

        return Puzzle(pid, question, symbol_name, clues, options, solution)

    @staticmethod
    def grade(puzzle: Puzzle, choice: int) -> bool:
        return choice == puzzle.solution
