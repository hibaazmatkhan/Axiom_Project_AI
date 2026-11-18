import pytest

from app import config, db, supabase_match_store
from app.supabase_match_store import SupabaseMatchStore


def _summary():
    return {
        "room": "STORE",
        "seed": 1,
        "winner": 1,
        "cycles": 3,
        "rounds": 3,
        "duration": 12.5,
        "team_skill": 0.7,
        "difficulty": 0.4,
        "eliminated": 0,
        "players": [
            {
                "name": "A",
                "slot": 0,
                "uid": "verified-uid",
                "verified": True,
                "escaped": True,
                "eliminated": False,
                "points": 4,
                "revives": 0,
                "predictions": 2,
                "correct": 1,
                "attrs": {"pattern": 0.5},
                "style": "scout",
            },
            {
                "name": "Guest",
                "slot": 1,
                "uid": "guest-uid",
                "verified": False,
                "escaped": False,
                "eliminated": True,
                "points": 0,
                "revives": 0,
                "predictions": 5,
                "correct": 5,
                "attrs": {"pattern": 1},
                "style": "oracle",
            },
        ],
    }


def test_sqlite_store_persists_only_verified_players(tmp_path):
    store = db.Store(str(tmp_path / "axiom.db"))

    match_id = store.record_match(_summary())

    assert isinstance(match_id, int) and match_id > 0
    assert len(store.match_history_for_uid("verified-uid")) == 1
    assert store.match_history_for_uid("guest-uid") == []

    stats = store.player_stats_for_uid("verified-uid", "A")
    assert stats["matches"] == 1
    assert stats["escapes"] == 1
    assert stats["predictions"] == 2
    assert stats["accuracy"] == 0.5
    assert stats["attributes"] == {"pattern": 0.5}

    leaders = store.leaderboard()
    assert [entry["username"] for entry in leaders] == ["A"]


def test_sqlite_store_keeps_display_name_separate_from_uid(tmp_path):
    store = db.Store(str(tmp_path / "axiom.db"))
    summary = _summary()
    summary["players"] = [dict(summary["players"][0], name="Renamed")]

    store.record_match(summary)
    store.record_match(summary)

    stats = store.player_stats_for_uid("verified-uid", "Renamed")
    assert stats["username"] == "Renamed"
    assert stats["matches"] == 2
    assert store.leaderboard()[0]["username"] == "Renamed"


def test_supabase_store_contract(monkeypatch):
    calls = []

    def fake_rpc(name, payload):
        calls.append((name, payload))
        return {
            "record_match": 9,
            "match_history": [{"id": 9}],
            "player_stats": {"matches": 1},
            "leaderboard": [{"username": "A", "matches": 1}],
        }[name]

    monkeypatch.setattr(supabase_match_store, "_rpc", fake_rpc)
    store = SupabaseMatchStore()

    assert store.record_match({"room": "T"}) == 9
    assert store.match_history_for_uid("verified-uid", 12) == [{"id": 9}]
    assert store.player_stats_for_uid("verified-uid", "A") == {"matches": 1}
    assert store.leaderboard(5) == [{"username": "A", "matches": 1}]

    assert [name for name, _ in calls] == [
        "record_match", "match_history", "player_stats", "leaderboard"
    ]
    assert calls[1][1] == {"p_uid": "verified-uid", "p_limit": 12}
    assert calls[3][1] == {"p_limit": 5}


def test_supabase_selection_fails_loudly_without_credentials(monkeypatch):
    monkeypatch.setattr(config, "MATCH_STORE", "supabase")
    monkeypatch.setattr(config, "supabase_configured", lambda: False)

    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        db._selected_store()
