"""WP2 tests: maze model, generator, A*, solvability, and all pattern types."""
import random

from app.maze import BLOCK, Maze, PATTERN_TYPES, reachable_after_changes
from app.patterns import Clause, PatternEngine, Rule
from app.stages import MAX_STAGE, rules_for_stage, stage_config


def test_same_seed_same_maze():
    assert Maze.generate(3, seed=5).tiles() == Maze.generate(3, seed=5).tiles()


def test_initial_maze_always_solvable():
    for seed in range(60):
        assert Maze.generate(3, seed=seed).solvable(), seed


def test_four_rotations_restore_block():
    m = Maze.generate(3, seed=1)
    before = m.tiles()
    for row in m.blocks:
        for b in row:
            for _ in range(4):
                b.rotate_cw()
    m._tiles = None
    assert m.tiles() == before


def test_mirror_twice_restores_block():
    m = Maze.generate(3, seed=2)
    before = m.tiles()
    for row in m.blocks:
        for b in row:
            b.mirror("x")
            b.mirror("x")
    m._tiles = None
    assert m.tiles() == before


def test_all_seven_pattern_types_exist():
    assert len(PATTERN_TYPES) == 7
    for pt in PATTERN_TYPES:
        rng = random.Random(1)
        rule = Rule.generate(rng, pt)
        engine = PatternEngine(rule)
        m = Maze.generate(3, seed=3)
        payload = engine.apply(m)
        assert payload["pattern_type"] == pt
        assert isinstance(payload["moved"], list)


def test_sequential_rule_cycles_symbols():
    rule = Rule.generate(random.Random(3), "sequential")
    assert len(rule.sequence) == 4
    engine = PatternEngine(rule)
    m = Maze.generate(3, seed=3)
    for _ in range(8):
        engine.apply(m)


def test_conditional_rule_inactive_on_off_cycles():
    rule = Rule.generate(random.Random(7), "conditional")
    active = [rule.is_active(c) for c in range(6)]
    assert any(active) and not all(active)


def test_symbol_rule_only_moves_matching_symbol():
    rule = Rule("symbol", [Clause("rotation", select="symbol", value="triangle")])
    engine = PatternEngine(rule)
    m = Maze.generate(3, seed=4)
    moved = engine.apply(m)["moved"]
    assert all(x["symbol"] == "triangle" for x in moved)


def test_reachability_after_changes():
    m = Maze.generate(3, seed=11)
    engine = PatternEngine(Rule.generate(random.Random(11), "rotation"))
    assert reachable_after_changes(m, engine, m.start, m.exit, horizon=5) is True


def test_nearest_open_leaves_wall():
    m = Maze.generate(3, seed=4)
    x, y = m.nearest_open(0, 0)
    assert m.is_open(x, y)


def test_astar_path_is_connected():
    m = Maze.generate(3, seed=9)
    p = m.path(m.start, m.exit)
    assert p[0] == m.start and p[-1] == m.exit
    for a, b in zip(p, p[1:]):
        assert abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1 and m.is_open(*b)


def test_public_shape():
    pub = Maze.generate(3, seed=1).to_public()
    assert pub["tile_size"] == 3 * BLOCK and len(pub["tiles"]) == pub["tile_size"]
    assert "openings" in pub["blocks"][0] and "material" in pub["blocks"][0]


def test_stage_rules_are_valid():
    for stage in range(1, MAX_STAGE + 1):
        rules = rules_for_stage(stage, seed=2)
        assert len(rules) == stage_config(stage)["rules"]
