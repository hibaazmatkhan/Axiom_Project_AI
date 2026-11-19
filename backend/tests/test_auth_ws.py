import asyncio

from fastapi.testclient import TestClient

from app import main
from app.auth import AuthTokenError, AuthUser
from app.main import WsIdentity, app


class FakeWebSocket:
    def __init__(self, frames):
        self.frames = list(frames)
        self.sent = []
        self.closed = []

    async def receive_json(self):
        if not self.frames:
            raise AssertionError("no auth frame queued")
        return self.frames.pop(0)

    async def send_json(self, message):
        self.sent.append(message)

    async def close(self, code=1000):
        self.closed.append(code)


def _user():
    return AuthUser(
        uid="firebase-uid",
        email="player@example.com",
        email_verified=True,
        name="Firebase Name",
        picture=None,
        mfa_enabled=False,
        claims={},
    )


def test_ws_auth_frame_creates_guest_identity():
    ws = FakeWebSocket([{"type": "auth", "name": "Frame Guest", "pid": "pid-1"}])

    identity = asyncio.run(main._ws_identity(ws, "Query Guest", "query-pid", True))

    assert identity == WsIdentity(uid=None, name="Frame Guest", pid="pid-1", verified=False)
    assert ws.sent == [] and ws.closed == []


def test_ws_auth_frame_verifies_token_and_profile(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "verify_token", lambda token: calls.append(token) or _user())
    monkeypatch.setattr(
        main.supabase_store,
        "create_or_update_profile",
        lambda user: {"display_name": "Profile Name"},
    )
    ws = FakeWebSocket([{"type": "auth", "token": "id-token"}])

    identity = asyncio.run(main._ws_identity(ws, "Ignored", "", True))

    assert identity == WsIdentity(uid="firebase-uid", name="Profile Name", pid=None, verified=True)
    assert calls == ["id-token"]


def test_ws_rejects_non_auth_first_frame():
    ws = FakeWebSocket([{"type": "ping"}])

    identity = asyncio.run(main._ws_identity(ws, "Player", "", True))

    assert identity is None
    assert ws.sent[0]["code"] == "auth_required"
    assert ws.closed == [1008]


def test_ws_rejects_invalid_token(monkeypatch):
    def invalid(_token):
        raise AuthTokenError("Invalid Firebase ID token.")

    monkeypatch.setattr(main, "verify_token", invalid)
    ws = FakeWebSocket([{"type": "auth", "token": "bad-token"}])

    identity = asyncio.run(main._ws_identity(ws, "Player", "", True))

    assert identity is None
    assert ws.sent[0]["code"] == "auth_invalid"
    assert ws.closed == [1008]


def test_ws_route_accepts_auth_frame_before_game_messages():
    client = TestClient(app)
    with client.websocket_connect("/ws/AUTHFRAME?name=Query&auth=1") as ws:
        ws.send_json({"type": "auth", "name": "Frame Name"})

        welcome = ws.receive_json()

    assert welcome["type"] == "welcome"
    assert any(player["name"] == "Frame Name" for player in welcome["state"]["players"])
