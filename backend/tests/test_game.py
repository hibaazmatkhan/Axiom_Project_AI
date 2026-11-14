"""Server tests (v3): round transitions, door movement, lockdown, cheat
rejection, prediction, asymmetric information, puzzles, reconnect and limits."""
import asyncio
from contextlib import ExitStack

from fastapi.testclient import TestClient

from app.arena import DIRECTIONS, STEP
from app.game import Player, Room
from app.main import app
from app.roles import ROLES, filter_round, role_for_slot


def _player(room, pid="a", slot=0, role=None):
    return Player(pid, pid.upper(), slot, "#fff", role or role_for_slot(slot),
                  room.arena.start_room().rid)


def _open_door(room, arena_room=None):
    r = arena_room or room.arena.start_room()
    return next((d for d in DIRECTIONS if room.arena.door_open(r, d)), None)


def _direction(cur, nxt):
    delta = (nxt[0] - cur[0], nxt[1] - cur[1])
    return next(d for d, s in STEP.items() if s == delta)


def test_round_advances_and_shifts_grid():
    room = Room("T", seed=7, round_seconds=1)
    room.players["a"] = _player(room)
    payload = room.step_round()
    assert payload["type"] == "round" and payload["round"] == 1
    assert payload["arena"]["size"] == 5
    assert "clauses" not in str(payload)


def test_snapshot_is_filtered_by_role():
    room = Room("T", seed=7)
    p = _player(room, role="oracle")
    snap = room.snapshot(p)
    assert snap["role"] == "oracle"
    assert "rule_count" in snap and "dice" in snap
    assert snap["you"]["room_id"] == p.room_id


def test_filter_round_hides_data_per_role():
    payload = {
        "round": 1, "pattern_type": "symbol", "next_round_in": 5,
        "moved": [{"from": [0, 0], "to": [0, 1], "code_from": "A1",
                   "code_to": "A2", "sigil": "spade"}],
        "visions": {"A1": {"rid": "r0", "sigil": "spade", "doors": {
            "N": {"future": "open", "truth": "open", "color": "red", "capacity": 3}}}},
        "dice": {"A1": {"room": "A1", "rid": "r0", "doors": {
            "N": {"color": "red", "roll": 3, "capacity": 3}}}},
    }
    nav = filter_round(payload, "navigator", None)
    oracle = filter_round(payload, "oracle", None)
    keeper = filter_round(payload, "timekeeper", None)
    arch = filter_round(payload, "archivist", None)
    assert "sigil" not in nav["moved"][0]
    assert oracle["moved"][0]["sigil"] == "spade"
    assert keeper["moved"] == [] and keeper["dice"]
    assert arch["moved"] == [] and "previous" in arch


def test_role_assignment_covers_four_roles():
    assert {role_for_slot(i) for i in range(4)} == set(ROLES)


def test_join_welcome_and_move():
    client = TestClient(app)
    with client.websocket_connect("/ws/MOVE?name=Hiba") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "welcome"
        state = msg["state"]
        assert state["you"]["room_code"] == "C3"
        door = next((d for d, v in state["you"]["doors"].items() if v["open"]), None)
        assert door is not None
        ws.send_json({"type": "ready", "value": True})
        ws.send_json({"type": "choose_door", "door": door})
        for _ in range(20):
            m = ws.receive_json()
            if m["type"] == "door_result":
                assert m["door"] == door
                break
        else:
            raise AssertionError("no door_result received")


def test_rejects_cheating_moves():
    client = TestClient(app)
    with client.websocket_connect("/ws/CHEAT?name=X") as ws:
        ws.receive_json()
        ws.send_json({"type": "move", "dx": 3, "dy": 0})
        ws.send_json({"type": "move", "dx": 1, "dy": 1})
        ws.send_json({"type": "move", "dx": "1", "dy": 0})
        ws.send_json({"type": "ping"})
        for _ in range(6):
            if ws.receive_json()["type"] == "pong":
                break
        else:
            raise AssertionError("no pong")


def test_prediction_scoring():
    room = Room("P", seed=5, round_seconds=1)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    asyncio.run(room.predict(p, {"pattern_type": room.engines[0].rule.pattern_type}))
    assert p.predictions == 1 and p.correct == 1


def test_room_full_after_four():
    client = TestClient(app)
    with ExitStack() as stack:
        for i in range(4):
            stack.enter_context(
                client.websocket_connect(f"/ws/FULLTEST?name=p{i}")).receive_json()
        with client.websocket_connect("/ws/FULLTEST?name=late") as ws:
            assert ws.receive_json()["code"] == "room_full"


def test_puzzle_solution_never_leaks_to_clients():
    room = Room("SEC", seed=3)
    p = _player(room)
    room.players["a"] = p
    room.puzzle = {"question": "q", "options": ["A1", "B2", "C3"],
                   "solution": 1, "clues_by_role": {r: ["c"] for r in ROLES}}
    snap = room.snapshot(p)
    assert snap["puzzle"] is not None
    assert "solution" not in snap["puzzle"]
    assert "clues_by_role" not in snap["puzzle"]
    assert snap["puzzle"]["clues"] == ["c"]


