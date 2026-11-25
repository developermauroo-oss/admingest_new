begin;
do $$ begin if not exists(select 1 from public.app_sql_versions where version=37) then raise exception 'SQL_037_REQUIRED'; end if; end $$;
create table public.biometric_templates_v2 (
 persona_id uuid not null references public.personas(id), model text not null,
 ciphertext text not null, trusted boolean not null default false,
 consented_by uuid references auth.users(id), consented_at timestamptz,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '365 days',
 primary key(persona_id,model)
);
create table public.biometric_sessions_v2 (
 id text primary key, binding jsonb not null check(jsonb_array_length(binding)=4),
 challenge text not null, expires_at timestamptz not null,
 attempts integer not null default 0 check(attempts between 0 and 3), created_at timestamptz not null default now()
);
create table public.biometric_capture_hashes(digest text primary key, created_at timestamptz not null default now());
create table public.biometric_audit_v2(id bigint generated always as identity primary key, action text not null, persona_id uuid, actor_id uuid, created_at timestamptz not null default now());
create table public.biometric_evaluations (
 id uuid primary key default gen_random_uuid(), persona_id uuid not null references public.personas(id), actor_id uuid not null references auth.users(id),
 kind text not null check(kind in ('genuine','impostor','photo','screen','video')),
 lighting text not null, device text not null, cosine_score double precision, pad_score double precision, latency_ms double precision,
 result jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.biometric_grants add column biometric_session_id text unique references public.biometric_sessions_v2(id);
do $$ declare t text; begin foreach t in array array['biometric_templates_v2','biometric_sessions_v2','biometric_capture_hashes','biometric_audit_v2','biometric_evaluations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;

create function public.biometric_session_start(p_id text,p_binding jsonb,p_challenge text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare count_recent integer; until_time timestamptz:=clock_timestamp()+interval '120 seconds'; begin
 perform pg_advisory_xact_lock(hashtextextended((p_binding->>0)||':'||(p_binding->>1)||':'||(p_binding->>2),0));
 select count(*) into count_recent from public.biometric_sessions_v2 where binding->>0=p_binding->>0 and binding->>1=p_binding->>1 and binding->>2=p_binding->>2 and created_at>now()-interval '10 minutes';
 if count_recent>=3 then raise exception 'TOO_MANY_SESSIONS'; end if;
 insert into public.biometric_sessions_v2(id,binding,challenge,expires_at) values(p_id,p_binding,p_challenge,until_time);
 return jsonb_build_object('id',p_id,'challenge',p_challenge,'expires_at',extract(epoch from until_time)); end $$;
create function public.biometric_session_attempt(p_id text,p_binding jsonb) returns void language plpgsql security invoker set search_path=public,pg_temp as $$ begin
 update public.biometric_sessions_v2 set attempts=attempts+1 where id=p_id and binding=p_binding and expires_at>clock_timestamp() and attempts<3;
 if not found then raise exception 'SESSION_EXPIRED_OR_EXHAUSTED'; end if; end $$;
create function public.biometric_revoke(p_persona uuid) returns void language plpgsql security invoker set search_path=public,pg_temp as $$ begin
 update public.biometric_sessions_v2 set expires_at=now() where binding->>1=p_persona::text;
 update public.biometric_grants set consumed_at=now() where persona_id=p_persona and consumed_at is null;
 delete from public.biometric_templates_v2 where persona_id=p_persona;
 insert into public.biometric_audit_v2(action,persona_id) values('revocation',p_persona); end $$;
revoke all on function public.biometric_session_start(text,jsonb,text),public.biometric_session_attempt(text,jsonb),public.biometric_revoke(uuid) from public,anon,authenticated;
grant execute on function public.biometric_session_start(text,jsonb,text),public.biometric_session_attempt(text,jsonb),public.biometric_revoke(uuid) to service_role;
insert into public.app_sql_versions(version,name) values(38,'biometric_cloud');
notify pgrst,'reload schema';
commit;
