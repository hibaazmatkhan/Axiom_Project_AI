"""Server tests (v3): round transitions, door movement, lockdown, cheat
rejection, prediction, asymmetric information, exit, reconnect and limits."""
import asyncio
import time
from contextlib import ExitStack

from fastapi.testclient import TestClient

from app.arena import DIRECTIONS, OPPOSITE, STEP
from app import puzzles
from app.game import DELAY_CONFIG, PATHFINDER_REVEAL_COOLDOWN, Player, Room, TemporaryDoor
from app.main import app, rooms
from app.nexus import CLUE_TIERS
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


def _seed_room(code, **kwargs):
    room = Room(code, **kwargs)
    rooms[code] = room
    return room


def test_round_advances_and_shifts_grid():
    room = Room("T", seed=7, round_seconds=1)
    room.players["a"] = _player(room)
    payload = room.step_round()
    assert payload["type"] == "round" and payload["round"] == 1
    assert payload["arena"]["size"] == 5
    assert "clauses" not in str(payload)


def test_next_shift_countdown_varies_by_shift():
    room = Room("RAND", seed=11, round_seconds=20)
    room.players["a"] = _player(room)
    first = room.step_round()["next_round_in"]
    second = room.step_round()["next_round_in"]
    assert first != second
    assert 16 <= first <= 24
    assert 16 <= second <= 24


def test_snapshot_is_filtered_by_role():
    room = Room("T", seed=7)
    p = _player(room, role="oracle")
    snap = room.snapshot(p)
    assert snap["role"] == "oracle"
    assert "rule_count" in snap and snap["dice"] == {}
    assert snap["you"]["room_id"] == p.room_id


def test_snapshot_hides_exit_until_a_player_discovers_it():
    room = Room("HIDE", seed=7)
    p = _player(room)
    room.players[p.id] = p
    snap = room.snapshot(p)
    assert "exit_room" not in snap["arena"]
    assert all("is_exit" not in r for r in snap["arena"]["rooms"])
    assert snap["you"]["exit_found"] is False
    assert snap["you"]["exit_code"] is None


def test_snapshot_hides_sealed_doors_from_arena_and_you():
    room = Room("SEALHIDE", seed=7)
    p = _player(room)
    p.wristband_revealed = True
    room.players[p.id] = p
    start = room.arena.start_room()
    sealed = next(d for d in DIRECTIONS if start.doors[d].sealed)
    snap = room.snapshot(p)
    pub = next(r for r in snap["arena"]["rooms"] if r["code"] == start.code)
    assert all("sealed" not in door for door in pub["doors"].values())
    assert all("sealed" not in door for door in snap["you"]["doors"].values())
    assert snap["wristband"][start.code][sealed] is True


def test_wristband_marks_doorways_blocked_by_the_other_room():
    room = Room("WBLOCK", seed=7)
    p = _player(room)
    p.wristband_revealed = True
    room.players[p.id] = p
    start = room.arena.start_room()
    door = next(d for d in DIRECTIONS if room.arena.door_open(start, d))
    neighbour = room.arena.door_target(start, door)
    neighbour.doors[OPPOSITE[door]].sealed = True

    snap = room.snapshot(p)
    pub_start = next(r for r in snap["arena"]["rooms"] if r["code"] == start.code)
    assert snap["wristband"][start.code][door] is True
    assert pub_start["open"][door] is False
    assert snap["you"]["doors"][door]["open"] is False


def test_wristband_does_not_reveal_d10_seals():
    room = Room("WBROLL", seed=7)
    p = _player(room)
    p.wristband_revealed = True
    room.players[p.id] = p
    start = room.arena.start_room()
    door = next(d for d in DIRECTIONS if room.arena.door_open(start, d))
    start.doors[door].rolled_sealed = True

    snap = room.snapshot(p)
    assert snap["wristband"][start.code][door] is False


