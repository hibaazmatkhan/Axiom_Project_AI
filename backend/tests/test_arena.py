"""WP2 tests: room arena, generator, A*, solvability, shifts and all pattern types."""
import random

from app.arena import (
    DIRECTIONS,
    DOOR_COLORS,
    EXIT_ROOM,
    PATTERN_TYPES,
    SIGILS,
    START_ROOM,
    STEP,
    Arena,
    Shift,
    code_to_pos,
    reachable_after_changes,
    room_code,
)
from app.patterns import PatternEngine, Rule
from app.stages import MAX_STAGE, rules_for_stage, stage_config


def test_same_seed_same_arena():
    assert Arena.generate(5, seed=5).to_public() == Arena.generate(5, seed=5).to_public()


def test_initial_arena_always_solvable():
    for seed in range(60):
        assert Arena.generate(5, seed=seed).solvable(), seed


def test_initial_arena_fully_connected():
    for seed in range(20):
        assert Arena.generate(5, seed=seed).connected(), seed


def test_grid_is_five_by_five_with_expected_codes():
    a = Arena.generate(5, seed=1)
    assert len(a.rooms) == 25
    assert {r.code for r in a.rooms} == {room_code(x, y) for y in range(5) for x in range(5)}
    assert a.start_room().code == "C3"
    assert a.exit_room().code == "A5"


def test_room_has_four_coloured_doors_and_a_sigil():
    a = Arena.generate(5, seed=2)
    for room in a.rooms:
        assert set(room.doors) == set(DIRECTIONS)
        assert {room.doors[d].color for d in DIRECTIONS} == set(DOOR_COLORS)
        assert room.sigil in SIGILS


def test_four_rotations_restore_the_block():
    a = Arena.generate(5, seed=1)
    before = {(r.rid, r.bx, r.by) for r in a.rooms}
    for _ in range(4):
        a.apply_shift(Shift("rotate", cx=1, cy=1, size=3, direction=1))
    assert {(r.rid, r.bx, r.by) for r in a.rooms} == before


def test_reflect_twice_restores_the_grid():
    a = Arena.generate(5, seed=2)
    before = {(r.rid, r.bx, r.by) for r in a.rooms}
    a.apply_shift(Shift("reflect", axis="x", index=2))
    a.apply_shift(Shift("reflect", axis="x", index=2))
    assert {(r.rid, r.bx, r.by) for r in a.rooms} == before


def test_row_shift_cycles_after_five_steps():
    a = Arena.generate(5, seed=3)
    before = {(r.rid, r.bx, r.by) for r in a.rooms}
    for _ in range(5):
        a.apply_shift(Shift("row", index=1, direction=1))
    assert {(r.rid, r.bx, r.by) for r in a.rooms} == before


def test_all_seven_pattern_types_exist():
    assert len(PATTERN_TYPES) == 7
    for pt in PATTERN_TYPES:
        rng = random.Random(1)
        rule = Rule.generate(rng, pt)
        engine = PatternEngine(rule, 5)
        arena = Arena.generate(5, seed=3)
        payload = engine.apply(arena)
        assert payload["pattern_type"] == pt
        assert isinstance(payload["moved"], list)


def test_symbol_rule_only_moves_matching_sigils():
    arena = Arena.generate(5, seed=4)
    rule = Rule("symbol", [Shift("swap_sigil", a="spade", b="heart")])
    engine = PatternEngine(rule, 5)
    moved = engine.apply(arena)["moved"]
    assert moved
    assert all(m["sigil"] in ("spade", "heart") for m in moved)


def test_sequential_rule_cycles_its_schedule():
    rule = Rule.generate(random.Random(3), "sequential")
    assert len(rule.sequence) == 4
    engine = PatternEngine(rule, 5)
    arena = Arena.generate(5, seed=3)
    for _ in range(8):
        engine.apply(arena)


def test_conditional_rule_inactive_on_off_cycles():
    rule = Rule.generate(random.Random(7), "conditional")
    active = [rule.is_active(c) for c in range(6)]
    assert any(active) and not all(active)


def test_reachability_after_changes():
    arena = Arena.generate(5, seed=11)
    engine = PatternEngine(Rule.generate(random.Random(11), "rotation"), 5)
    assert reachable_after_changes(arena, engine, START_ROOM, EXIT_ROOM, horizon=5) is True


def test_astar_path_is_connected():
    arena = Arena.generate(5, seed=9)
    path = arena.path(arena.start_room(), arena.exit_room())
    assert path and path[0] == START_ROOM and path[-1] == EXIT_ROOM
    for cur, nxt in zip(path, path[1:]):
        dx, dy = nxt[0] - cur[0], nxt[1] - cur[1]
        assert abs(dx) + abs(dy) == 1
        door = next(d for d, s in STEP.items() if s == (dx, dy))
        assert arena.door_open(arena.room_at(*cur), door)


def test_public_shape():
    pub = Arena.generate(5, seed=1).to_public()
    assert pub["size"] == 5 and len(pub["rooms"]) == 25
    room = pub["rooms"][0]
    assert "doors" in room and "sigil" in room and "code" in room and "open" in room
    assert pub["start_room"] == list(START_ROOM) and pub["exit_room"] == list(EXIT_ROOM)


def test_room_code_roundtrip():
    for y in range(5):
        for x in range(5):
            assert code_to_pos(room_code(x, y)) == (x, y)
    assert code_to_pos("Z9") is None


def test_stage_rules_are_valid():
    for stage in range(1, MAX_STAGE + 1):
        rules = rules_for_stage(stage, seed=2)
        assert len(rules) == stage_config(stage)["rules"]
