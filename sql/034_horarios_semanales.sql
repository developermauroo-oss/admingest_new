-- Ejecutar manualmente después de SQL 033.
begin;
do $$ begin
 if not exists(select 1 from public.app_sql_versions where version=33) then raise exception 'SQL_033_REQUIRED'; end if;
 if exists(select 1 from public.app_sql_versions where version=34) then raise exception 'SQL_034_ALREADY_APPLIED'; end if;
end $$;

create table public.horarios_semanales (
 id uuid primary key default gen_random_uuid(),
 tienda_id uuid not null references public.tiendas(id) on delete restrict,
 semana_inicio date not null check (extract(isodow from semana_inicio)=1),
 tiene_capa boolean not null default false,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tienda_id,semana_inicio)
);
create table public.horarios_semanales_detalles (
 id uuid primary key default gen_random_uuid(),
 horario_id uuid not null references public.horarios_semanales(id) on delete cascade,
 persona_id uuid not null references public.personas(id) on delete restrict,
 fecha date not null,
 tipo text not null check(tipo in ('A','C','AC','D','P','VAC','LIC')),
 hora_ingreso time, hora_salida time, tiene_descanso boolean not null default false,
 horas_programadas numeric(4,2) not null check(horas_programadas>=0 and horas_programadas<=12),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(horario_id,persona_id,fecha),
 check((tipo in ('A','C','AC','P') and hora_ingreso is not null and hora_salida is not null) or (tipo in ('D','VAC','LIC') and hora_ingreso is null and hora_salida is null))
);
create index horarios_semanales_tienda_semana_idx on public.horarios_semanales(tienda_id,semana_inicio desc);
create index horarios_semanales_detalles_persona_idx on public.horarios_semanales_detalles(persona_id,fecha);
alter table public.horarios_semanales enable row level security;
alter table public.horarios_semanales_detalles enable row level security;
revoke all on public.horarios_semanales,public.horarios_semanales_detalles from anon,authenticated;
insert into public.app_sql_versions(version,name) values(34,'horarios_semanales');
notify pgrst,'reload schema';
commit;