def test_pathfinder_reveal_is_neutral_for_others_and_expires_on_shift():
    async def scenario():
        room = Room("PFScan", seed=7, round_seconds=60)
        room.status = "running"
        pathfinder = _player(room, "pf", 0, "pathfinder")
        oracle = _player(room, "or", 1, "oracle")
        room.players = {pathfinder.id: pathfinder, oracle.id: oracle}
        hidden = next(r for r in room.arena.rooms if r.sanction and not r.revealed)
        sealed = next(d for d in DIRECTIONS if room.arena.start_room().doors[d].sealed)

        neutral = room.snapshot(pathfinder)
        assert neutral["wristband"][room.arena.start_room().code][sealed] is False
        assert neutral["wristband_sanctions"] == []
        assert neutral["you"]["wristband_revealed"] is False

        await room.reveal_wristband(oracle)
        assert oracle.wristband_revealed is False

        await room.reveal_wristband(pathfinder)
        revealed = room.snapshot(pathfinder)
        assert pathfinder.wristband_revealed is True
        assert revealed["wristband"][room.arena.start_room().code][sealed] is True
        assert hidden.code in revealed["wristband_sanctions"]
        assert revealed["you"]["wristband_revealed"] is True

        other_view = room.snapshot(oracle)
        assert other_view["wristband_sanctions"] == []
        assert other_view["wristband"][room.arena.start_room().code][sealed] is False

        room.step_round()
        assert pathfinder.wristband_revealed is False
        assert pathfinder.wristband_cooldown_until > time.time()
        expired = room.snapshot(pathfinder)
        assert expired["wristband_sanctions"] == []
        assert expired["wristband"][room.arena.start_room().code][sealed] is False

        await room.reveal_wristband(pathfinder)
        assert pathfinder.wristband_revealed is False
        pathfinder.wristband_cooldown_until = time.time() - 1
        await room.reveal_wristband(pathfinder)
        assert pathfinder.wristband_revealed is True
        assert PATHFINDER_REVEAL_COOLDOWN == 120.0

    asyncio.run(scenario())