def test_hidden_rule_never_serialised():
    room = Room("SEC2", seed=3)
    p = _player(room)
    room.players["a"] = p
    blob = str(room.snapshot(p))
    assert "clauses" not in blob and "sequence" not in blob


def test_finish_builds_a_valid_summary():
    """Regression: the win path must not raise (it once crashed the match)."""
    room = Room("FIN", seed=9, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    asyncio.run(room.finish(won=True))
    assert room.status == "won"
    assert room.nexus.team_report()["players"]


def test_door_crossing_costs_one_point():
    room = Room("COST", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    for r in room.arena.rooms:
        for d in DIRECTIONS:
            r.doors[d].capacity = 4
    door = _open_door(room)
    assert door
    before = p.points
    asyncio.run(room.move(p, door=door))
    assert p.points == before - 1
    assert p.room_id != room.arena.start_room().rid


def test_low_capacity_door_locks_the_player():
    room = Room("LOCKD", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    door = _open_door(room)
    assert door
    start = room.arena.start_room()
    start.doors[door].capacity = 0
    asyncio.run(room.move(p, door=door))
    assert p.locked and p.room_id == start.rid


def test_solo_player_can_reach_exit_with_door_cost():
    """The 15-point economy must allow a full route to the exit."""
    room = Room("WIN2", seed=7, round_seconds=60)
    room.status = "running"
    room.arena.exit_unsealed = True
    for r in room.arena.rooms:
        r.sanction = 0
        for d in DIRECTIONS:
            r.doors[d].capacity = 9
    p = _player(room)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    path = room.arena.path(room.arena.start_room(), room.arena.exit_room())
    assert path
    cur = path[0]
    for nxt in path[1:]:
        p.last_move = 0
        p.last_room_id = None
        p.entered_round = -1
        asyncio.run(room.move(p, door=_direction(cur, nxt)))
        cur = nxt
        if p.escaped or p.eliminated:
            break
    assert p.escaped, f"player did not escape (points {p.points})"
    assert room.status == "won"


def test_all_players_at_unsealed_exit_triggers_win():
    room = Room("WIN", seed=9, round_seconds=60)
    room.status = "running"
    room.arena.exit_unsealed = True
    p = _player(room)
    p.room_id = room.arena.exit_room().rid
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    asyncio.run(room._check_endings())
    assert room.status == "won" and p.escaped


def test_sealed_exit_blocks_the_win():
    room = Room("WIN3", seed=9, round_seconds=60)
    room.status = "running"
    p = _player(room)
    p.room_id = room.arena.exit_room().rid
    room.players["a"] = p
    asyncio.run(room._check_endings())
    assert room.status == "running" and not p.escaped


def test_nexus_updates_skill_between_rounds():
    """Regression: NEXUS must re-read the team each round, not just at the end."""
    room = Room("NX", seed=3, round_seconds=30)
    p = _player(room)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    room.step_round()
    before = room.nexus.team_skill
    room.log("a", "predict", {"guess": {}})
    room.log("a", "predict_ok", {"score": 1.0})
    room.log("a", "share", {"text": "left side"})
    room.log("a", "puzzle_ok", {"choice": 0})
    room.step_round()
    assert room.nexus.team_skill > before
    assert room.nexus.last_action is not None
    assert room.nexus.team_report()["players"]


def test_nexus_defaults_to_a_neutral_team_skill():
    room = Room("NX2", seed=3, round_seconds=30)
    p = _player(room)
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    room.step_round()
    assert 0.3 < room.nexus.team_skill < 0.7


def test_rate_limiting_rejects_flood():
    room = Room("RL", seed=1)
    p = _player(room)
    import time
    now = time.monotonic()
    allowed = sum(1 for _ in range(30) if p.allow(now))
    assert allowed == 14


def test_reconnect_restores_player():
    room = Room("RC", seed=1)

    async def scenario():
        p = await room.join(None, "A")
        pid = p.id
        await room.leave(p)
        assert not p.connected
        again = await room.join(None, "A", pid)
        return pid, again

    pid, again = asyncio.run(scenario())
    assert again.id == pid and again.connected


def test_locked_player_needs_two_helpers():
    room = Room("LOCK", seed=4, round_seconds=60)
    room.status = "running"
    target = _player(room, "t", 0, "navigator")
    target.locked = True
    helper = _player(room, "h", 1, "oracle")
    room.players = {"t": target, "h": helper}
    asyncio.run(room.unlock(helper, "t"))
    assert target.locked, "one helper must not free a locked player"
    second = _player(room, "h2", 2, "timekeeper")
    room.players["h2"] = second
    asyncio.run(room.unlock(second, "t"))
    assert not target.locked and target.revives == 1
