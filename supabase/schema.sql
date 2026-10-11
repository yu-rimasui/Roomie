-- Apply once in the Supabase SQL editor. No service-role key belongs in the frontend.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  invite_hash bytea not null,
  created_at timestamptz not null default now()
);
create table public.room_members (
  room_id uuid not null references public.rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  slot smallint not null check (slot in (0,1)),
  area text not null default 'home' check (area in ('home','town')),
  x double precision not null default .7 check (x between -22 and 22),
  z double precision not null default 2.8 check (z between -22 and 22),
  yaw double precision not null default pi() check (yaw between -4*pi() and 4*pi()),
  primary key (room_id,user_id), unique(room_id,slot)
);
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
revoke all on public.rooms,public.room_members from anon,authenticated;
grant select on public.room_members to authenticated;
grant update (area,x,z,yaw) on public.room_members to authenticated;
create function public.is_room_member(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.room_members where room_id=target and user_id=auth.uid());
$$;
revoke all on function public.is_room_member(uuid) from public,anon;
grant execute on function public.is_room_member(uuid) to authenticated;
create policy "members read shared world" on public.room_members for select to authenticated using (public.is_room_member(room_id));
create policy "members move themselves" on public.room_members for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create function public.create_room() returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; token text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  token := encode(extensions.gen_random_bytes(24),'hex');
  insert into public.rooms(invite_hash) values(extensions.digest(token,'sha256')) returning id into rid;
  insert into public.room_members(room_id,user_id,slot) values(rid,auth.uid(),0);
  return jsonb_build_object('room_id',rid,'invite_token',token);
end;
$$;
create function public.join_room(target_room uuid,invite_token text) returns smallint language plpgsql security definer set search_path='' as $$
declare stored bytea; chosen smallint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select invite_hash into stored from public.rooms where id=target_room for update;
  if stored is null or stored<>extensions.digest(invite_token,'sha256') then raise exception 'Invalid invite'; end if;
  select slot into chosen from public.room_members where room_id=target_room and user_id=auth.uid();
  if chosen is not null then return chosen; end if;
  if (select count(*) from public.room_members where room_id=target_room)>=2 then raise exception 'Room full'; end if;
  chosen:=1;
  insert into public.room_members(room_id,user_id,slot,x) values(target_room,auth.uid(),chosen,1.6);
  return chosen;
end;
$$;
revoke all on function public.create_room(),public.join_room(uuid,text) from public,anon;
grant execute on function public.create_room(),public.join_room(uuid,text) to authenticated;
-- Private Presence channels are authorized using the same immutable membership.
create policy "room presence read" on realtime.messages for select to authenticated using (
  extension='presence' and exists(select 1 from public.room_members where user_id=auth.uid() and 'room:'||room_id::text=realtime.topic())
);
create policy "room presence write" on realtime.messages for insert to authenticated with check (
  extension='presence' and exists(select 1 from public.room_members where user_id=auth.uid() and 'room:'||room_id::text=realtime.topic())
);
alter publication supabase_realtime add table public.room_members;
