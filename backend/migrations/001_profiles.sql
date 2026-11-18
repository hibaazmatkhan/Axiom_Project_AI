create table if not exists public.profiles (
    id text primary key,
    email text,
    username text not null,
    display_name text not null,
    avatar_url text,
    email_verified boolean not null default false,
    mfa_enabled boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
    on public.profiles (lower(username));

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
    before update on public.profiles
    for each row
    execute function public.set_profiles_updated_at();

alter table public.profiles enable row level security;

grant select, insert, update, delete on public.profiles to service_role;
