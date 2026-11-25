-- Plantillas biométricas para marcación local con Human. No almacena fotografías.
begin;
do $$ begin
 if not exists(select 1 from public.app_sql_versions where version=35) then raise exception 'SQL_035_REQUIRED'; end if;
 if exists(select 1 from public.app_sql_versions where version=36) then raise exception 'SQL_036_ALREADY_APPLIED'; end if;
end $$;

create table public.face_biometric_templates (
 id uuid primary key default gen_random_uuid(),
 persona_id uuid not null references public.personas(id) on delete restrict,
 engine text not null,
 engine_version text not null,
 descriptor jsonb not null check (jsonb_typeof(descriptor) = 'array' and jsonb_array_length(descriptor) between 64 and 2048),
 quality_score numeric(5,2) not null check (quality_score >= 0 and quality_score <= 100),
 anti_spoof_score numeric(5,2) check (anti_spoof_score is null or (anti_spoof_score >= 0 and anti_spoof_score <= 100)),
 liveness_score numeric(5,2) check (liveness_score is null or (liveness_score >= 0 and liveness_score <= 100)),
 consented_at timestamptz not null,
 consented_by uuid not null references auth.users(id) on delete restrict,
 revoked_at timestamptz,
 revoked_by uuid references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(persona_id)
);

create index face_biometric_templates_active_idx on public.face_biometric_templates(persona_id) where revoked_at is null;
alter table public.face_biometric_templates enable row level security;
revoke all on public.face_biometric_templates from anon, authenticated;

insert into public.app_sql_versions(version,name) values(36,'biometria_facial_local');
notify pgrst,'reload schema';
commit;
