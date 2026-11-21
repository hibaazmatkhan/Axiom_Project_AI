"""Cooperative CSP puzzle tests."""
import pytest

from app.knowledge import (
    Constraint,
    KnowledgeBase,
    CooperativePuzzle,
    DIFFICULTY_LEVELS,
    generate_puzzle,
    solve_constraints,
)
from app.roles import ROLES


def test_generated_puzzles_are_solvable_and_unique():
    for difficulty in DIFFICULTY_LEVELS:
        for seed in range(25):
            puzzle = generate_puzzle(seed, difficulty)
            assert puzzle.check(puzzle.solution)
            assert len(puzzle.solve(limit=2)) == 1
            assert solve_constraints(puzzle.domains, puzzle.constraints, limit=2) == [puzzle.solution]


def test_generation_is_deterministic_for_a_seed():
    first = generate_puzzle(42, "medium")
    second = generate_puzzle(42, "medium")
    assert first.solution == second.solution
    assert first.domains == second.domains
    assert [(c.kind, c.variables, c.values) for c in first.constraints] == [
        (c.kind, c.variables, c.values) for c in second.constraints
    ]


def test_role_views_cover_every_role_without_leaking_the_answer():
    puzzle = generate_puzzle(9, "hard")
    for role in ROLES:
        view = puzzle.role_view(role)
        assert view["role"] == role
        assert set(view["domain"]) <= set(puzzle.domains[role])
        assert f"{role.title()}'s mark is {puzzle.solution[role]}." not in view["clues"]
        assert puzzle.hint(role)
    public = str(puzzle.public())
    assert all(value not in public for value in puzzle.solution.values())


def test_puzzle_values_only_use_sigils_colors_and_roles():
    from app.arena import DOOR_COLORS, SIGILS
    for difficulty in DIFFICULTY_LEVELS:
        puzzle = generate_puzzle(11, difficulty)
        assert set(puzzle.domains) == set(ROLES)
        assert all(value in SIGILS + DOOR_COLORS
                   for values in puzzle.domains.values() for value in values)
        assert all(value in SIGILS + DOOR_COLORS for value in puzzle.solution.values())


def test_complexity_scales_constraints_and_domains():
    easy = generate_puzzle(5, "easy")
    hard = generate_puzzle(5, "hard")
    assert easy.complexity == 1 and hard.complexity == 3
    assert len(hard.constraints) >= len(easy.constraints)
    assert any(c.kind in ("same_family", "different_family", "all_different")
               for c in hard.constraints)
    assert all(value in ("spade", "heart", "diamond", "club")
               for values in easy.domains.values() for value in values)
    with pytest.raises(ValueError):
        generate_puzzle(1, roles=("navigator",))


def test_solver_finds_all_solutions_with_forward_checking():
    domains = {"a": ("red", "blue"), "b": ("red", "blue")}
    constraints = [Constraint("not_equal", ("a", "b"))]
    assert solve_constraints(domains, constraints) == [
        {"a": "red", "b": "blue"}, {"a": "blue", "b": "red"}
    ]
    assert solve_constraints(domains, constraints, limit=1) == [{"a": "red", "b": "blue"}]


def test_knowledge_base_records_attempts_and_metrics():
    kb = KnowledgeBase()
    puzzle = kb.generate_puzzle(3, "easy")
    assert kb.puzzle is puzzle
    assert kb.query(predicate="difficulty")[0].obj == "easy"
    wrong = {role: next(v for v in values if v != puzzle.solution[role])
             for role, values in puzzle.domains.items()}
    assert kb.submit_puzzle(wrong)["correct"] is False
    assert kb.submit_puzzle(puzzle.solution)["correct"] is True
    metrics = kb.puzzle_metrics()
    assert metrics["attempts"] == 2 and metrics["solved"] == 1
    assert metrics["success_rate"] == 0.5
    assert kb.puzzle is not None and kb.puzzle.solved


def test_puzzle_hint_is_role_specific_and_safe():
    puzzle: CooperativePuzzle = generate_puzzle(8, "medium")
    for role in ROLES:
        hint = puzzle.hint(role, level=2)
        assert isinstance(hint, str) and hint
        assert f"{role.title()}'s mark is {puzzle.solution[role]}." not in hint
