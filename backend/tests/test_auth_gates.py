import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import config
from app.auth import AuthUser, require_admin
from app.main import app, get_current_user


def _user(uid="gate-user", verified=True, admin=False):
    return AuthUser(
        uid=uid,
        email="gate@example.com",
        email_verified=verified,
        name="Gate",
        picture=None,
        mfa_enabled=False,
        claims={"admin": True} if admin else {},
    )


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(config, "supabase_configured", lambda: False)
    return TestClient(app)


@pytest.fixture(autouse=True)
def clear_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/me"),
        ("get", "/api/me/history"),
        ("get", "/api/me/export"),
        ("delete", "/api/me"),
        ("post", "/api/me/mfa"),
        ("get", "/api/admin/rooms"),
    ],
)
def test_protected_endpoints_require_auth(client, method, path):
    kwargs = {"json": {"enabled": True}} if method == "post" else {}
    response = client.request(method.upper(), path, **kwargs)
    assert response.status_code == 401, (path, response.text)


def test_history_still_requires_verified_email(client, monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _user(verified=False)
    response = client.get("/api/me/history")
    assert response.status_code == 403
    assert "Verify your email" in response.json()["detail"]


def test_export_and_delete_allow_unverified_current_user(client, monkeypatch):
    uid = "gate-unverified-delete"
    monkeypatch.setattr(config, "supabase_configured", lambda: False)
    app.dependency_overrides[get_current_user] = lambda: _user(uid=uid, verified=False)

    assert client.get("/api/me/export").status_code == 200
    assert client.delete("/api/me").json() == {"ok": True}


def test_mfa_allows_current_user(client, monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _user(verified=False)
    monkeypatch.setattr(
        "app.supabase_store.set_mfa_enabled",
        lambda uid, enabled: {"id": uid, "username": "Gate", "display_name": "Gate",
                              "mfa_enabled": enabled},
    )
    response = client.post("/api/me/mfa", json={"enabled": True})
    assert response.status_code == 200
    assert response.json()["profile"]["mfa_enabled"] is True


def test_admin_rooms_requires_admin(client, monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _user(uid="not-admin")
    response = client.get("/api/admin/rooms")
    assert response.status_code == 403
    assert response.json()["detail"] == "Administrator access is required."

    monkeypatch.setattr(config, "ADMIN_UIDS", {"admin-uid"})
    app.dependency_overrides[get_current_user] = lambda: _user(uid="admin-uid")
    assert client.get("/api/admin/rooms").status_code == 200


def test_require_admin_helper_rejects_non_admin():
    with pytest.raises(HTTPException) as exc:
        require_admin(_user())
    assert exc.value.status_code == 403
