"""Multiplayer consistency (O1) and solvability (O6) checks.

Proposal targets:
  O1 - four clients stay in an identical game state across 100 grid shifts
  O6 - every arena state the team must pass through can reach the exit
"""
import random

from app.arena import EXIT_ROOM, START_ROOM, reachable_after_changes
from app.game import Player, Room
from app.patterns import PatternEngine, Rule
from app.roles import ROLES, filter_round, role_for_slot


def _make_room(seed=1234, players=4):
    room = Room("CONS", seed=seed, round_seconds=60)
    room.status = "running"
    rid = room.arena.start_room().rid
    for i in range(players):
        room.players[f"p{i + 1}"] = Player(f"p{i + 1}", f"sim{i}", i, "#fff",
                                          role_for_slot(i), rid)
    return room


def test_four_clients_see_identical_state_across_100_changes():
    room = _make_room()
    fingerprints = []
    for _ in range(100):
        payload = room.step_round()
        snaps = [room.snapshot(p) for p in room.players.values()]
        layouts = {tuple((r["code"], r["id"]) for r in s["arena"]["rooms"]) for s in snaps}
        assert len(layouts) == 1, "clients diverged on the arena layout"
        assert len({s["round"] for s in snaps}) == 1
        fingerprints.append(payload["round"])
    assert len(fingerprints) == 100
    assert room.round == 100


def test_players_always_inside_a_valid_room():
    room = _make_room()
    for _ in range(100):
        room.step_round()
        for p in room.players.values():
            assert room.arena.room_by_id(p.room_id) is not None, f"{p.name} outside the grid"


def test_arena_remains_solvable_across_the_change_cycle():
    room = _make_room()
    for _ in range(60):
        room.step_round()
        assert reachable_after_changes(room.arena, room.engines, START_ROOM,
                                       EXIT_ROOM, horizon=3), "arena became unsolvable"


def test_each_role_receives_a_distinct_information_slice():
    payload = {
        "round": 1, "pattern_type": "symbol", "next_round_in": 5,
        "moved": [{"from": [1, 1], "to": [1, 2], "code_from": "B2",
                   "code_to": "B3", "sigil": "spade"}],
        "visions": {"B2": {"rid": "r6", "sigil": "spade", "doors": {
            "N": {"future": "open", "truth": "open", "color": "red", "capacity": 2}}}},
        "dice": {"B2": {"room": "B2", "rid": "r6", "doors": {
            "N": {"color": "red", "roll": 2, "capacity": 2}}}},
    }
    views = {r: filter_round(payload, r, {"old": True}) for r in ROLES}
    assert "sigil" not in views["navigator"]["moved"][0]
    assert views["oracle"]["moved"][0]["sigil"] == "spade"
    assert views["timekeeper"]["moved"] == [] and views["timekeeper"]["dice"]
    assert views["archivist"]["moved"] == [] and views["archivist"]["previous"]
    assert "spade" not in str(views["navigator"])
    assert "spade" not in str(views["timekeeper"])
    assert "spade" not in str(views["archivist"])


def test_reachability_check_does_not_advance_the_live_pattern_sequence():
    """The time-expanded check must not consume the real rule cycles."""
    room = _make_room()
    engine = room.engines[0]
    before = engine.cycle
    reachable_after_changes(room.arena, room.engines, START_ROOM, EXIT_ROOM, horizon=4)
    assert engine.cycle == before, "simulation leaked into the live engine"


def test_sequential_rule_keeps_its_schedule_across_transitions():
    room = _make_room()
    rule = Rule.generate(random.Random(room.seed), "sequential")
    engine = PatternEngine(rule, room.arena.size)
    room.engines = [engine]
    kinds = []
    for _ in range(len(rule.sequence) * 2):
        result = engine.apply(room.arena)
        kinds.append(tuple(op["kind"] for op in result["ops"]))
    assert all(len(k) == 1 for k in kinds), "each cycle must consume one scheduled op"
    n = len(rule.sequence)
    assert kinds[:n] == kinds[n:2 * n], "the schedule must repeat after one full pass"
