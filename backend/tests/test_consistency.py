"""Multiplayer consistency (O1) and solvability (O6) checks.

Proposal targets:
  O1 - four clients stay in an identical game state across 100 maze changes
  O6 - every maze state the team must pass through can reach the exit
"""
from app.game import Room
from app.maze import reachable_after_changes
from app.roles import ROLES


def _make_room(seed=1234, players=4):
    room = Room("CONS", seed=seed, transition_seconds=60)
    room.status = "running"
    for i in range(players):
        from app.game import Player
        from app.roles import role_for_slot
        x, y = room.maze.start
        room.players[f"p{i + 1}"] = Player(f"p{i + 1}", f"sim{i}", i, "#fff",
                                          role_for_slot(i), x, y)
    return room


def test_four_clients_see_identical_state_across_100_changes():
    room = _make_room()
    fingerprints = []
    for _ in range(100):
        payload = room.step_transition()
        # every client is served the same authoritative snapshot
        snaps = [room.snapshot(p) for p in room.players.values()]
        tiles = {tuple(s["maze"]["tiles"]) for s in snaps}
        assert len(tiles) == 1, "clients diverged on the maze layout"
        assert len({s["cycle"] for s in snaps}) == 1
        fingerprints.append(payload["cycle"])
    assert len(fingerprints) == 100
    assert room.cycle == 100


def test_player_positions_stay_valid_across_100_changes():
    room = _make_room()
    for _ in range(100):
        room.step_transition()
        for p in room.players.values():
            assert room.maze.is_open(p.x, p.y), f"{p.name} stuck in a wall"


def test_maze_remains_solvable_across_the_change_cycle():
    room = _make_room()
    for _ in range(60):
        room.step_transition()
        assert reachable_after_changes(room.maze, room.engines[0], room.maze.start,
                                       room.maze.exit, horizon=3), "maze became unsolvable"


def test_each_role_receives_a_distinct_information_slice():
    from app.roles import filter_transition
    payload = {"cycle": 1, "pattern_type": "symbol",
               "moved": [{"bx": 1, "by": 1, "symbol": "triangle"}],
               "next_transition_in": 5}
    views = {r: filter_transition(payload, r, None) for r in ROLES}
    assert "symbol" not in views["mover"]["moved"][0]
    assert views["symbolist"]["moved"][0]["symbol"] == "triangle"
    assert views["chronologist"]["moved"] == []
    assert views["archivist"]["moved"] == []
    # no role ever receives the raw symbol of a block it should not know about
    assert "triangle" not in str(views["mover"])
    assert "triangle" not in str(views["chronologist"])
    assert "triangle" not in str(views["archivist"])


def test_reachability_check_does_not_advance_the_live_pattern_sequence():
    """The time-expanded check must not consume the real rule cycles."""
    room = _make_room()
    engine = room.engines[0]
    before = engine.cycle
    from app.maze import reachable_after_changes
    reachable_after_changes(room.maze, room.engines, room.maze.start, room.maze.exit, horizon=4)
    assert engine.cycle == before, "simulation leaked into the live engine"


def test_sequential_rule_keeps_its_schedule_across_transitions():
    room = _make_room()
    room.stage = 2
    from app.stages import rules_for_stage
    from app.patterns import PatternEngine
    rule = rules_for_stage(2, seed=room.seed)[0]
    if rule.pattern_type != "sequential":
        rule.sequence = ["triangle", "circle", "square"]
    engine = PatternEngine(rule)
    room.engines = [engine]
    seen = []
    for _ in range(6):
        engine.apply(room.maze)
        seen.append(engine.rule.sequence[engine.cycle % 3])
    # each cycle consumes exactly one schedule slot
    assert len(set(seen)) == 3
