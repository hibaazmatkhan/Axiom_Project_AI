"""THE LAST ROOM knowledge representation.

Rules, observations and discovered patterns are stored as structured facts so
the system can evaluate, compare and score player hypotheses against the truth.
The module also hosts the cooperative CSP puzzle: one variable per information
role, with only sigils, door colours and role names as values.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from .arena import DOOR_COLORS, SIGILS
from .roles import ROLES


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
        self.puzzle: CooperativePuzzle | None = None

    def add(self, fact: Fact) -> None:
        self.facts.append(fact)

    def query(self, subject: str | None = None, predicate: str | None = None) -> list[Fact]:
        return [f for f in self.facts
                if (subject is None or f.subject == subject)
                and (predicate is None or f.predicate == predicate)]

    def observe(self, obs: dict) -> None:
        """Record a runtime observation (a transition the players saw)."""
        self.observations.append(obs)

    def generate_puzzle(self, seed: int, difficulty: str = "easy",
                        complexity: int | None = None,
                        roles: tuple[str, ...] = ROLES) -> CooperativePuzzle:
        """Create the cooperative CSP puzzle and record only public facts."""
        self.puzzle = generate_puzzle(seed, difficulty, complexity, roles)
        self.add(Fact("puzzle", "difficulty", self.puzzle.difficulty))
        self.add(Fact("puzzle", "complexity", self.puzzle.complexity))
        self.add(Fact("puzzle", "constraints", len(self.puzzle.constraints)))
        self.observe({"kind": "puzzle_generated", **self.puzzle.public()})
        return self.puzzle

    def submit_puzzle(self, assignment: dict | None) -> dict:
        """Evaluate a team's combined answer without exposing the solution."""
        if self.puzzle is None:
            return {"correct": False, "reason": "no_puzzle"}
        correct = self.puzzle.check_and_record(assignment)
        self.observe({"kind": "puzzle_attempt", "attempts": self.puzzle.attempts,
                      "correct": bool(correct)})
        return {"correct": correct, "attempts": self.puzzle.attempts,
                "solved": self.puzzle.solved}

    def puzzle_metrics(self) -> dict:
        if self.puzzle is None:
            return {"difficulty": "easy", "complexity": 1, "attempts": 0,
                    "solved": 0, "success_rate": 0.0}
        attempts = self.puzzle.attempts
        return {
            "difficulty": self.puzzle.difficulty,
            "complexity": self.puzzle.complexity,
            "attempts": attempts,
            "solved": int(self.puzzle.solved),
            "success_rate": round(int(self.puzzle.solved) / max(1, attempts), 3),
        }

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
# Cooperative CSP puzzle
# ---------------------------------------------------------------------------
DIFFICULTY_LEVELS = {"easy": 1, "medium": 2, "hard": 3}
LEVEL_DIFFICULTIES = {value: key for key, value in DIFFICULTY_LEVELS.items()}


def _family(value: str) -> str:
    if value in SIGILS:
        return "sigil"
    if value in DOOR_COLORS:
        return "color"
    return "unknown"


@dataclass(frozen=True)
class Constraint:
    """A CSP constraint over one or two role variables."""

    kind: str
    variables: tuple[str, ...]
    values: tuple[str, ...] = ()

    def involves(self, role: str) -> bool:
        return role in self.variables

    def satisfied_by(self, assignment: dict[str, str]) -> bool:
        values = [assignment.get(variable) for variable in self.variables]
        if any(value is None for value in values):
            return False
        if self.kind == "value":
            return values[0] == self.values[0]
        if self.kind == "not_value":
            return values[0] != self.values[0]
        if self.kind == "equals":
            return values[0] == values[1]
        if self.kind == "not_equal":
            return values[0] != values[1]
        if self.kind == "all_different":
            return len(set(values)) == len(values)
        if self.kind == "same_family":
            return len({_family(value) for value in values}) == 1
        if self.kind == "different_family":
            return _family(values[0]) != _family(values[1])
        return False

    def allows(self, variable: str, value: str, assignment: dict[str, str]) -> bool:
        """Forward-check one candidate value against a partial assignment."""
        trial = dict(assignment)
        trial[variable] = value
        if all(name in trial for name in self.variables):
            return self.satisfied_by(trial)
        if self.kind in ("value", "not_value") and self.variables[0] == variable:
            return value == self.values[0] if self.kind == "value" else value != self.values[0]
        if self.kind in ("equals", "not_equal"):
            other = next((name for name in self.variables if name != variable), None)
            if other is not None and other in trial:
                equal = value == trial[other]
                return equal if self.kind == "equals" else not equal
        if self.kind in ("all_different", "same_family", "different_family"):
            assigned = [assignment[name] for name in self.variables
                        if name in assignment and name != variable]

            if self.kind == "all_different":
                return value not in assigned
            if self.kind == "same_family":
                return all(_family(value) == _family(item) for item in assigned)
            return all(_family(value) != _family(item) for item in assigned)
        return True

    def describe(self) -> str:
        names = [name.title() for name in self.variables]
        if self.kind == "not_value":
            return f"{names[0]}'s mark is not {self.values[0]}."
        if self.kind == "value":
            return f"{names[0]}'s mark is fixed."
        if self.kind == "equals":
            return f"{names[0]} and {names[1]} share a mark."
        if self.kind == "not_equal":
            return f"{names[0]} and {names[1]} cannot share a mark."
        if self.kind == "all_different":
            return "All four role marks are different."
        if self.kind == "same_family":
            return f"{names[0]} and {names[1]} use the same kind of mark."
        if self.kind == "different_family":
            return f"{names[0]} and {names[1]} use different kinds of mark."
        return "A hidden constraint applies."


