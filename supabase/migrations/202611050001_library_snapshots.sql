-- Thrum: one private library snapshot per authenticated account.
-- Apply in the Supabase SQL editor or with `supabase db push`.
begin;

create table if not exists public.library_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint library_snapshot_size check (octet_length(state::text) <= 5000000),
  constraint library_snapshot_schema check (
    (jsonb_typeof(state) = 'object'
    and state->>'version' = '1'
    and jsonb_typeof(state->'tracks') = 'array'
    and jsonb_array_length(state->'tracks') <= 5000
    and jsonb_typeof(state->'playlists') = 'array'
    and jsonb_array_length(state->'playlists') <= 200) is true
  )
);

alter table public.library_snapshots enable row level security;

drop policy if exists "Read own library" on public.library_snapshots;
create policy "Read own library" on public.library_snapshots for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Create own library" on public.library_snapshots;
create policy "Create own library" on public.library_snapshots for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Update own library" on public.library_snapshots;
create policy "Update own library" on public.library_snapshots for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Delete own library" on public.library_snapshots;
create policy "Delete own library" on public.library_snapshots for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.library_snapshots from anon;
grant select, insert, update, delete on public.library_snapshots to authenticated;

create or replace function public.save_library_snapshot(p_state jsonb, p_expected_revision bigint default null, p_user_id uuid default null)
returns setof public.library_snapshots
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved public.library_snapshots;
begin
  if owner_id is null or p_user_id is distinct from owner_id then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object'
    or p_state->>'version' is distinct from '1'
    or jsonb_typeof(p_state->'tracks') is distinct from 'array'
    or jsonb_typeof(p_state->'playlists') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid library schema';
  end if;
  if octet_length(p_state::text) > 5000000
    or jsonb_array_length(p_state->'tracks') > 5000
    or jsonb_array_length(p_state->'playlists') > 200 then
    raise exception using errcode = '22023', message = 'Library limit exceeded';
  end if;
  if p_expected_revision is null then
    begin
      insert into public.library_snapshots(user_id, state, revision, updated_at)
      values (owner_id, p_state, 1, now()) returning * into saved;
    exception when unique_violation then
      raise exception using errcode = 'PT409', message = 'Library revision conflict';
    end;
  else
    if p_expected_revision < 1 then
      raise exception using errcode = '22023', message = 'Invalid expected revision';
    end if;
    update public.library_snapshots
       set state = p_state, revision = p_expected_revision + 1, updated_at = now()
     where user_id = owner_id and revision = p_expected_revision
     returning * into saved;
    if not found then
      raise exception using errcode = 'PT409', message = 'Library revision conflict';
    end if;
  end if;
  return next saved;
end;
$$;

revoke all on function public.save_library_snapshot(jsonb, bigint, uuid) from public, anon;
grant execute on function public.save_library_snapshot(jsonb, bigint, uuid) to authenticated;

commit;
