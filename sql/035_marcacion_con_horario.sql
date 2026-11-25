-- Marcación vinculada al horario semanal. Ejecutar después de SQL 034.
begin;
do $$ begin
 if not exists(select 1 from public.app_sql_versions where version=34) then raise exception 'SQL_034_REQUIRED'; end if;
 if exists(select 1 from public.app_sql_versions where version=35) then raise exception 'SQL_035_ALREADY_APPLIED'; end if;
end $$;

alter table public.attendance_events
 add column persona_id uuid references public.personas(id) on delete restrict,
 add column horario_detalle_id uuid references public.horarios_semanales_detalles(id) on delete set null,
 add column scheduled_start time,
 add column scheduled_end time,
 add column scheduled_type text,
 add column punctuality_status text check (punctuality_status in ('on_time','late','not_scheduled')),
 add column late_minutes integer check (late_minutes is null or late_minutes >= 0),
 add column stay_minutes integer check (stay_minutes is null or stay_minutes >= 0),
 add column face_status text not null default 'pending' check (face_status in ('pending','verified','rejected','not_enrolled')),
 add column face_match_percent numeric(5,2) check (face_match_percent is null or (face_match_percent >= 0 and face_match_percent <= 100));

alter table public.attendance_attempts
 add column persona_id uuid references public.personas(id) on delete restrict,
 add column latitude numeric(9,6),
 add column longitude numeric(9,6),
 add column accuracy_meters numeric(8,2),
 add column face_status text not null default 'pending' check (face_status in ('pending','verified','rejected','not_enrolled')),
 add column face_match_percent numeric(5,2) check (face_match_percent is null or (face_match_percent >= 0 and face_match_percent <= 100));

create index attendance_events_persona_occurred_idx on public.attendance_events(persona_id, occurred_at desc);
create index attendance_attempts_persona_created_idx on public.attendance_attempts(persona_id, created_at desc);

insert into public.app_sql_versions(version,name) values(35,'marcacion_con_horario');
notify pgrst,'reload schema';
commit;
