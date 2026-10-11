-- Run only against an empty, disposable PostgreSQL/Supabase database with the schema applied.
-- All fixtures and checks are rolled back. Never prints identities or invite tokens.
begin;
set local plpgsql.check_asserts=on;
create function pg_temp.expect_error(query text, expected text) returns void language plpgsql as $$
begin
  begin
    execute query;
  exception when others then
    if sqlstate<>expected then raise; end if;
    return;
  end;
  raise exception 'Expected SQLSTATE %',expected;
end;
$$;
do $$
declare
  host uuid:=gen_random_uuid(); guest uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  room jsonb; rid uuid; replacement text; field text; before_count integer;
begin
  assert not exists(select 1 from public.rooms), 'Use an empty disposable database';
  assert not has_function_privilege('anon','public.create_room()','execute');
  assert not has_function_privilege('anon','public.rotate_invite(uuid)','execute');
  assert not has_column_privilege('authenticated','public.room_members','moved_at','update');
  assert not has_column_privilege('authenticated','public.rooms','invite_hash','update');
  insert into auth.users(id) values(host),(guest),(outsider);
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.expect_error('select public.create_room()','P0001');
  perform set_config('request.jwt.claim.sub',host::text,true);
  room:=public.create_room(); rid:=(room->>'room_id')::uuid;
  assert (select count(*) from public.rooms)=1;
  perform pg_temp.expect_error('select public.create_room()','PT429');

  replacement:=public.rotate_invite(rid);
  assert replacement<>room->>'invite_token';
  perform pg_temp.expect_error(format('select public.rotate_invite(%L)',rid),'PT429');
  perform set_config('request.jwt.claim.sub',guest::text,true);
  perform pg_temp.expect_error(format('select public.join_room(%L,%L)',rid,room->>'invite_token'),'P0001');
  assert public.join_room(rid,replacement)=1;
  perform pg_temp.expect_error(format('select public.rotate_invite(%L)',rid),'P0001');
  assert (select count(*) from public.room_members where room_id=rid)=2;

  perform set_config('request.jwt.claim.sub',host::text,true);
  foreach field in array array['area','x','z','yaw'] loop
    perform pg_temp.expect_error(format('update public.room_members set %I=null where room_id=%L and user_id=%L',field,rid,host),'23502');
  end loop;
  perform pg_temp.expect_error(format('update public.room_members set x=1e300 where room_id=%L and user_id=%L',rid,host),'23514');
  update public.room_members set x=1 where room_id=rid and user_id=host;
  assert (select moved_at>'-infinity'::timestamptz from public.room_members where room_id=rid and user_id=host);
  -- Simulate a recent write without depending on the machine's execution speed.
  perform set_config('request.jwt.claim.sub','',true);
  update public.room_members set moved_at=clock_timestamp()+interval '1 minute' where room_id=rid and user_id=host;
  perform set_config('request.jwt.claim.sub',host::text,true);
  perform pg_temp.expect_error(format('update public.room_members set x=2 where room_id=%L and user_id=%L',rid,host),'PT429');

  update public.rooms set created_at=clock_timestamp()-interval '2 minutes' where id=rid;
  room:=public.create_room();
  update public.rooms set created_at=clock_timestamp()-interval '2 minutes' where id=(room->>'room_id')::uuid;
  room:=public.create_room();
  update public.rooms set created_at=clock_timestamp()-interval '2 minutes' where id=(room->>'room_id')::uuid;
  perform pg_temp.expect_error('select public.create_room()','PT409');
  assert (select count(*) from public.room_members where user_id=host and slot=0)=3;

  insert into public.rooms(invite_hash) select extensions.digest('fixture','sha256') from generate_series(1,20);
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  select count(*) into before_count from public.rooms;
  perform pg_temp.expect_error('select public.create_room()','PT429');
  assert (select count(*) from public.rooms)=before_count;
  insert into public.rooms(invite_hash,created_at)
    select extensions.digest('fixture','sha256'),clock_timestamp()-interval '2 minutes' from generate_series(1,100-before_count);
  perform pg_temp.expect_error('select public.create_room()','PT503');
  assert (select count(*) from public.rooms)=100;
end;
$$;
rollback;
select 'PASS: quotas, cooldowns, invite rotation, owner authorization, NOT NULL, movement throttle' as result;
