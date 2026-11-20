import base64
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from avatar_router import create_avatar_router


def build_client(*, taken=False, max_upload_bytes=2 * 1024 * 1024):
    calls = []

    def update_profile(uid, patch):
        calls.append((uid, patch))
        return {"username": "stale", "avatar_url": None, "avatar_preset_id": None, "character_id": None, **patch}

    app = FastAPI()
    app.include_router(
        create_avatar_router(
            current_user=lambda: SimpleNamespace(uid="u1", username="stale"),
            update_profile=update_profile,
            username_taken=lambda username, uid: taken,
            upload_image=lambda uid, filename, data, content_type: "https://cdn.example.test/pfp.png",
            max_upload_bytes=max_upload_bytes,
        )
    )
    return TestClient(app), calls


def test_presets_endpoint():
    client, _ = build_client()
    response = client.get("/api/avatar/presets")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["presets"]] == ["joker", "spade", "club", "heart", "diamond"]
    assert len(response.json()["characters"]) == 16


def test_select_pfp_preset_and_character():
    client, calls = build_client()
    pfp = client.post("/api/avatar/pfp/preset", json={"preset_id": "club"})
    character = client.post("/api/avatar/character", json={"character_id": "rei"})
    assert pfp.status_code == 200
    assert pfp.json()["avatar_preset_id"] == "club"
    assert character.status_code == 200
    assert character.json()["character_id"] == "rei"
    assert calls[-2][1]["avatar_preset_id"] == "club"
    assert calls[-1][1]["character_id"] == "rei"


def test_rejects_unknown_ids():
    client, _ = build_client()
    assert client.post("/api/avatar/pfp/preset", json={"preset_id": "arisu"}).status_code == 400
    assert client.post("/api/avatar/character", json={"character_id": "joker"}).status_code == 400


def test_username_validation_and_conflict():
    client, calls = build_client()
    invalid = client.put("/api/avatar/username", json={"username": "x"})
    assert invalid.status_code == 422 or invalid.status_code == 400
    assert client.put("/api/avatar/username", json={"username": "New_Name-1"}).status_code == 200
    assert calls[-1][1]["username"] == "New_Name-1"

    taken_client, _ = build_client(taken=True)
    conflict = taken_client.put("/api/avatar/username", json={"username": "TakenName"})
    assert conflict.status_code == 409


def test_upload_validation_and_success():
    client, calls = build_client(max_upload_bytes=8)
    encode = lambda value: base64.b64encode(value).decode("ascii")
    invalid_type = client.post("/api/avatar/pfp/upload", json={"content_type": "image/gif", "data": encode(b"gif")})
    invalid_data = client.post("/api/avatar/pfp/upload", json={"content_type": "image/png", "data": "!!!"})
    too_large = client.post("/api/avatar/pfp/upload", json={"content_type": "image/png", "data": encode(b"123456789")})
    valid = client.post("/api/avatar/pfp/upload", json={"content_type": "image/png", "data": encode(b"1234")})
    assert invalid_type.status_code == 415
    assert invalid_data.status_code == 400
    assert too_large.status_code == 413
    assert valid.status_code == 200
    assert valid.json()["avatar_url"] == "https://cdn.example.test/pfp.png"
    assert calls[-1][1]["avatar_url"] == "https://cdn.example.test/pfp.png"
