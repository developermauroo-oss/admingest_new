-- Desarrollo únicamente. Todos los cambios se revierten al terminar.
begin;
do $$
declare actor uuid; person uuid; store uuid; token text; event_id uuid; before_count integer; schedule_id uuid;
begin
 select up.user_id,coalesce(ts.persona_id,up.persona_id),ts.tienda_id into actor,person,store
 from public.tienda_supervisores ts join public.user_profiles up on up.user_id=ts.user_id or up.persona_id=ts.persona_id
 where ts.valid_to is null and up.is_active limit 1;
 if actor is null then raise exception 'NO_UNUSED_DEVELOPMENT_FIXTURE'; end if;
 insert into public.horarios_semanales(tienda_id,semana_inicio,tiene_capa,created_by)
 values(store,date_trunc('week',now() at time zone 'America/Lima')::date,false,actor)
 on conflict(tienda_id,semana_inicio) do update set tienda_id=excluded.tienda_id returning id into schedule_id;
 insert into public.horarios_semanales_detalles(horario_id,persona_id,fecha,tipo,hora_ingreso,hora_salida,tiene_descanso,horas_programadas)
 values(schedule_id,person,(now() at time zone 'America/Lima')::date,'C','15:00','22:00',false,7)
 on conflict(horario_id,persona_id,fecha) do update set tipo='C',hora_ingreso='15:00',hora_salida='22:00';
 select count(*) into before_count from public.attendance_events where persona_id=person;
 token:=gen_random_uuid()::text;
 insert into public.biometric_grants(token_hash,user_id,persona_id,tienda_id,login_session,expires_at) values(token,actor,person,store,'rollback-test',now()+interval '30 seconds');
 begin
 perform public.consume_biometric_grant(token,actor,person,store,'wrong-session',0,0,10);
 raise exception 'TEST_BINDING_ACCEPTED';
 exception when others then if sqlerrm <> 'INVALID_BIOMETRIC_GRANT' then raise; end if; end;
 event_id:=public.consume_biometric_grant(token,actor,person,store,'rollback-test',0,0,10);
 if event_id is null or not exists(select 1 from public.biometric_grants where token_hash=token and consumed_at is not null) then raise exception 'TEST_ATOMICITY_FAILED'; end if;
 if (select count(*) from public.attendance_events where persona_id=person)<>before_count+1 then raise exception 'TEST_INSERT_FAILED'; end if;
 begin
 perform public.consume_biometric_grant(token,actor,person,store,'rollback-test',0,0,10);
 raise exception 'TEST_REPLAY_ACCEPTED';
 exception when others then if sqlerrm <> 'INVALID_BIOMETRIC_GRANT' then raise; end if; end;
end $$;
rollback;
