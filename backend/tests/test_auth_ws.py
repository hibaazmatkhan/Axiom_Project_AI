import asyncio

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import auth, avatar_store, config, main
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

    expected_avatar = f"/avatars/pfp/{avatar_store.default_pfp_id('pid-1')}.png"
    assert identity == WsIdentity(
        uid=None, name="Frame Guest", pid="pid-1", verified=False,
        avatar_url=expected_avatar, character_id=None,
    )
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

    expected_avatar = f"/avatars/pfp/{avatar_store.default_pfp_id('firebase-uid')}.png"
    assert identity == WsIdentity(
        uid="firebase-uid", name="Profile Name", pid=None, verified=True,
        avatar_url=expected_avatar, character_id=None,
    )
    assert calls == ["id-token"]


def test_ws_verified_flag_uses_token_even_when_profile_lookup_fails(monkeypatch, caplog):
    monkeypatch.setattr(main, "verify_token", lambda token: _user())

    def unavailable(_user):
        raise main.supabase_store.SupabaseUnavailable("profiles not ready")

    monkeypatch.setattr(main.supabase_store, "create_or_update_profile", unavailable)
    ws = FakeWebSocket([{"type": "auth", "token": "id-token"}])

    with caplog.at_level("WARNING"):
        identity = asyncio.run(main._ws_identity(ws, "Player", "", True))

    assert identity is not None and identity.verified is True
    assert "profile lookup failed during websocket authentication" in caplog.text


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
    code = client.post("/api/rooms", json={"min_players": 1}).json()["code"]
    with client.websocket_connect(f"/ws/{code}?name=Query&auth=1") as ws:
        ws.send_json({"type": "auth", "name": "Frame Name"})

        welcome = ws.receive_json()

    assert welcome["type"] == "welcome"
    assert any(player["name"] == "Frame Name" for player in welcome["state"]["players"])


def test_app_check_enforcement_is_optional(monkeypatch):
    monkeypatch.setattr(config, "APP_CHECK_ENFORCE", False)
    assert auth.enforce_app_check(None) is None


def test_app_check_enforcement_rejects_missing_token(monkeypatch):
    monkeypatch.setattr(config, "APP_CHECK_ENFORCE", True)
    monkeypatch.setattr(config, "firebase_configured", lambda: True)
    with pytest.raises(HTTPException) as exc:
        auth.enforce_app_check(None)
    assert exc.value.status_code == 403


def test_app_check_enforcement_explains_missing_firebase_config(monkeypatch):
    monkeypatch.setattr(config, "APP_CHECK_ENFORCE", True)
    monkeypatch.setattr(config, "firebase_configured", lambda: False)
    with pytest.raises(HTTPException) as exc:
        auth.enforce_app_check("token")
    assert exc.value.status_code == 503
    assert "FIREBASE_PROJECT_ID" in exc.value.detail
    assert "APP_CHECK_ENFORCE" in exc.value.detail


def test_app_check_enforcement_accepts_verified_token(monkeypatch):
    monkeypatch.setattr(config, "APP_CHECK_ENFORCE", True)
    monkeypatch.setattr(config, "firebase_configured", lambda: True)
    monkeypatch.setattr(auth, "verify_app_check", lambda token: {"app_check": token})
    assert auth.enforce_app_check("valid-token") is None
