"""THE LAST ROOM pattern engine (WP2, tasks 32-35).

Rules are data, not code. A Rule is a list of grid transformations; each
transformation slides a row/column, rotates a sub-grid, reflects a line, or
swaps rooms carrying two sigils. The engine evaluates clauses against the arena
and returns which rooms moved and how, so clients can animate the wristband map
and players can reason about the next state.

Seven transformation types (O2):
  rotation     - rotate a 3x3 block 90 degrees
  reflection   - mirror a row or column
  translation  - slide a row or column by one cell
  symbol       - swap rooms carrying two sigils
  sequential   - a schedule of transformations applied one per round
  conditional  - fires only when the round satisfies a predicate (every Nth)
  compound     - two or more transformations chained in one step
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from .arena import PATTERN_TYPES, SIGILS, SIZE, Arena, Shift


@dataclass
class Rule:
    """A hidden, data-defined grid transformation rule."""

    pattern_type: str
    ops: list[Shift] = field(default_factory=list)
    sequence: list[Shift] = field(default_factory=list)
    every: int = 1
    after_sigil: str | None = None

    def is_active(self, cycle: int) -> bool:
        if self.pattern_type == "conditional":
            return cycle % max(1, self.every) == 0
        return True

    def ops_for(self, cycle: int) -> list[Shift]:
        if self.pattern_type == "sequential":
            if not self.sequence:
                return []
            return [self.sequence[cycle % len(self.sequence)]]
        return list(self.ops)

    def describe(self) -> str:
        kinds = ", ".join(op.kind for op in (self.sequence or self.ops))
        return f"{self.pattern_type} rule ({kinds})"

    # ---- authoring ------------------------------------------------------
    @staticmethod
    def generate(rng: random.Random, pattern_type: str | None = None,
                 size: int = SIZE) -> "Rule":
        pt = pattern_type or rng.choice(PATTERN_TYPES)
        max_start = max(0, size - 3)

        def rotate() -> Shift:
            return Shift("rotate", cx=rng.randint(0, max_start),
                         cy=rng.randint(0, max_start), size=3,
                         direction=rng.choice([-1, 1]))

        def slide() -> Shift:
            return Shift(rng.choice(["row", "col"]), index=rng.randrange(size),
                         direction=rng.choice([-1, 1]))

        def reflect() -> Shift:
            return Shift("reflect", axis=rng.choice(["x", "y"]),
                         index=rng.randrange(size))

        if pt == "rotation":
            return Rule("rotation", [rotate()])
        if pt == "reflection":
            return Rule("reflection", [reflect()])
        if pt == "translation":
            return Rule("translation", [slide()])
        if pt == "symbol":
            a, b = rng.sample(SIGILS, 2)
            return Rule("symbol", [Shift("swap_sigil", a=a, b=b)])
        if pt == "sequential":
            seq = [slide(), reflect(), rotate(), slide()]
            rng.shuffle(seq)
            return Rule("sequential", sequence=seq)
        if pt == "conditional":
            return Rule("conditional", [slide()], every=rng.choice([2, 3]),
                        after_sigil=rng.choice(SIGILS))
        # compound
        return Rule("compound", [slide(), rotate() if rng.random() < 0.5 else reflect()])


class PatternEngine:
    """Applies Rules to an arena and records transition history."""

    def __init__(self, rule: Rule, size: int = SIZE):
        self.rule = rule
        self.size = size
        self.cycle = 0
        self.history: list[dict] = []

    def apply(self, arena: Arena, announce: bool = True) -> dict:
        active = self.rule.is_active(self.cycle)
        ops = self.rule.ops_for(self.cycle) if active else []
        moved: list[dict] = []
        for op in ops:
            moved.extend(arena.apply_shift(op))
        result = {
            "cycle": self.cycle + 1,
            "pattern_type": self.rule.pattern_type,
            "active": active,
            "ops": [op.as_dict() for op in ops],
            "moved": moved,
        }
        self.cycle += 1
        if announce:
            self.history.append(result)
        return result

    def snapshot_fingerprint(self, arena: Arena) -> tuple:
        return tuple(tuple(room.signature() for room in row) for row in arena.grid)