def solve_constraints(domains: dict[str, tuple[str, ...]],
                      constraints: list[Constraint],
                      limit: int | None = None) -> list[dict[str, str]]:
    """Backtracking CSP solver with forward checking and MRV ordering."""
    current = {name: list(values) for name, values in domains.items()}
    solutions: list[dict[str, str]] = []

    def propagate(assignment: dict[str, str]) -> bool:
        changed = True
        while changed:
            changed = False
            for constraint in constraints:
                for name in constraint.variables:
                    if name in assignment:
                        continue
                    allowed = [value for value in current[name]
                               if constraint.allows(name, value, assignment)]
                    if len(allowed) != len(current[name]):
                        current[name] = allowed
                        changed = True
                        if not allowed:
                            return False
        return True

    def search(assignment: dict[str, str]) -> None:
        if limit is not None and len(solutions) >= limit:
            return
        if len(assignment) == len(current):
            solutions.append(dict(assignment))
            return
        pending = [name for name in current if name not in assignment]
        name = min(pending, key=lambda item: (len(current[item]), item))
        for value in list(current[name]):
            saved = {key: list(values) for key, values in current.items()}
            assignment[name] = value
            if propagate(assignment):
                search(assignment)
            assignment.pop(name, None)
            current.update(saved)
            if limit is not None and len(solutions) >= limit:
                return

    if not domains:
        return [{}]
    search({})
    return solutions


@dataclass
class CooperativePuzzle:
    """One role-private CSP instance. The solution is never serialised to clients."""

    seed: int
    difficulty: str
    complexity: int
    domains: dict[str, tuple[str, ...]]
    constraints: list[Constraint] = field(default_factory=list)
    solution: dict[str, str] = field(default_factory=dict)
    attempts: int = 0
    solved: bool = False

    def public(self) -> dict:
        return {
            "seed": self.seed, "difficulty": self.difficulty,
            "complexity": self.complexity,
            "variables": len(self.domains), "constraints": len(self.constraints),
            "attempts": self.attempts, "solved": self.solved,
        }

    def role_view(self, role: str) -> dict:
        """The only puzzle data a player may see: their role and its constraints."""
        visible = [c for c in self.constraints if c.involves(role)]
        return {
            "role": role,
            "domain": list(self.domains.get(role, ())),
            "clues": [c.describe() for c in visible if c.kind != "value"],
        }

    def check(self, assignment: dict | None) -> bool:
        if not isinstance(assignment, dict):
            return False
        if set(assignment) != set(self.domains):
            return False
        if any(str(value) not in self.domains[name] for name, value in assignment.items()):
            return False
        return all(c.satisfied_by(assignment) for c in self.constraints)

    def check_and_record(self, assignment: dict | None) -> bool:
        self.attempts += 1
        correct = self.check(assignment)
        self.solved = self.solved or correct
        return correct

    def solve(self, limit: int | None = None) -> list[dict[str, str]]:
        return solve_constraints(self.domains, self.constraints, limit=limit)

    def hint(self, role: str, level: int = 1) -> str:
        """A safe nudge for one role; never reveals the full assignment."""
        visible = [c for c in self.constraints
                   if c.involves(role) and c.kind != "value"]
        if visible:
            if level >= 2:
                not_values = [c for c in visible if c.kind == "not_value"]
                if len(not_values) > 1:
                    return not_values[level % len(not_values)].describe()
            return visible[0].describe()
        domain = self.domains.get(role, ())
        if not domain:
            return f"{role.title()} has no active mark."
        return f"{role.title()}'s mark comes from a short list; compare it with a teammate."


