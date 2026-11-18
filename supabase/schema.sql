-- skiLink friends: run this once in Supabase → SQL Editor → New query → Run.
-- Safe to run again (it only creates what's missing and replaces the policies).
--
-- Privacy model:
--   * Nobody can list users. You find someone only by typing their exact username (find_user function).
--   * You can see a profile only if it's yours or you have a friend request with that person.
--   * Live locations and daily stats are visible only to you and your ACCEPTED friends.
--   * Everyone can only write their own rows.

-- ---------- tables ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text not null default '',
  color        text not null default '#007aff',
  skill        text not null default 'intermediate',
  updated_at   timestamptz not null default now()
);

create table if not exists public.friendships (
  id         bigint generated always as identity primary key,
  requester  uuid not null references auth.users(id) on delete cascade,
  addressee  uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- one friendship per pair, whoever asked first
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

create table if not exists public.live_locations (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  lat        double precision not null,
  lon        double precision not null,
  speed_kmh  real,
  altitude   real,
  status     text,
  resort     text,
  updated_at timestamptz not null default now()
);

create table if not exists public.day_stats (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  top_speed  real not null default 0,
  vertical   real not null default 0,
  runs       integer not null default 0,
  distance   real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------- helpers ----------
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a)));
$$;

create or replace function public.has_friendship_row(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where (requester = a and addressee = b) or (requester = b and addressee = a));
$$;

-- exact-username lookup (the only way to find someone)
create or replace function public.find_user(uname text)
returns table (id uuid, username text, display_name text, color text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.color
  from profiles p
  where p.username = lower(trim(uname)) and p.id <> auth.uid()
  limit 1;
$$;

revoke all on function public.are_friends(uuid, uuid) from public, anon;
revoke all on function public.has_friendship_row(uuid, uuid) from public, anon;
revoke all on function public.find_user(text) from public, anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.has_friendship_row(uuid, uuid) to authenticated;
grant execute on function public.find_user(text) to authenticated;

-- ---------- row level security ----------
alter table public.profiles       enable row level security;
alter table public.friendships    enable row level security;
alter table public.live_locations enable row level security;
alter table public.day_stats      enable row level security;

drop policy if exists "profiles: read own or connected" on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: read own or connected" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_friendship_row(auth.uid(), id));
create policy "profiles: insert own" on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "friendships: read own" on public.friendships;
drop policy if exists "friendships: send" on public.friendships;
drop policy if exists "friendships: accept" on public.friendships;
drop policy if exists "friendships: remove" on public.friendships;
create policy "friendships: read own" on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
create policy "friendships: send" on public.friendships for insert to authenticated
  with check (requester = auth.uid() and status = 'pending');
create policy "friendships: accept" on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
create policy "friendships: remove" on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

drop policy if exists "locations: read own or friends" on public.live_locations;
drop policy if exists "locations: insert own" on public.live_locations;
drop policy if exists "locations: update own" on public.live_locations;
drop policy if exists "locations: delete own" on public.live_locations;
create policy "locations: read own or friends" on public.live_locations for select to authenticated
  using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));
create policy "locations: insert own" on public.live_locations for insert to authenticated
  with check (user_id = auth.uid());
create policy "locations: update own" on public.live_locations for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "locations: delete own" on public.live_locations for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "stats: read own or friends" on public.day_stats;
drop policy if exists "stats: insert own" on public.day_stats;
drop policy if exists "stats: update own" on public.day_stats;
create policy "stats: read own or friends" on public.day_stats for select to authenticated
  using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));
create policy "stats: insert own" on public.day_stats for insert to authenticated
  with check (user_id = auth.uid());
create policy "stats: update own" on public.day_stats for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- signed-out visitors get nothing
revoke all on public.profiles, public.friendships, public.live_locations, public.day_stats from anon;
grant select, insert, update, delete on public.profiles, public.friendships, public.live_locations, public.day_stats to authenticated;
