import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import config, db, main
from app.auth import AuthUser
from app.game import Room
from app.room_registry import RoomRegistry


@pytest.fixture(autouse=True)
def isolated_rooms(monkeypatch):
    clock = [1_000_000.0]
    monkeypatch.setattr(main, "registry", RoomRegistry(clock=lambda: clock[0]))
    monkeypatch.setattr(main, "MIN_PLAYERS", 2)
    monkeypatch.setattr(config, "supabase_configured", lambda: False)
    main.rooms.clear()
    yield clock
    main.rooms.clear()


def _user(uid="u", admin=False):
    return AuthUser(
        uid=uid, email="rooms@example.com", email_verified=True, name="Rooms",
        picture=None, mfa_enabled=False, claims={"admin": True} if admin else {},
    )


def test_create_and_lookup_room():
    client = TestClient(main.app)
    created = client.post("/api/rooms", json={"min_players": 3})
    assert created.status_code == 200
    code = created.json()["code"]
    assert 4 <= len(code) <= 6 and code.isalnum()

    found = client.get(f"/api/rooms/{code}")
    assert found.status_code == 200
    assert found.json() == {
        "room_id": created.json()["room_id"], "code": code,
        "status": "lobby", "players": 0, "connected": 0,
    }
    assert client.get("/api/rooms/NOPE").status_code == 404


def test_reservation_expires(isolated_rooms):
    clock = isolated_rooms
    client = TestClient(main.app)
    code = client.post("/api/rooms").json()["code"]
    clock[0] += 601
    assert client.get(f"/api/rooms/{code}").status_code == 404


def test_quick_match_queues_then_matches(isolated_rooms):
    client = TestClient(main.app)
    first = client.post("/api/rooms/quick-match", json={"client_key": "a"})
    assert first.json() == {"status": "queued", "position": 1}
    assert client.get("/api/rooms/quick-match/a").json() == {"status": "queued", "position": 1}

    second = client.post("/api/rooms/quick-match", json={"client_key": "b"})
    assert second.json()["status"] == "matched"
    code = second.json()["code"]
    assert client.get("/api/rooms/quick-match/a").json() == {"status": "matched", "code": code}
    assert client.get(f"/api/rooms/{code}").status_code == 200
    assert client.get("/api/rooms/quick-match/unknown").status_code == 404
    assert client.post("/api/rooms/quick-match", json={"client_key": " "}).status_code == 400


def test_quick_match_queue_expires(isolated_rooms):
    clock = isolated_rooms
    client = TestClient(main.app)
    client.post("/api/rooms/quick-match", json={"client_key": "stale"})
    clock[0] += 61
    assert client.get("/api/rooms/quick-match/stale").status_code == 404


def test_unknown_room_socket_is_rejected():
    client = TestClient(main.app)
    try:
        with client.websocket_connect("/ws/NOPE") as ws:
            assert ws.receive_json()["code"] == "room_not_found"
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 1008
    except WebSocketDisconnect:
        pass
    assert "NOPE" not in main.rooms


def test_room_code_survives_last_disconnect():
    client = TestClient(main.app)
    code = client.post("/api/rooms").json()["code"]
    assert main.registry.get_reservation(code) is not None

    with client.websocket_connect(f"/ws/{code}?name=First") as ws:
        assert ws.receive_json()["type"] == "welcome"
        assert main.registry.get_reservation(code) is None
        assert code in main.rooms
    assert code not in main.rooms
    assert main.registry.get_reservation(code) is not None

    found = client.get(f"/api/rooms/{code}")
    assert found.status_code == 200
    assert found.json()["status"] == "lobby"


def test_spectator_requires_auth_and_admin(monkeypatch):
    main.rooms["SPEC1"] = Room("SPEC1", seed=1)
    monkeypatch.setattr(main, "verify_token", lambda token: _user(uid="viewer"))
    monkeypatch.setattr(config, "ADMIN_UIDS", set())
    client = TestClient(main.app)

    try:
        with client.websocket_connect("/ws/SPEC1?spectator=1") as ws:
            ws.send_json({"type": "auth", "token": "viewer-token"})
            assert ws.receive_json()["code"] == "admin_required"
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 1008
    except WebSocketDisconnect:
        pass
    assert len(main.rooms["SPEC1"].spectators) == 0


def test_spectator_admin_gets_admin_state_and_is_audited(monkeypatch):
    main.rooms["SPEC2"] = Room("SPEC2", seed=2)
    monkeypatch.setattr(main, "verify_token", lambda token: _user(uid="admin", admin=True))
    client = TestClient(main.app)

    with client.websocket_connect("/ws/SPEC2?spectator=1") as ws:
        ws.send_json({"type": "auth", "token": "admin-token"})
        state = ws.receive_json()
        assert state["type"] == "admin_state" and state["room"] == "SPEC2"
        assert len(main.rooms["SPEC2"].spectators) == 1
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}

    assert len(main.rooms["SPEC2"].spectators) == 0
    with db.store.conn() as c:
        kinds = [row["kind"] for row in c.execute(
            "SELECT kind FROM audit_logs WHERE firebase_uid=? ORDER BY id", ("admin",)
        ).fetchall()]
    assert "spectator_connect" in kinds and "spectator_disconnect" in kinds


def test_spectator_accepts_admin_uid(monkeypatch):
    main.rooms["SPEC4"] = Room("SPEC4", seed=4)
    monkeypatch.setattr(config, "ADMIN_UIDS", {"listed-admin"})
    monkeypatch.setattr(main, "verify_token", lambda token: _user(uid="listed-admin"))
    client = TestClient(main.app)
    with client.websocket_connect("/ws/SPEC4?spectator=1") as ws:
        ws.send_json({"type": "auth", "token": "admin-token"})
        assert ws.receive_json()["type"] == "admin_state"


def test_spectator_without_token_is_rejected(monkeypatch):
    main.rooms["SPEC3"] = Room("SPEC3", seed=3)
    client = TestClient(main.app)
    try:
        with client.websocket_connect("/ws/SPEC3?spectator=1") as ws:
            ws.send_json({"type": "auth", "name": "Guest"})
            assert ws.receive_json()["code"] == "auth_required"
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()
    except WebSocketDisconnect:
        pass
    assert len(main.rooms["SPEC3"].spectators) == 0


def test_spectator_cannot_create_unknown_room(monkeypatch):
    monkeypatch.setattr(main, "verify_token", lambda token: _user(uid="admin", admin=True))
    client = TestClient(main.app)
    try:
        with client.websocket_connect("/ws/NEWROOM?spectator=1") as ws:
            ws.send_json({"type": "auth", "token": "admin-token"})
            assert ws.receive_json()["code"] == "room_not_found"
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()
    except WebSocketDisconnect:
        pass
    assert "NEWROOM" not in main.rooms
