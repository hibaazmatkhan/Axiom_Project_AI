from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text(encoding="utf-8")


def test_profiles_migration_contract():
    sql = _sql("001_profiles.sql")
    required = [
        "create table if not exists public.profiles",
        "id text primary key",
        "username text not null",
        "display_name text not null",
        "create unique index if not exists profiles_username_lower_idx",
        "alter table public.profiles enable row level security",
        "revoke all on public.profiles from anon, authenticated",
        "grant select, insert, update, delete on public.profiles to service_role",
    ]
    assert all(fragment in sql for fragment in required)


def test_matches_migration_contract():
    sql = _sql("002_matches.sql")
    required = [
        "create table if not exists public.matches",
        "create table if not exists public.match_players",
        "create table if not exists public.player_models",
        "alter table public.matches enable row level security",
        "alter table public.match_players enable row level security",
        "alter table public.player_models enable row level security",
        "revoke all on public.matches, public.match_players, public.player_models from anon, authenticated",
        "grant select, insert, update, delete on public.matches, public.match_players, public.player_models to service_role",
        "create or replace function public.record_match(p_summary jsonb)",
        "create or replace function public.match_history(p_uid text, p_limit integer default 20)",
        "create or replace function public.player_stats(p_uid text, p_username text default null)",
        "create or replace function public.leaderboard(p_limit integer default 10)",
    ]
    assert all(fragment in sql for fragment in required)


def test_matches_migration_protects_ranked_data():
    sql = _sql("002_matches.sql")
    assert "if v_uid is null or not coalesce((v_player->>'verified')::boolean, false) then" in sql
    assert "revoke all on function" in sql
    assert "from public, anon, authenticated" in sql
    assert "grant execute on function" in sql


def test_phase4_migration_contract():
    sql = _sql("003_phase4_avatar.sql")
    required = [
        "alter table public.profiles add column if not exists character_id text",
        "create table if not exists public.avatars",
        "create table if not exists public.rooms",
        "create table if not exists public.audit_logs",
        "alter table public.avatars enable row level security",
        "alter table public.rooms enable row level security",
        "alter table public.audit_logs enable row level security",
        "revoke all on public.avatars, public.rooms, public.audit_logs from anon, authenticated",
        "create policy avatars_public_read on storage.objects",
        "'avatar_url', avatar_url",
        "'character_id', character_id",
    ]
    assert all(fragment in sql for fragment in required)
