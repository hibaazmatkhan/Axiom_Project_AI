import asyncio
import json
from io import BytesIO
from types import SimpleNamespace

from PIL import Image
from fastapi.testclient import TestClient

from app import audit, avatar_store, config, db, main as main_module
from app.auth import AuthUser
from app.game import Room
from app.main import app, get_current_user, get_verified_user


class FakeWebSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, payload):
        self.messages.append(payload)


def _png(width=64, height=None, image_format="PNG"):
    buffer = BytesIO()
    Image.new("RGB", (width, height or width), (200, 40, 60)).save(buffer, format=image_format)
    return buffer.getvalue()


def _auth_user(uid):
    return AuthUser(
        uid=uid,
        email="phase4@example.com",
        email_verified=True,
        name="Phase4",
        picture=None,
        mfa_enabled=False,
        claims={},
    )


def _patch_local_profile(monkeypatch):
    def profile_for(user):
        avatar = db.store.get_avatar(user.uid) or {}
        return {
            "id": user.uid,
            "email": user.email,
            "username": "Phase4",
            "display_name": "Phase4",
            "avatar_url": avatar.get("avatar_url"),
            "character_id": avatar.get("character_id"),
            "email_verified": True,
            "mfa_enabled": False,
            "created_at": 0,
            "updated_at": 0,
        }

    monkeypatch.setattr(main_module, "_ensure_profile", profile_for)


def test_validate_upload_normalizes_any_size_to_square_png():
    for width, height in [(128, 64), (32, 90), (800, 400)]:
        meta = avatar_store.validate_upload(_png(width, height), "image/png")
        side = min(width, height)
        assert meta["width"] == side and meta["height"] == side
        assert meta["content_type"] == "image/png"
        with Image.open(BytesIO(meta["data"])) as image:
            assert image.size == (side, side)
            assert image.format == "PNG"


def test_validate_upload_rejects_bad_inputs():
    for data, content_type in [
        (b"not an image", "image/png"),
        (_png(), "image/gif"),
        (b"\xff\xd8\xffnot-a-real-jpeg", "image/jpeg"),
    ]:
        try:
            avatar_store.validate_upload(data, content_type)
        except avatar_store.AvatarInvalid:
            continue
        raise AssertionError(f"invalid input was accepted: {content_type}")


def test_upload_endpoint_accepts_wide_image(monkeypatch):
    uid = "phase4-wide-upload"
    stored = {}

    def fake_upload(user_uid, data, content_type):
        stored.update(uid=user_uid, data=data, content_type=content_type)
        return f"{user_uid}/avatar.png", f"https://example.test/{user_uid}/avatar.png"

    monkeypatch.setattr(avatar_store, "upload", fake_upload)
    monkeypatch.setattr(config, "supabase_configured", lambda: False)
    _patch_local_profile(monkeypatch)
    app.dependency_overrides[get_current_user] = lambda: _auth_user(uid)
    try:
        response = TestClient(app).post(
            "/api/me/avatar/upload",
            files={"file": ("wide.png", _png(640, 320), "image/png")},
        )
        assert response.status_code == 200
        assert stored["uid"] == uid
        assert stored["content_type"] == "image/png"
        with Image.open(BytesIO(stored["data"])) as image:
            assert image.size == (320, 320)
        assert response.json()["profile"]["avatar_url"].endswith(f"{uid}/avatar.png")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.store.clear_avatar(uid)


def test_guest_avatar_is_allowlisted():
    character_id, url = avatar_store.guest_avatar({"character_id": "arisu"})
    assert character_id == "arisu"
    assert url == "/avatars/characters/arisu.png"
    assert avatar_store.guest_avatar({"character_id": "unknown"}) == (None, None)


def test_pfp_preset_endpoint_updates_profile_and_cleans_storage(monkeypatch):
    uid = "phase4-pfp-preset"
    old_path = f"{uid}/old.png"
    db.store.set_avatar(uid, "arisu", "/avatars/characters/arisu.png", {"storage_path": old_path})
    deleted = []
    monkeypatch.setattr(avatar_store, "delete_storage", deleted.append)
    monkeypatch.setattr(config, "supabase_configured", lambda: False)
    _patch_local_profile(monkeypatch)
    app.dependency_overrides[get_current_user] = lambda: _auth_user(uid)
    try:
        client = TestClient(app)
        response = client.put("/api/me/avatar/preset", json={"preset_id": "spade"})
        assert response.status_code == 200
        profile = response.json()["profile"]
        assert profile["avatar_url"] == "/avatars/pfp/spade.png"
        assert profile["character_id"] is None
        assert deleted == [old_path]

        rejected = client.put("/api/me/avatar/preset", json={"preset_id": "unknown"})
        assert rejected.status_code == 400
        assert deleted == [old_path]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.store.clear_avatar(uid)


def test_delete_avatar_endpoint_cleans_storage(monkeypatch):
    uid = "phase4-pfp-delete"
    old_path = f"{uid}/old.png"
    db.store.set_avatar(uid, None, "https://example.test/old.png", {"storage_path": old_path})
    deleted = []
    monkeypatch.setattr(avatar_store, "delete_storage", deleted.append)
    monkeypatch.setattr(config, "supabase_configured", lambda: False)
    _patch_local_profile(monkeypatch)
    app.dependency_overrides[get_current_user] = lambda: _auth_user(uid)
    try:
        response = TestClient(app).delete("/api/me/avatar")
        assert response.status_code == 200
        assert response.json()["profile"]["avatar_url"] is None
        assert deleted == [old_path]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.store.clear_avatar(uid)


def test_storage_paths_are_confined_to_owner(monkeypatch):
    monkeypatch.setattr(config, "supabase_configured", lambda: False)
    db.store.set_avatar("safe-user", None, None, {"storage_path": "safe-user/avatar.png"})
    db.store.set_avatar("bad-user", None, None, {"storage_path": "../safe-user/avatar.png"})
    assert avatar_store.storage_path_for("safe-user") == "safe-user/avatar.png"
    assert avatar_store.storage_path_for("bad-user") is None


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
    app.dependency_overrides[get_verified_user] = lambda: _auth_user(uid)
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
            delete_log = c.execute(
                "SELECT firebase_uid FROM audit_logs WHERE kind=? ORDER BY rowid DESC LIMIT 1",
                ("data_delete",),
            ).fetchone()
        assert all(p.get("uid") != uid for p in json.loads(summary["summary"])["players"])
        assert delete_log["firebase_uid"] == uid
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
