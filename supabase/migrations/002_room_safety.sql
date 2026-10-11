-- Existing databases: apply after 001. Preserves rooms, memberships and invite hashes.
-- Abort on NULL legacy data; inspect it before choosing a repair. No automatic data deletion.
begin;
lock table public.rooms, public.room_members in share row exclusive mode;
do $$
begin
  if exists(select 1 from public.room_members where area is null or x is null or z is null or yaw is null) then
    raise exception 'NULL room_members data found; inspect before applying NOT NULL';
  end if;
end;
$$;
alter table public.room_members
  alter column area set not null,
  alter column x set not null,
  alter column z set not null,
  alter column yaw set not null;
alter table public.rooms add column if not exists invite_rotated_at timestamptz not null default '-infinity';
alter table public.room_members add column if not exists moved_at timestamptz not null default '-infinity';

create or replace function public.create_room() returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; token text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- Serialize quota checks and inserts, including requests from different anonymous users.
  perform pg_advisory_xact_lock(hashtextextended('roomie:create_room',0));
  if (select count(*) from public.rooms)>=100 then
    raise sqlstate 'PT503' using message='Room capacity reached';
  end if;
  if (select count(*) from public.room_members where user_id=auth.uid() and slot=0)>=3 then
    raise sqlstate 'PT409' using message='Room limit reached';
  end if;
  if (select count(*) from public.rooms where created_at>clock_timestamp()-interval '1 minute')>=20
    or exists(select 1 from public.rooms r join public.room_members m on m.room_id=r.id
      where m.user_id=auth.uid() and m.slot=0 and r.created_at>clock_timestamp()-interval '60 seconds') then
    raise sqlstate 'PT429' using message='Room creation rate limit';
  end if;
  token := encode(extensions.gen_random_bytes(24),'hex');
  insert into public.rooms(invite_hash) values(extensions.digest(token,'sha256')) returning id into rid;
  insert into public.room_members(room_id,user_id,slot) values(rid,auth.uid(),0);
  return jsonb_build_object('room_id',rid,'invite_token',token);
end;
$$;
create or replace function public.rotate_invite(target_room uuid) returns text language plpgsql security definer set search_path='' as $$
declare token text; rotated timestamptz;
begin
  if auth.uid() is null or not exists(select 1 from public.room_members
    where room_id=target_room and user_id=auth.uid() and slot=0) then
    raise exception 'Room owner required';
  end if;
  select invite_rotated_at into rotated from public.rooms where id=target_room for update;
  if rotated>clock_timestamp()-interval '10 seconds' then
    raise sqlstate 'PT429' using message='Invite rotation rate limit';
  end if;
  token:=encode(extensions.gen_random_bytes(24),'hex');
  update public.rooms set invite_hash=extensions.digest(token,'sha256'),invite_rotated_at=clock_timestamp() where id=target_room;
  return token;
end;
$$;
create or replace function public.limit_room_movement() returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is not null then
    if old.moved_at>clock_timestamp()-interval '50 milliseconds' then
      raise sqlstate 'PT429' using message='Movement rate limit';
    end if;
    new.moved_at:=clock_timestamp();
  end if;
  return new;
end;
$$;
drop trigger if exists limit_room_movement on public.room_members;
create trigger limit_room_movement before update on public.room_members
  for each row execute function public.limit_room_movement();
revoke all on function public.create_room(),public.rotate_invite(uuid) from public,anon;
grant execute on function public.create_room(),public.rotate_invite(uuid) to authenticated;
revoke all on function public.limit_room_movement() from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
