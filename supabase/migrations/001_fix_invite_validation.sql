-- Existing databases only. Keeps membership, room data and function grants.
create or replace function public.join_room(target_room uuid,invite_token text) returns smallint language plpgsql security definer set search_path='' as $$
declare stored bytea; chosen smallint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if invite_token is null or invite_token !~ '^[a-f0-9]{48}$' then raise exception 'Invalid invite'; end if;
  select invite_hash into stored from public.rooms where id=target_room for update;
  if stored is null or stored is distinct from extensions.digest(invite_token,'sha256') then raise exception 'Invalid invite'; end if;
  select slot into chosen from public.room_members where room_id=target_room and user_id=auth.uid();
  if chosen is not null then return chosen; end if;
  if (select count(*) from public.room_members where room_id=target_room)>=2 then raise exception 'Room full'; end if;
  chosen:=1;
  insert into public.room_members(room_id,user_id,slot,x) values(target_room,auth.uid(),chosen,1.6);
  return chosen;
end;
$$;
