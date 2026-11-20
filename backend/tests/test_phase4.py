import asyncio
import json
from io import BytesIO
from types import SimpleNamespace

from PIL import Image
from fastapi.testclient import TestClient

from app import audit, avatar_store, config, db
from app.auth import AuthUser
from app.game import Room
from app.main import app, get_verified_user


class FakeWebSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, payload):
        self.messages.append(payload)


def _png(size=64):
    buffer = BytesIO()
    Image.new("RGB", (size, size), (200, 40, 60)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_validate_upload_accepts_square_image():
    meta = avatar_store.validate_upload(_png(), "image/png")
    assert meta["width"] == 64 and meta["height"] == 64
    assert meta["content_type"] == "image/png"


def test_validate_upload_rejects_bad_inputs():
    try:
        avatar_store.validate_upload(b"not an image", "image/png")
    except avatar_store.AvatarInvalid:
        pass
    else:
        raise AssertionError("invalid magic bytes were accepted")
    wide = BytesIO()
    Image.new("RGB", (128, 64), (0, 0, 0)).save(wide, format="PNG")
    try:
        avatar_store.validate_upload(wide.getvalue(), "image/png")
    except avatar_store.AvatarInvalid:
        pass
    else:
        raise AssertionError("non-square image was accepted")


def test_guest_avatar_is_allowlisted():
    character_id, url = avatar_store.guest_avatar({"character_id": "arisu"})
    assert character_id == "arisu"
    assert url == "/avatars/characters/arisu.png"
    assert avatar_store.guest_avatar({"character_id": "unknown"}) == (None, None)


def test_join_carries_avatar_into_public_player():
    async def scenario():
        room = Room("AV", seed=3)
        ws = FakeWebSocket()
        return await room.join(
            ws, "Arisu", avatar_url="/avatars/characters/arisu.png",
            character_id="arisu",
        )

    player = asyncio.run(scenario())
    public = player.public()
    assert public["avatar_url"] == "/avatars/characters/arisu.png"
    assert public["character_id"] == "arisu"


def test_ready_change_broadcasts_state():
    async def scenario():
        room = Room("RD", seed=4)
        ws = FakeWebSocket()
        player = await room.join(ws, "Usagi")
        ws.messages.clear()
        await room.handle(player, {"type": "ready", "value": True})
        return ws.messages

    messages = asyncio.run(scenario())
    states = [m for m in messages if m["type"] == "state"]
    assert states
    assert player_is_ready(states[-1])


def player_is_ready(state):
    return any(p["ready"] for p in state["state"]["players"])


def _seed_user(uid):
    db.store.clear_avatar(uid)
    match_id = db.store.record_match({
        "room": "TEST",
        "seed": 1,
        "players": [{"name": "Phase4", "uid": uid, "verified": True, "slot": 0, "points": 3}],
    })
    db.store.set_avatar(uid, "arisu", "/avatars/characters/arisu.png")
    return match_id


def test_export_and_delete_endpoints(monkeypatch):
    uid = "phase4-export-delete"
    match_id = _seed_user(uid)
    monkeypatch.setattr(config, "supabase_configured", lambda: False)
    app.dependency_overrides[get_verified_user] = lambda: AuthUser(
        uid=uid,
        email="phase4@example.com",
        email_verified=True,
        name="Phase4",
        picture=None,
        mfa_enabled=False,
        claims={},
    )
    try:
        client = TestClient(app)
        exported = client.get("/api/me/export")
        assert exported.status_code == 200
        data = exported.json()
        assert data["avatar"]["character_id"] == "arisu"
        assert any(row["id"] == match_id for row in data["history"])

        deleted = client.delete("/api/me")
        assert deleted.status_code == 200 and deleted.json() == {"ok": True}
        assert db.store.get_avatar(uid) is None
        assert not db.store.match_history_for_uid(uid, 10)
        with db.store.conn() as c:
            summary = c.execute("SELECT summary FROM matches WHERE id=?", (match_id,)).fetchone()
        assert all(p.get("uid") != uid for p in json.loads(summary["summary"])["players"])
    finally:
        app.dependency_overrides.pop(get_verified_user, None)


def test_rooms_and_audit_runtime_persist(monkeypatch, tmp_path):
    store = db.Store(str(tmp_path / "phase4-runtime.db"))
    monkeypatch.setattr(db, "store", store)
    monkeypatch.setattr(config, "supabase_configured", lambda: False)
    room = SimpleNamespace(seed=9, status="lobby", stage=1, round=0, players={"a": object()})

    audit.room_upsert("RT9", room)
    audit.log("phase4-user", "room_join", {"room_id": "RT9"})

    with store.conn() as c:
        stored_room = c.execute("SELECT * FROM rooms WHERE id=?", ("RT9",)).fetchone()
        stored_log = c.execute("SELECT * FROM audit_logs WHERE firebase_uid=?", ("phase4-user",)).fetchone()
    assert stored_room["players"] == 1
    assert stored_room["seed"] == 9
    assert json.loads(stored_log["payload"])["room_id"] == "RT9"

    audit.room_delete("RT9")
    with store.conn() as c:
        assert c.execute("SELECT 1 FROM rooms WHERE id=?", ("RT9",)).fetchone() is None
