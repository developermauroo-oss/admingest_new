-- Preparado para desarrollo. Aplicar después de 035; no borra datos históricos.
begin;
do $$ begin
 if not exists(select 1 from public.app_sql_versions where version=35) then raise exception 'SQL_035_REQUIRED'; end if;
 if exists(select 1 from public.app_sql_versions where version=37) then raise exception 'SQL_037_ALREADY_APPLIED'; end if;
end $$;
create table if not exists public.biometric_grants (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique,
 user_id uuid not null references auth.users(id),
 persona_id uuid not null references public.personas(id),
 tienda_id uuid not null references public.tiendas(id),
 login_session text not null,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 created_at timestamptz not null default now(),
 check(expires_at > created_at and expires_at <= created_at + interval '2 minutes')
);
alter table public.biometric_grants enable row level security;
revoke all on public.biometric_grants from anon, authenticated;
grant select,insert,update,delete on public.biometric_grants to service_role;

create or replace function public.consume_biometric_grant(
 p_token_hash text, p_user_id uuid, p_persona_id uuid, p_tienda_id uuid,
 p_login_session text, p_latitude numeric, p_longitude numeric, p_accuracy numeric
) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.biometric_grants; previous public.attendance_events; new_id uuid;
 day_start timestamptz; next_type text; entry_count integer; exit_count integer;
begin
 if p_token_hash is null or p_user_id is null or p_persona_id is null or p_tienda_id is null or nullif(p_login_session,'') is null then raise exception 'INVALID_BIOMETRIC_BINDING'; end if;
 if p_accuracy is null or p_latitude is null or p_longitude is null or p_accuracy<=0 or p_accuracy>100 or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'INVALID_GEO'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_persona_id::text,0));
 select * into g from public.biometric_grants where token_hash=p_token_hash for update;
 if not found or g.user_id<>p_user_id or g.persona_id<>p_persona_id or g.tienda_id<>p_tienda_id or g.login_session<>p_login_session or g.expires_at<=clock_timestamp() or g.consumed_at is not null then raise exception 'INVALID_BIOMETRIC_GRANT'; end if;
 day_start := date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima';
 select count(*) filter(where event_type in ('entrada','fin_refrigerio')),count(*) filter(where event_type in ('salida','inicio_refrigerio')) into entry_count,exit_count from public.attendance_events where persona_id=p_persona_id and occurred_at>=day_start;
 select * into previous from public.attendance_events where persona_id=p_persona_id and occurred_at>=day_start order by occurred_at desc limit 1;
 next_type := case when previous.id is null then 'entrada' when previous.event_type in ('salida','inicio_refrigerio') then 'fin_refrigerio' else 'salida' end;
 if (next_type in ('entrada','fin_refrigerio') and entry_count>=3) or (next_type='salida' and exit_count>=3) then raise exception 'DAILY_LIMIT'; end if;
 insert into public.attendance_events(user_id,persona_id,tienda_id,event_type,idempotency_key,store_name,latitude,longitude,accuracy_meters,face_status)
 select p_user_id,p_persona_id,p_tienda_id,next_type,g.id,t.nombre,p_latitude,p_longitude,p_accuracy,'verified' from public.tiendas t where t.id=p_tienda_id returning id into new_id;
 if new_id is null then raise exception 'STORE_NOT_FOUND'; end if;
 if next_type='fin_refrigerio' then update public.attendance_events set event_type='inicio_refrigerio' where id=previous.id; end if;
 update public.biometric_grants set consumed_at=clock_timestamp() where id=g.id;
 return new_id;
end $$;
revoke all on function public.consume_biometric_grant(text,uuid,uuid,uuid,text,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.consume_biometric_grant(text,uuid,uuid,uuid,text,numeric,numeric,numeric) to service_role;
insert into public.app_sql_versions(version,name) values(37,'biometric_grants_dev');
notify pgrst,'reload schema';
commit;
