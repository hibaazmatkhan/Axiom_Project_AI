"""AXIOM pattern engine (WP2, tasks 32-35).

Rules are data, not code. A Rule is a list of transformation clauses; each
clause selects blocks and applies one of the seven transformation types. The
engine evaluates clauses against a maze and returns which blocks moved and how,
so clients can animate the transition and players can reason about it.

Seven transformation types (O2):
  rotation     - rotate selected blocks 90 degrees clockwise
  reflection   - mirror selected blocks across an axis
  translation  - swap/copy openings between neighbouring blocks (a "shift")
  symbol       - acts only on blocks carrying a given symbol
  sequential   - a schedule of symbols applied one per cycle
  conditional  - fires only when the cycle satisfies a predicate (every Nth,
                 after another symbol, or when players stand on a material)
  compound     - two or more simple transformations chained in one step
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from .maze import Block, Maze, SYMBOLS, MATERIALS, PATTERN_TYPES


@dataclass
class Clause:
    """One transformation step. `select` describes which blocks are affected."""

    kind: str  # rotation | reflection | translation | symbol | reverse
    select: str = "all"  # all | symbol | material | checker | ring | row | col
    value: str | None = None  # symbol/material name or axis ('x'/'y') or index
    axis: str = "x"
    reverse: bool = False

    def matches(self, block: Block, bx: int, by: int, size: int, cycle: int) -> bool:
        if self.select == "all":
            return True
        if self.select == "symbol":
            return block.symbol == self.value
        if self.select == "material":
            return block.material == self.value
        if self.select == "checker":
            return (bx + by) % 2 == 0
        if self.select == "ring":
            return bx in (0, size - 1) or by in (0, size - 1)
        if self.select == "row":
            return by == int(self.value) % size
        if self.select == "col":
            return bx == int(self.value) % size
        return False

    def apply(self, block: Block) -> dict:
        if self.kind == "rotation":
            block.rotate_ccw() if self.reverse else block.rotate_cw()
            return block.last_move
        if self.kind == "reflection":
            block.mirror(self.axis)
            return block.last_move
        if self.kind == "reverse":
            block.reverse()
            return block.last_move
        return {}


@dataclass
class Rule:
    """A hidden, data-defined transformation rule.

    `pattern_type` is one of the seven types; `clauses` are the ordered
    transformation steps; `sequence` drives the 'sequential' type."""

    pattern_type: str
    clauses: list[Clause] = field(default_factory=list)
    sequence: list[str] = field(default_factory=list)
    every: int = 1  # for conditional: apply on every Nth cycle
    after_symbol: str | None = None  # for conditional: only after this symbol fired

    # ---- evaluation -----------------------------------------------------
    def is_active(self, cycle: int) -> bool:
        if self.pattern_type == "conditional":
            return cycle % max(1, self.every) == 0
        return True

    def clauses_for(self, cycle: int) -> list[Clause]:
        if self.pattern_type == "sequential":
            sym = self.sequence[cycle % len(self.sequence)] if self.sequence else None
            return [Clause("rotation", select="symbol", value=sym)]
        if self.pattern_type == "symbol":
            return self.clauses
        return self.clauses

    def describe(self) -> str:
        """Human-readable, agent-facing summary (never sent to clients)."""
        return f"{self.pattern_type} rule with {len(self.clauses)} clause(s)"

    # ---- authoring ------------------------------------------------------
    @staticmethod
    def generate(rng: random.Random, pattern_type: str | None = None,
                 size: int = 3) -> "Rule":
        pt = pattern_type or rng.choice(PATTERN_TYPES)
        sym = rng.choice(SYMBOLS)
        axis = rng.choice("xy")
        if pt == "rotation":
            return Rule("rotation", [Clause("rotation", select=rng.choice(["all", "symbol", "checker", "ring"]), value=sym)])
        if pt == "reflection":
            return Rule("reflection", [Clause("reflection", select=rng.choice(["all", "checker", "ring"]), axis=axis)])
        if pt == "translation":
            return Rule("translation", [Clause("reverse", select=rng.choice(["all", "row", "col", "ring"]), value=str(rng.randrange(size)))])
        if pt == "symbol":
            return Rule("symbol", [Clause("rotation", select="symbol", value=sym)])
        if pt == "sequential":
            a, b, c = rng.sample(SYMBOLS, 3)
            return Rule("sequential", sequence=[a, b, a, c])
        if pt == "conditional":
            return Rule("conditional", [Clause("rotation", select=rng.choice(["all", "checker", "ring"]))],
                        every=rng.choice([1, 2, 3]), after_symbol=sym)
        # compound
        return Rule("compound", [
            Clause("rotation", select="symbol", value=sym),
            Clause("reverse", select=rng.choice(["checker", "ring"])),
        ])


class PatternEngine:
    """Applies Rules to a maze and records transition history."""

    def __init__(self, rule: Rule, size: int = 3):
        self.rule = rule
        self.size = size
        self.cycle = 0
        self.history: list[dict] = []  # what moved at each cycle, for NEXUS + clues

    def apply(self, maze: Maze, announce: bool = True) -> dict:
        """Apply the rule's transformation for the current cycle. Returns a
        transition payload with the blocks that moved and their move kinds."""
        moved: list[dict] = []
        active = self.rule.is_active(self.cycle)
        if active:
            clauses = self.rule.clauses_for(self.cycle)
            for by, row in enumerate(maze.blocks):
                for bx, block in enumerate(row):
                    for clause in clauses:
                        if clause.matches(block, bx, by, self.size, self.cycle):
                            move = clause.apply(block)
                            if move:
                                moved.append({"bx": bx, "by": by, "move": move,
                                              "symbol": block.symbol})
                            break
        maze._tiles = None
        result = {
            "cycle": self.cycle + 1,
            "pattern_type": self.rule.pattern_type,
            "active": active,
            "moved": moved,
        }
        self.cycle += 1
        if announce:
            self.history.append(result)
        return result

    def snapshot_fingerprint(self, maze: Maze) -> tuple:
        return tuple(tuple(b.signature() for b in row) for row in maze.blocks)
