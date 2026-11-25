begin;
do $$ begin if not exists(select 1 from public.app_sql_versions where version=38) then raise exception 'SQL_038_REQUIRED'; end if; end $$;
create or replace function public.consume_biometric_grant(
 p_token_hash text,p_user_id uuid,p_persona_id uuid,p_tienda_id uuid,p_login_session text,p_latitude numeric,p_longitude numeric,p_accuracy numeric
) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.biometric_grants; previous public.attendance_events; shift public.horarios_semanales_detalles;
 new_id uuid; day_start timestamptz; next_type text; entries integer; exits integer; late integer; stay integer; actor_role text;
begin
 if p_token_hash is null or p_user_id is null or p_persona_id is null or p_tienda_id is null or nullif(p_login_session,'') is null then raise exception 'INVALID_BIOMETRIC_BINDING'; end if;
 if p_accuracy is null or p_latitude is null or p_longitude is null or p_accuracy<=0 or p_accuracy>100 or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'INVALID_GEO'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_persona_id::text,0));
 select * into g from public.biometric_grants where token_hash=p_token_hash for update;
 if not found or g.user_id<>p_user_id or g.persona_id<>p_persona_id or g.tienda_id<>p_tienda_id or g.login_session<>p_login_session or g.expires_at<=clock_timestamp() or g.consumed_at is not null then raise exception 'INVALID_BIOMETRIC_GRANT'; end if;
 select role into actor_role from public.user_profiles where user_id=p_user_id and is_active;
 if actor_role is null or actor_role not in ('owner','supervisor') then raise exception 'ACTOR_NOT_AUTHORIZED'; end if;
 if actor_role='supervisor' and not exists(select 1 from public.tienda_supervisores ts join public.user_profiles up on up.user_id=p_user_id where ts.tienda_id=p_tienda_id and ts.valid_to is null and (ts.user_id=p_user_id or ts.persona_id=up.persona_id)) then raise exception 'STORE_NOT_AUTHORIZED'; end if;
 if not exists(select 1 from public.personas where id=p_persona_id and is_active) or not exists(select 1 from public.tiendas where id=p_tienda_id and is_active) then raise exception 'INACTIVE_EMPLOYEE_OR_STORE'; end if;
 if not exists(select 1 from public.tienda_promotores where persona_id=p_persona_id and tienda_id=p_tienda_id and valid_to is null) and not exists(select 1 from public.tienda_supervisores where persona_id=p_persona_id and tienda_id=p_tienda_id and valid_to is null) then raise exception 'EMPLOYEE_NOT_ASSIGNED'; end if;
 select d.* into shift from public.horarios_semanales_detalles d join public.horarios_semanales h on h.id=d.horario_id where h.tienda_id=p_tienda_id and d.persona_id=p_persona_id and d.fecha=(now() at time zone 'America/Lima')::date;
 if shift.id is null or shift.hora_ingreso is null or shift.hora_salida is null or shift.tipo not in ('A','C','AC','P') then raise exception 'NO_WORK_SCHEDULE'; end if;
 day_start:=date_trunc('day',now() at time zone 'America/Lima') at time zone 'America/Lima';
 select count(*) filter(where event_type in ('entrada','fin_refrigerio')),count(*) filter(where event_type in ('salida','inicio_refrigerio')) into entries,exits from public.attendance_events where persona_id=p_persona_id and occurred_at>=day_start;
 select * into previous from public.attendance_events where persona_id=p_persona_id and occurred_at>=day_start order by occurred_at desc,id desc limit 1;
 next_type:=case when previous.id is null then 'entrada' when previous.event_type in ('salida','inicio_refrigerio') then 'fin_refrigerio' else 'salida' end;
 if (next_type in ('entrada','fin_refrigerio') and entries>=3) or (next_type='salida' and exits>=3) then raise exception 'DAILY_LIMIT'; end if;
 late:=case when next_type='entrada' then greatest(0,floor(extract(epoch from ((now() at time zone 'America/Lima')::time-shift.hora_ingreso))/60)::integer) else null end;
 stay:=case when next_type='salida' and previous.id is not null then greatest(0,round(extract(epoch from (now()-previous.occurred_at))/60)::integer) else null end;
 insert into public.attendance_events(user_id,persona_id,tienda_id,event_type,idempotency_key,store_name,latitude,longitude,accuracy_meters,face_status,horario_detalle_id,scheduled_start,scheduled_end,scheduled_type,punctuality_status,late_minutes,stay_minutes)
 select p_user_id,p_persona_id,p_tienda_id,next_type,g.id,t.nombre,p_latitude,p_longitude,p_accuracy,'verified',shift.id,shift.hora_ingreso,shift.hora_salida,shift.tipo,case when next_type='entrada' then case when late>0 then 'late' else 'on_time' end else 'not_scheduled' end,late,stay from public.tiendas t where t.id=p_tienda_id returning id into new_id;
 if next_type='fin_refrigerio' then update public.attendance_events set event_type='inicio_refrigerio' where id=previous.id; end if;
 if next_type='salida' then update public.attendance_events set stay_minutes=stay where id=previous.id; end if;
 update public.biometric_grants set consumed_at=clock_timestamp() where id=g.id;
 insert into public.biometric_audit_v2(action,persona_id,actor_id) values('attendance_confirmed',p_persona_id,p_user_id);
 return new_id;
end $$;
revoke all on function public.consume_biometric_grant(text,uuid,uuid,uuid,text,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.consume_biometric_grant(text,uuid,uuid,uuid,text,numeric,numeric,numeric) to service_role;
insert into public.app_sql_versions(version,name) values(39,'biometric_attendance_rules');
notify pgrst,'reload schema';
commit;