def test_clicking_sealed_door_reports_sealed_without_leaking_state():
    room = Room("SEALCLICK", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players[p.id] = p

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    p.ws = FakeWebSocket()
    sealed = next(d for d in DIRECTIONS if room.arena.start_room().doors[d].sealed)
    before = p.points
    asyncio.run(room.open_door(p, sealed))
    result = next(m for m in reversed(p.ws.sent) if m.get("type") == "door_result")
    assert result["accepted"] is False
    assert result["message"] == "That door is sealed."
    assert p.points == before - 1
    assert p.sealed_strikes == 1


def test_two_sealed_clicks_in_same_room_and_round_trigger_lockdown():
    room = Room("SEAL2", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players[p.id] = p

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    p.ws = FakeWebSocket()
    target = next(
        r for r in room.arena.rooms
        if sum(1 for d in DIRECTIONS if r.doors[d].sealed) >= 2
    )
    p.room_id = target.rid
    sealed = [d for d in DIRECTIONS if target.doors[d].sealed]
    assert len(sealed) >= 2
    before = p.points

    asyncio.run(room.open_door(p, sealed[0]))
    assert p.locked is False
    assert p.sealed_strikes == 1
    assert p.points == before - 1
    result = next(m for m in reversed(p.ws.sent) if m.get("type") == "door_result")
    assert result["message"] == "That door is sealed."

    p.last_move = 0
    asyncio.run(room.open_door(p, sealed[1]))
    assert p.locked is True
    assert p.sealed_strikes == 2
    assert p.points == before - 2
    result = next(m for m in reversed(p.ws.sent) if m.get("type") == "door_result")
    assert result["accepted"] is False
    assert result["locked"] is True
    assert "Two sealed doors" in result["message"]

    room.step_round()
    p.locked = False
    p.last_move = 0
    sealed = [d for d in DIRECTIONS if target.doors[d].sealed]
    asyncio.run(room.open_door(p, sealed[0]))
    assert p.locked is False
    assert p.sealed_strikes == 1
    result = next(m for m in reversed(p.ws.sent) if m.get("type") == "door_result")
    assert result["message"] == "That door is sealed."


def test_exit_discovery_is_player_local():
    room = Room("FOUND", seed=7)
    p1 = _player(room, "a", 0)
    p2 = _player(room, "b", 1)
    room.players = {p1.id: p1, p2.id: p2}
    exit_room = room.arena.exit_room()
    asyncio.run(room._complete_crossing(p1, room.arena.start_room(), exit_room, "N"))

    assert p1.exit_found is True
    assert p2.exit_found is False
    assert room.snapshot(p1)["you"]["exit_code"] == exit_room.code
    assert room.snapshot(p2)["you"]["exit_code"] is None


def test_exit_is_visible_through_an_open_door():
    room = Room("SIGHT", seed=7)
    p1 = _player(room, "a", 0)
    p2 = _player(room, "b", 1)
    room.players = {p1.id: p1, p2.id: p2}
    exit_room = room.arena.exit_room()
    near = room.arena.room_at(2, 0)
    p1.room_id = near.rid
    p2.room_id = near.rid
    room.open_doors[frozenset((near.rid, exit_room.rid))] = TemporaryDoor(
        a_rid=near.rid, b_rid=exit_room.rid, a_dir="E", b_dir="W",
        opened_by=p1.id, expires_at=time.time() + 10, cost=1,
    )
    asyncio.run(room._refresh_exit_visibility(p1))
    asyncio.run(room._refresh_exit_visibility(p2))

    assert p1.exit_found is True and p2.exit_found is True
    assert room.snapshot(p1)["you"]["exit_code"] == exit_room.code
    assert room.snapshot(p2)["you"]["exit_code"] == exit_room.code


def test_door_events_do_not_leak_exit_room_to_distant_players():
    room = Room("SIGHTMSG", seed=7, round_seconds=60)
    room.status = "running"
    exit_room = room.arena.exit_room()
    opener = _player(room, "a", 0)
    remote = _player(room, "b", 1)
    opener.room_id = exit_room.rid
    remote.room_id = room.arena.start_room().rid
    room.players = {opener.id: opener, remote.id: remote}

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    opener.ws = FakeWebSocket()
    remote.ws = FakeWebSocket()
    direction = next(d for d in DIRECTIONS if room.arena.door_open(exit_room, d))

    asyncio.run(room.open_door(opener, direction))

    opened_remote = next(m for m in remote.ws.sent if m.get("type") == "door_opened")
    assert opened_remote.get("room_code") is None
    assert opened_remote.get("target_code") is None
    opened_opener = next(m for m in opener.ws.sent if m.get("type") == "door_opened")
    assert opened_opener["room_code"] == exit_room.code
    assert "target_code" in opened_opener

    for temp in room.open_doors.values():
        temp.expires_at = time.time() - 1
    asyncio.run(room.expire_open_doors())

    closed_remote = next(m for m in reversed(remote.ws.sent) if m.get("type") == "door_closed")
    assert closed_remote.get("room_code") is None
    assert closed_remote.get("target_code") is None


def test_filter_round_hides_data_per_role():
    payload = {
        "round": 1, "pattern_type": "symbol", "next_round_in": 5,
        "moved": [{"from": [0, 0], "to": [0, 1], "code_from": "A1",
                   "code_to": "A2", "sigil": "spade"}],
        "visions": {"A1": {"rid": "r0", "sigil": "spade", "doors": {
            "N": {"future": "open", "truth": "open", "color": "red"}}}},
        "dice": {"A1": {"room": "A1", "rid": "r0", "doors": {
            "N": {"color": "red"}}}},
    }
    nav = filter_round(payload, "pathfinder", None)
    oracle = filter_round(payload, "oracle", None)
    keeper = filter_round(payload, "timekeeper", None)
    decoder = filter_round(payload, "decoder", None)
    assert "sigil" not in nav["moved"][0]
    assert oracle["moved"][0]["sigil"] == "spade"
    assert keeper["moved"] == [] and keeper["timing"]["next_in"] == 5
    assert "dice" not in keeper
    assert decoder["moved"] == [] and "timing" not in decoder
    assert "previous" not in decoder and "dice" not in decoder


def test_role_assignment_covers_four_roles():
    assert {role_for_slot(i) for i in range(4)} == set(ROLES)


def test_join_assigns_unique_dynamic_roles():
    async def scenario():
        room = Room("T", seed=23)
        joined = [await room.join(None, f"P{i}") for i in range(4)]
        return room, joined

    room, joined = asyncio.run(scenario())
    assert {p.role for p in joined} == set(ROLES)
    assert set(room.role_pool) == set(ROLES)


def test_join_welcome_and_move():
    client = TestClient(app)
    _seed_room("MOVE", seed=3)
    with client.websocket_connect("/ws/MOVE?name=Hiba") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "welcome"
        assert msg["state"]["you"]["room_code"] == "C3"
        ws.send_json({"type": "ready", "value": True})
        running = None
        for _ in range(4):
            m = ws.receive_json()
            if m["type"] == "state" and m["state"]["status"] == "running":
                running = m["state"]
                break
        assert running is not None
        arena_room = rooms["MOVE"].arena.room_by_id(running["you"]["room_id"])
        door = next((d for d in DIRECTIONS
                     if arena_room and rooms["MOVE"].arena.door_open(arena_room, d)
                     and not arena_room.doors[d].rolled_sealed), None)
        assert door is not None
        ws.send_json({"type": "open_door", "door": door})
        opened = None
        for _ in range(6):
            m = ws.receive_json()
            if m["type"] == "door_opened" and m.get("accepted"):
                opened = m
                break
        assert opened is not None
        assert opened["door"] == door
        assert opened["cost"] == 1
        assert opened["open_until"] > time.time()
        rooms["MOVE"].players[msg["you"]].last_move = 0
        ws.send_json({"type": "cross_door", "door": door})
        for _ in range(6):
            m = ws.receive_json()
            if m["type"] == "room_entered" and m.get("player") == msg["you"]:
                assert m["door"] == door
                assert m.get("to") is None
                assert m.get("from") is None
                break
        else:
            raise AssertionError("no room_entered received")


def test_rejects_cheating_moves():
    client = TestClient(app)
    _seed_room("CHEAT", seed=3)
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
    _seed_room("FULLTEST", seed=3)
    with ExitStack() as stack:
        for i in range(4):
            stack.enter_context(
                client.websocket_connect(f"/ws/FULLTEST?name=p{i}")).receive_json()
        with client.websocket_connect("/ws/FULLTEST?name=late") as ws:
            assert ws.receive_json()["code"] == "room_full"


def test_late_join_rejected_after_match_starts():
    client = TestClient(app)
    _seed_room("STARTED", seed=3)
    with client.websocket_connect("/ws/STARTED?name=first") as first:
        assert first.receive_json()["type"] == "welcome"
        rooms["STARTED"].status = "running"
        with client.websocket_connect("/ws/STARTED?name=late") as late:
            error = late.receive_json()
            assert error["code"] == "game_started"
            assert "already started" in error["message"].lower()


def test_existing_player_can_reconnect_after_match_starts():
    client = TestClient(app)
    _seed_room("RJOIN", seed=3)
    with client.websocket_connect("/ws/RJOIN?name=first") as first:
        pid = first.receive_json()["you"]
        rooms["RJOIN"].status = "running"
        with client.websocket_connect(f"/ws/RJOIN?name=first&pid={pid}&auth=1") as rejoined:
            rejoined.send_json({"type": "auth", "name": "first", "pid": pid})
            welcome = rejoined.receive_json()
            assert welcome["type"] == "welcome"
            assert welcome["you"] == pid


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


def test_opening_a_door_costs_one_point_and_crossing_is_free():
    room = Room("COST", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    door = _open_door(room)
    assert door
    before = p.points
    asyncio.run(room.open_door(p, door=door))
    assert p.points == before - 1
    assert p.room_id == room.arena.start_room().rid
    assert room.open_doors
    p.last_move = 0
    asyncio.run(room.cross_door(p, door=door))
    assert p.points == before - 1
    assert p.room_id != room.arena.start_room().rid


def test_sealed_door_strikes_cost_one_point_and_lock_at_two():
    room = Room("LOCKD", seed=7, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players["a"] = p
    door = _open_door(room)
    assert door
    start = room.arena.start_room()
    start.doors[door].rolled_sealed = True
    before = p.points

    asyncio.run(room.open_door(p, door=door))
    assert p.locked is False
    assert p.room_id == start.rid
    assert p.points == before - 1
    assert p.sealed_strikes == 1
    assert not room.open_doors

    p.last_move = 0
    asyncio.run(room.open_door(p, door=door))
    assert p.locked is True
    assert p.room_id == start.rid
    assert p.points == before - 2
    assert p.sealed_strikes == 2


def test_temporary_door_is_shared_and_expires():
    room = Room("TEMP", seed=7, round_seconds=60)
    room.status = "running"
    opener = _player(room, "a", 0)
    teammate = _player(room, "b", 1)
    room.players = {"a": opener, "b": teammate}
    door = _open_door(room)
    assert door
    asyncio.run(room.open_door(opener, door=door))
    asyncio.run(room.cross_door(teammate, door=door))
    assert teammate.room_id != room.arena.start_room().rid
    for temp in room.open_doors.values():
        temp.expires_at = time.time() - 1
    asyncio.run(room.expire_open_doors())
    assert not room.open_doors
    opener.last_move = 0
    asyncio.run(room.cross_door(opener, door=door))
    assert opener.room_id == room.arena.start_room().rid


def test_solo_player_can_reach_exit_with_door_cost():
    """The 15-point economy must allow a full route to the exit."""
    room = Room("WIN2", seed=7, round_seconds=60)
    room.status = "running"
    for r in room.arena.rooms:
        r.sanction = 0
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
        d = _direction(cur, nxt)
        asyncio.run(room.open_door(p, door=d))
        p.last_move = 0
        asyncio.run(room.cross_door(p, door=d))
        cur = nxt
        if p.escaped or p.eliminated:
            break
    assert p.escaped, f"player did not escape (points {p.points})"
    assert room.status == "won"


def test_all_players_at_exit_triggers_win():
    room = Room("WIN", seed=9, round_seconds=60)
    room.status = "running"
    p = _player(room)
    p.room_id = room.arena.exit_room().rid
    room.players["a"] = p
    room.log("a", "join", {"name": "A", "role": p.role})
    asyncio.run(room._check_endings())
    assert room.status == "won" and p.escaped


def test_team_at_exit_wins_before_match_timer_expires():
    room = Room("TIMEWIN", seed=9, match_seconds=60)
    room.status = "running"
    room.match_deadline = time.time() + 60
    p = _player(room)
    p.room_id = room.arena.exit_room().rid
    room.players["a"] = p
    asyncio.run(room._check_endings())
    assert room.status == "won" and p.escaped


def test_match_timer_expiry_eliminates_living_players():
    room = Room("TIME", seed=9, match_seconds=60)
    room.status = "running"
    room.match_deadline = time.time() - 0.01
    players = [_player(room, "a", 0), _player(room, "b", 1)]
    room.players = {p.id: p for p in players}
    asyncio.run(room._expire_match())
    assert room.status == "over"
    assert all(p.eliminated and not p.escaped for p in players)


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
    room.step_round()
    assert room.nexus.team_skill > before
    assert room.nexus.last_action is not None
    assert room.nexus.team_report()["players"]


def test_director_complexity_commits_once_per_round(monkeypatch):
    room = Room("NXA", seed=13, round_seconds=30)
    room.players["a"] = _player(room)
    initial = room.complexity_override
    monkeypatch.setattr(room.nexus, "decide", lambda *args, **kwargs: {"action": "raise_complexity"})
    room.step_round()
    assert room.complexity_override == initial + 1
    assert room.nexus.complexity_level == initial + 1
    assert room.puzzle.complexity == initial + 1

    monkeypatch.setattr(room.nexus, "decide", lambda *args, **kwargs: {"action": "lower_complexity"})
    room.step_round()
    assert room.complexity_override == initial
    assert room.nexus.complexity_level == initial
    assert room.puzzle.complexity == initial


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
    target = _player(room, "t", 0, "pathfinder")
    target.locked = True
    helper = _player(room, "h", 1, "oracle")
    room.players = {"t": target, "h": helper}
    asyncio.run(room.unlock(helper, "t"))
    assert target.locked, "one helper must not free a locked player"
    second = _player(room, "h2", 2, "timekeeper")
    room.players["h2"] = second
    asyncio.run(room.unlock(second, "t"))
    assert not target.locked and target.revives == 1


def test_sanction_counts_recompute_and_stay_counts_only():
    room = Room("SCOUNT", seed=3, round_seconds=60)
    room.status = "running"
    p = _player(room)
    room.players[p.id] = p
    before_total = room.sanction_total
    before_found = room.sanction_found

    snap = room.snapshot(p)
    assert snap["sanction_total"] == before_total
    assert snap["sanction_found"] == before_found
    hidden = next(r for r in room.arena.rooms if r.sanction and not r.revealed)
    pub_hidden = next(r for r in snap["arena"]["rooms"] if r["id"] == hidden.rid)
    assert pub_hidden["sanction"] is None and pub_hidden["revealed"] is False

    room._apply_director({"action": "add_hazard"})
    assert room.sanction_total == before_total + 1
    assert room.snapshot(p)["sanction_total"] == before_total + 1

    target = next(r for r in room.arena.rooms if r.sanction and not r.revealed)
    asyncio.run(room._complete_crossing(p, room.arena.start_room(), target, "N"))
    after = room.snapshot(p)
    assert after["sanction_found"] == before_found + 1


def test_dealer_clue_is_private_to_near_player():
    room = Room("CLUE", seed=7, round_seconds=60)
    room.status = "running"
    room.engines = []
    hidden = [r for r in room.arena.rooms if r.sanction and not r.revealed]
    near = room.arena.neighbours(hidden[0])[0][1]

    def min_hidden_distance(candidate):
        distances = [d for target in hidden
                     if (d := room.arena.door_distance(candidate, target)) is not None]
        return min(distances) if distances else 99

    far = max((r for r in room.arena.rooms if r.rid != near.rid), key=min_hidden_distance)
    near_player = _player(room, "near", 0)
    far_player = _player(room, "far", 1)
    near_player.room_id = near.rid
    far_player.room_id = far.rid
    room.players = {near_player.id: near_player, far_player.id: far_player}

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    near_player.ws = FakeWebSocket()
    far_player.ws = FakeWebSocket()
    room.nexus.decide = lambda *args, **kwargs: {"action": "give_clue"}
    room.nexus.clue_chance = lambda skill=None: 1.0

    asyncio.run(room.broadcast_round())

    near_clues = [m for m in near_player.ws.sent if m.get("type") == "dealer_clue"]
    far_clues = [m for m in far_player.ws.sent if m.get("type") == "dealer_clue"]
    assert len(near_clues) == 1
    assert far_clues == []
    assert set(near_clues[0]) == {"type", "tier", "text"}
    assert near_clues[0]["tier"] in (1, 2)
    assert near_clues[0]["text"] in CLUE_TIERS[near_clues[0]["tier"]]

    snap = room.snapshot(far_player)
    pub_hidden = next(r for r in snap["arena"]["rooms"] if r["id"] == hidden[0].rid)
    assert pub_hidden["sanction"] is None and pub_hidden["revealed"] is False


class _DelayWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


def _delay_room(seed=37):
    room = Room("DLY", seed=seed, round_seconds=60)
    room.status = "running"
    players = [
        _player(room, "keeper", 0, "timekeeper"),
        _player(room, "decoder", 1, "decoder"),
        _player(room, "path", 2, "pathfinder"),
    ]
    for player in players:
        player.ws = _DelayWebSocket()
        room.players[player.id] = player
    room.next_round_at = time.time() + 30
    return room, players[0], players[1], players[2]


def _message(player, kind):
    return next(m for m in reversed(player.ws.sent) if m.get("type") == kind)


def test_delay_puzzles_are_deterministic_and_solvable():
    for tier in (1, 2, 3):
        first = puzzles.generate(2026, 3, tier)
        assert first == puzzles.generate(2026, 3, tier)
        assert puzzles.verify(first)
        assert len(first["question"].split()) <= 12
        assert puzzles.check_answer(first, first["answer"])
        wrong = (next(s for s in puzzles.SUITS if s != first["answer"])
                 if tier == 3 else {"row": 9, "col": 9})
        assert not puzzles.check_answer(first, wrong)
    for tier in (1, 2, 3):
        for seed in range(50):
            assert puzzles.verify(puzzles.generate(seed, seed, tier))


def test_delay_puzzle_is_private_and_success_changes_only_keeper_delta():
    room, keeper, decoder, pathfinder = _delay_room()
    before = room.next_round_at
    asyncio.run(room.queue_delay(keeper, 1))
    puzzle = _message(decoder, "puzzle")
    key = _message(keeper, "puzzle_key")
    answer = room.delay_puzzle["answer"]

    assert puzzle["question"] and "key_text" not in puzzle
    assert key["key_text"] and "question" not in key and "grids" not in key
    assert not [m for m in keeper.ws.sent if m.get("type") == "puzzle"]
    assert not [m for m in decoder.ws.sent if m.get("type") == "puzzle_key"]
    assert not [m for m in pathfinder.ws.sent if m.get("type") in ("puzzle", "puzzle_key")]
    assert room.delay_attempts[room.stage] == 1

    asyncio.run(room.answer_delay(decoder, puzzle["puzzle_id"], answer))
    assert room.next_round_at > before
    assert room.delay_puzzle is None
    assert room.delay_cooldown_until > time.time()
    assert room.shift_delay_applied == DELAY_CONFIG["delay_s"][1]
    assert room.shift_successes == 1
    for player, has_delta in ((keeper, True), (decoder, False), (pathfinder, False)):
        result = _message(player, "delay_result")
        assert result["ok"] is True
        assert ("delta_s" in result) is has_delta
        assert "next_round_in" not in result


def test_delay_failure_keeps_the_pending_shift_floor():
    room, keeper, decoder, pathfinder = _delay_room()
    room.next_round_at = time.time() + 4
    asyncio.run(room.queue_delay(keeper, 2))
    puzzle_id = room.delay_puzzle["puzzle_id"]

    asyncio.run(room.answer_delay(decoder, puzzle_id, {"row": 9, "col": 9}))
    assert room.next_round_at - time.time() >= DELAY_CONFIG["min_time_before_shift_s"] - 0.1
    assert room.shift_delay_applied == 0
    assert room.shift_successes == 0
    assert _message(decoder, "delay_result")["ok"] is False
    assert "delta_s" not in _message(decoder, "delay_result")
    assert "delta_s" in _message(keeper, "delay_result")
    assert "delta_s" not in _message(pathfinder, "delay_result")


def test_delay_queue_rejects_wrong_role_bad_tier_dead_pair_and_double_answer():
    room, keeper, decoder, pathfinder = _delay_room()
    asyncio.run(room.queue_delay(decoder, 1))
    assert _message(decoder, "error")["code"] == "role_unavailable"

    decoder.connected = False
    asyncio.run(room.queue_delay(keeper, 1))
    assert _message(keeper, "error")["code"] == "delay_pair_unavailable"
    decoder.connected = True

    asyncio.run(room.queue_delay(pathfinder, 1))
    assert _message(pathfinder, "error")["code"] == "role_unavailable"
    asyncio.run(room.queue_delay(keeper, 9))
    assert _message(keeper, "error")["code"] == "bad_tier"

    asyncio.run(room.queue_delay(keeper, 3))
    puzzle_id = room.delay_puzzle["puzzle_id"]
    answer = room.delay_puzzle["answer"]
    asyncio.run(room.answer_delay(keeper, puzzle_id, answer))
    assert _message(keeper, "error")["code"] == "role_unavailable"
    asyncio.run(room.answer_delay(decoder, "stale", answer))
    assert _message(decoder, "error")["code"] == "stale_puzzle"

    asyncio.run(room.answer_delay(decoder, puzzle_id, answer))
    assert room.delay_puzzle is None
    asyncio.run(room.answer_delay(decoder, puzzle_id, answer))
    assert _message(decoder, "error")["code"] == "stale_puzzle"


def test_shift_cancels_delay_without_penalty_attempt_or_cooldown():
    room, keeper, decoder, pathfinder = _delay_room()
    asyncio.run(room.queue_delay(keeper, 3))
    assert room.delay_attempts[room.stage] == 1
    room.next_round_at = time.time() - 1

    room.step_round()
    assert room.delay_puzzle is None
    assert room.delay_deadline is None
    assert room.delay_cooldown_until == 0.0
    assert room._delay_attempts_left() == DELAY_CONFIG["attempts_per_stage"]
    assert any(e["kind"] == "delay_cancelled" for e in room.events)
    assert not [m for m in keeper.ws.sent if m.get("type") == "delay_result"]
    assert not [m for m in decoder.ws.sent if m.get("type") == "delay_result"]


def test_decoder_cannot_move_through_doors_while_delay_puzzle_is_open():
    room, keeper, decoder, pathfinder = _delay_room()
    asyncio.run(room.queue_delay(keeper, 1))
    door = _open_door(room)

    asyncio.run(room.open_door(decoder, door=door))
    assert _message(decoder, "error")["code"] == "decoder_busy"
    asyncio.run(room.cross_door(decoder, door=door))
    assert _message(decoder, "error")["code"] == "decoder_busy"


def test_delay_successes_stack_at_half_rate_and_cap_total():
    room, keeper, decoder, pathfinder = _delay_room()
    room.next_round_at = time.time() + 20

    def solve(tier):
        room.delay_cooldown_until = 0.0
        room.delay_attempts[room.stage] = 0
        asyncio.run(room.queue_delay(keeper, tier))
        puzzle_id = room.delay_puzzle["puzzle_id"]
        answer = room.delay_puzzle["answer"]
        asyncio.run(room.answer_delay(decoder, puzzle_id, answer))
        return _message(keeper, "delay_result")["delta_s"]

    assert round(solve(1)) == DELAY_CONFIG["delay_s"][1]
    assert round(solve(2)) == DELAY_CONFIG["delay_s"][2] * DELAY_CONFIG["second_success_multiplier"]
    assert room.shift_delay_applied == 12
    room.shift_delay_applied = DELAY_CONFIG["max_shift_delay_s"] - 1
    assert round(solve(1)) == 1
    assert room.shift_delay_applied == DELAY_CONFIG["max_shift_delay_s"]
    assert round(solve(1)) == 0
