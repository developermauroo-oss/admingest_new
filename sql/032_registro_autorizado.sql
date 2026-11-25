-- Aplicar manualmente después de SQL 031. Nunca expone solicitudes a anon/authenticated.
begin;
do $$ begin
  if not exists (select 1 from public.app_sql_versions where version=31) then raise exception 'SQL_031_REQUIRED'; end if;
  if exists (select 1 from public.app_sql_versions where version=32) then raise exception 'SQL_032_ALREADY_APPLIED'; end if;
end $$;

create table public.registration_requests (
  id uuid primary key default gen_random_uuid(), persona_id uuid not null references public.personas(id) on delete restrict,
  email text not null, password_ciphertext text not null, status text not null default 'pending' check(status in ('pending','processing','approved','rejected','expired','failed')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours',
  decided_at timestamptz, decided_by uuid references auth.users(id), auth_user_id uuid references auth.users(id),
  source_hash text not null, failure_code text, processing_at timestamptz
);
create unique index registration_requests_one_open_person on public.registration_requests(persona_id) where status in ('pending','processing');
create index registration_requests_owner_queue_idx on public.registration_requests(status,created_at desc);
alter table public.registration_requests enable row level security;
revoke all on public.registration_requests from public, anon, authenticated;

create table public.registration_request_attempts (id uuid primary key default gen_random_uuid(), identity_hash text not null, source_hash text not null, created_at timestamptz not null default now());
create index registration_request_attempts_rate_idx on public.registration_request_attempts(identity_hash,source_hash,created_at desc);
alter table public.registration_request_attempts enable row level security;
revoke all on public.registration_request_attempts from public, anon, authenticated;

create or replace function public.owner_list_registration_requests()
returns table(id uuid,persona_id uuid,nombres text,apellidos text,documento text,email text,puesto text,role text,status text,created_at timestamptz,expires_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
 return query select r.id,p.id,p.nombres,p.apellidos,p.documento,r.email,pu.nombre,a.role,r.status,r.created_at,r.expires_at
 from public.registration_requests r join public.personas p on p.id=r.persona_id join public.puestos pu on pu.id=p.puesto_id join public.access_authorizations a on a.persona_id=p.id
 order by r.created_at desc;
end $$;
create or replace function public.current_employee_authorization()
returns table(role text, persona_active boolean, authorization_active boolean)
language sql security definer set search_path=public,pg_temp as $$
 select up.role,p.is_active,case when up.role='owner' then true else coalesce(a.is_active and a.revoked_at is null,false) end
 from public.user_profiles up join public.personas p on p.id=up.persona_id
 left join public.access_authorizations a on a.persona_id=p.id and a.role=up.role
 where up.user_id=auth.uid() and up.is_active
$$;
create or replace function public.owner_begin_registration_approval(p_request_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
 update public.registration_requests set status='expired',password_ciphertext='',decided_at=now(),decided_by=auth.uid() where id=p_request_id and status='pending' and expires_at<=now();
 update public.registration_requests set status='processing',processing_at=now(),decided_by=auth.uid() where id=p_request_id and status in ('pending','failed') and expires_at>now();
 if not found then raise exception 'REQUEST_NOT_APPROVABLE'; end if;
end $$;
create or replace function public.owner_reject_registration_request(p_request_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
 update public.registration_requests set status='rejected',password_ciphertext='',decided_at=now(),decided_by=auth.uid() where id=p_request_id and status='pending';
 if not found then raise exception 'REQUEST_NOT_REJECTABLE'; end if;
end $$;
revoke all on function public.owner_list_registration_requests(),public.owner_begin_registration_approval(uuid),public.owner_reject_registration_request(uuid),public.current_employee_authorization() from public,anon,authenticated;
grant execute on function public.owner_list_registration_requests(),public.owner_begin_registration_approval(uuid),public.owner_reject_registration_request(uuid),public.current_employee_authorization() to authenticated;
insert into public.app_sql_versions(version,name) values(32,'registro_autorizado');
notify pgrst,'reload schema';
commit;