def _candidate_constraints(roles: tuple[str, ...], domains: dict[str, tuple[str, ...]],
                           solution: dict[str, str], rng: random.Random,
                           level: int) -> list[Constraint]:
    candidates: list[Constraint] = []
    for role in roles:
        for value in domains[role]:
            if value != solution[role]:
                candidates.append(Constraint("not_value", (role,), (value,)))
    for index, left in enumerate(roles):
        for right in roles[index + 1:]:
            if solution[left] == solution[right]:
                candidates.append(Constraint("equals", (left, right)))
            elif level >= 2 and _family(solution[left]) == _family(solution[right]):
                candidates.append(Constraint("same_family", (left, right)))
            else:
                candidates.append(Constraint("not_equal", (left, right)))
                if level >= 3 and _family(solution[left]) != _family(solution[right]):
                    candidates.append(Constraint("different_family", (left, right)))
    if level >= 2 and len({solution[role] for role in roles}) == len(roles):
        candidates.append(Constraint("all_different", roles))
        candidates.append(Constraint("all_different", roles[:max(2, len(roles) // 2)]))
    rng.shuffle(candidates)
    return candidates


def generate_puzzle(seed: int, difficulty: str = "easy", complexity: int | None = None,
                    roles: tuple[str, ...] = ROLES) -> CooperativePuzzle:
    """Generate a solvable, uniquely-determined cooperative CSP puzzle.

    ``difficulty`` (or an explicit ``complexity`` 1..3) scales the value pool,
    domain size and the constraint vocabulary. Backtracking with forward
    checking is used both while assembling constraints and to prove uniqueness.
    """
    roles = tuple(roles)
    if len(roles) < 2:
        raise ValueError("a cooperative puzzle needs at least two roles")
    level = complexity if complexity is not None else DIFFICULTY_LEVELS.get(
        str(difficulty).strip().lower())
    if level is None:
        level = 1
    level = max(1, min(3, int(level)))
    difficulty = LEVEL_DIFFICULTIES[level]
    rng = random.Random(int(seed) ^ 0x43535021)

    for attempt in range(60):
        if level == 1:
            pool: tuple[str, ...] = SIGILS
            domain_size = 4
        elif level == 2:
            pool = SIGILS if attempt % 2 == 0 else DOOR_COLORS
            domain_size = 4
        else:
            pool = SIGILS + DOOR_COLORS
            domain_size = 4 + attempt % 2
        domain_size = min(domain_size, len(pool))
        domains = {role: tuple(rng.sample(pool, domain_size)) for role in roles}
        solution = {role: rng.choice(domains[role]) for role in roles}
        candidates = _candidate_constraints(roles, domains, solution, rng, level)

        chosen: list[Constraint] = []
        for constraint in candidates:
            chosen.append(constraint)
            if len(solve_constraints(domains, chosen, limit=2)) == 1:
                break
        if len(solve_constraints(domains, chosen, limit=2)) != 1:
            continue
        # Extra constraints raise reasoning load without changing the answer.
        max_constraints = 3 + level * 3
        for constraint in candidates:
            if constraint not in chosen and len(chosen) < max_constraints:
                chosen.append(constraint)
        return CooperativePuzzle(
            seed=int(seed), difficulty=difficulty, complexity=level,
            domains=domains, constraints=chosen, solution=solution,
        )

    # Deterministic fallback: unary elimination always yields a unique answer.
    pool = SIGILS + DOOR_COLORS
    domains = {role: tuple(pool[i * 2:(i + 2) * 2]) for i, role in enumerate(roles)}
    solution = {role: values[0] for role, values in domains.items()}
    constraints = [Constraint("not_value", (role,), (value,))
                   for role, values in domains.items() for value in values[1:]]
    return CooperativePuzzle(
        seed=int(seed), difficulty=difficulty, complexity=level,
        domains=domains, constraints=constraints, solution=solution,
    )
