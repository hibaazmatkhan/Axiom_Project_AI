from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from app import avatar_store, config, supabase_store
from app.supabase_store import SupabaseUnavailable
from app.auth import AuthUser
from app.main import app, get_current_user
from app.supabase_store import InvalidUsername


def _user(uid="supa-uid"):
    return AuthUser(
        uid=uid, email="supa@example.com", email_verified=True, name="Supa",
        picture=None, mfa_enabled=True, claims={},
    )


@pytest.fixture
def supabase_state(monkeypatch):
    state = {"profiles": {}, "avatars": {}, "calls": []}

    def filtered(rows, query):
        params = parse_qs(query.lstrip("?"))
        for key, values in params.items():
            if key in {"select", "limit", "on_conflict"}:
                continue
            raw = values[0]
            if raw.startswith("eq."):
                expected = raw[3:]
                rows = [row for row in rows if str(row.get(key, "")) == expected]
            elif raw.startswith("ilike."):
                expected = raw[6:].replace("%", "").lower()
                rows = [row for row in rows if expected in str(row.get(key, "")).lower()]
        return rows

    def fake_request(method, path, *, query="", json=None, prefer=None):
        table = path.split("?", 1)[0]
        state["calls"].append((method, table))
        if method == "GET":
            rows = state.get(table, {})
            return filtered(list(rows.values()) if isinstance(rows, dict) else list(rows), query)
        if method == "POST" and table in state:
            row = dict(json or {})
            if table == "profiles":
                key = row["id"]
            else:
                key = row["firebase_uid"]
            state[table][key] = row
            return [row] if "return=representation" in (prefer or "") else None
        if method == "PATCH" and table in state:
            key_column = "id" if table == "profiles" else "firebase_uid"
            params = parse_qs(query.lstrip("?"))
            for raw in params.get(key_column, []):
                if raw.startswith("eq."):
                    key = raw[3:]
                    if key in state[table]:
                        state[table][key].update(json or {})
            return list(state[table].values()) if "return=representation" in (prefer or "") else None
        if method == "DELETE" and table in state:
            params = parse_qs(query.lstrip("?"))
            key_column = "id" if table == "profiles" else "firebase_uid"
            for raw in params.get(key_column, []):
                if raw.startswith("eq."):
                    state[table].pop(raw[3:], None)
            return None
        return []

    monkeypatch.setattr(config, "supabase_configured", lambda: True)
    monkeypatch.setattr(supabase_store, "_schema_ready", False)
    monkeypatch.setattr(supabase_store, "_request", fake_request)
    return state


def test_supabase_avatar_round_trip_and_cleanup(supabase_state):
    uid = "round-trip"
    path = f"{uid}/avatar.png"
    avatar_store.persist(
        uid, None, f"https://example.test/{path}",
        {"storage_path": path, "content_type": "image/png", "bytes": 12},
    )

    assert supabase_state["avatars"][uid]["storage_path"] == path
    assert avatar_store.storage_path_for(uid) == path
    assert uid in supabase_state["profiles"]

    deleted = []
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(avatar_store, "delete_storage", deleted.append)
    try:
        avatar_store.clear_uploaded_storage(uid)
    finally:
        monkeypatch.undo()
    assert deleted == [path]

    avatar_store.persist(uid, None, "/avatars/pfp/spade.png")
    assert supabase_state["avatars"][uid]["storage_path"] is None
    avatar_store.clear(uid)
    assert uid not in supabase_state["avatars"]
    assert supabase_state["profiles"][uid]["avatar_url"] is None


def test_supabase_avatar_creates_profile_before_write(supabase_state):
    uid = "fk-safe"
    assert uid not in supabase_state["profiles"]
    avatar_store.persist(uid, None, f"https://example.test/{uid}/avatar.png")
    profile_calls = [i for i, call in enumerate(supabase_state["calls"])
                     if call == ("POST", "profiles")]
    avatar_calls = [i for i, call in enumerate(supabase_state["calls"])
                    if call == ("POST", "avatars")]
    assert profile_calls and avatar_calls and profile_calls[0] < avatar_calls[0]


def test_schema_readiness_checks_all_persistence_tables(monkeypatch):
    checked = []
    monkeypatch.setattr(supabase_store, "_schema_ready", False)
    monkeypatch.setattr(
        supabase_store, "_request",
        lambda method, path, **kwargs: checked.append(path) or [],
    )
    supabase_store.ensure_schema()
    assert set(checked) == {"profiles", "avatars", "rooms", "audit_logs"}


def test_supabase_errors_include_endpoint_and_postgrest_details(monkeypatch):
    class Response:
        status_code = 404
        content = b"{}"
        text = '{"code":"42P01","message":"relation does not exist"}'

        def json(self):
            return {"code": "42P01", "message": "relation does not exist"}

    monkeypatch.setattr(config, "supabase_configured", lambda: True)
    monkeypatch.setattr(httpx.Client, "request", lambda self, *args, **kwargs: Response())
    with pytest.raises(SupabaseUnavailable) as exc:
        supabase_store._request("GET", "avatars", query="select=*&limit=0")
    message = str(exc.value)
    assert "GET /rest/v1/avatars" in message
    assert "42P01" in message and "relation does not exist" in message
    assert "003_phase4_avatar.sql" in message


def test_username_cleanup_is_ascii_only_and_validated():
    assert supabase_store._clean_username("Üser—名!") == "ser"
    assert supabase_store._clean_username("aña") == "aa"
    for invalid in ("ab", "éééé", "!!!"):
        with pytest.raises(InvalidUsername):
            supabase_store._validate_username(invalid)


def test_generated_username_is_validated(monkeypatch):
    validated = []
    original = supabase_store._validate_username

    def spy(value):
        validated.append(value)
        return original(value)

    monkeypatch.setattr(supabase_store, "_validate_username", spy)
    monkeypatch.setattr(supabase_store, "get_profile_by_username", lambda name: None)
    generated = supabase_store._default_username(_user())
    assert supabase_store._USERNAME_RE.fullmatch(generated)
    assert validated


def test_profile_public_prefers_db_mfa_over_token():
    profile = {
        "id": "mfa-uid", "username": "mfa", "display_name": "MFA",
        "mfa_enabled": False,
    }
    user = _user("mfa-uid")
    assert supabase_store.profile_public(profile, user)["mfa_enabled"] is False
    profile_without_claim = {k: v for k, v in profile.items() if k != "mfa_enabled"}
    assert supabase_store.profile_public(profile_without_claim, user)["mfa_enabled"] is True


def test_invalid_username_is_400_and_conflict_is_409(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _user()
    try:
        def invalid(*_args, **_kwargs):
            raise InvalidUsername("bad username")

        def conflict(*_args, **_kwargs):
            raise supabase_store.UsernameTaken("taken")

        monkeypatch.setattr(supabase_store, "create_or_update_profile", invalid)
        bad = TestClient(app).put("/api/me/profile", json={"username": "ab!"})
        assert bad.status_code == 400

        monkeypatch.setattr(supabase_store, "create_or_update_profile", conflict)
        taken = TestClient(app).put("/api/me/profile", json={"username": "taken"})
        assert taken.status_code == 409
    finally:
        app.dependency_overrides.pop(get_current_user, None)
