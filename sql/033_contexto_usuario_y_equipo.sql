-- Ejecutar manualmente después de SQL 032.
begin;
do $$ begin
 if not exists(select 1 from public.app_sql_versions where version=32) then raise exception 'SQL_032_REQUIRED'; end if;
 if exists(select 1 from public.app_sql_versions where version=33) then raise exception 'SQL_033_ALREADY_APPLIED'; end if;
end $$;

create or replace function public.current_employee_context()
returns table(role text,nombres text,apellidos text,puesto text,tiendas jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return query select up.role,p.nombres,p.apellidos,pu.nombre,
 coalesce(jsonb_agg(jsonb_build_object('id',t.id,'nombre',t.nombre) order by t.nombre) filter(where t.id is not null),'[]'::jsonb)
 from public.current_employee_authorization() authz join public.user_profiles up on up.user_id=auth.uid() and up.role=authz.role join public.personas p on p.id=up.persona_id join public.puestos pu on pu.id=p.puesto_id
 left join public.tienda_supervisores ts on ts.valid_to is null and (ts.persona_id=p.id or ts.user_id=auth.uid())
 left join public.tiendas t on t.id=ts.tienda_id and t.is_active
 where authz.persona_active and authz.authorization_active
 group by up.role,p.nombres,p.apellidos,pu.nombre;
end $$;

create or replace function public.current_personal_team_snapshot()
returns table(persona_id uuid,nombres text,apellidos text,puesto text,tienda_id uuid,tienda_nombre text,is_active boolean,puede_vender boolean,estado_laboral text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare current_role text; current_persona uuid;
begin
 select authz.role,up.persona_id into current_role,current_persona from public.current_employee_authorization() authz join public.user_profiles up on up.user_id=auth.uid() and up.role=authz.role where authz.persona_active and authz.authorization_active;
 if current_role is null then raise exception 'PERSONAL_ACCESS_REQUIRED' using errcode='42501'; end if;
 if current_role='owner' then
  return query with assignments as (select ts.persona_id,ts.tienda_id from public.tienda_supervisores ts where ts.valid_to is null and ts.persona_id is not null union select tp.persona_id,tp.tienda_id from public.tienda_promotores tp where tp.valid_to is null)
  select p.id,p.nombres,p.apellidos,pu.nombre,t.id,t.nombre,p.is_active,p.puede_vender,p.estado_laboral from public.personas p join public.puestos pu on pu.id=p.puesto_id left join assignments a on a.persona_id=p.id left join public.tiendas t on t.id=a.tienda_id order by p.apellidos,p.nombres,t.nombre;
  return;
 end if;
 if current_role<>'supervisor' then raise exception 'PERSONAL_ACCESS_REQUIRED' using errcode='42501'; end if;
 return query with assigned_stores as (select ts.tienda_id from public.tienda_supervisores ts where ts.valid_to is null and (ts.persona_id=current_persona or ts.user_id=auth.uid())), team as (select ts.persona_id,ts.tienda_id from public.tienda_supervisores ts join assigned_stores own on own.tienda_id=ts.tienda_id where ts.valid_to is null and ts.persona_id is not null union select tp.persona_id,tp.tienda_id from public.tienda_promotores tp join assigned_stores own on own.tienda_id=tp.tienda_id where tp.valid_to is null)
 select p.id,p.nombres,p.apellidos,pu.nombre,t.id,t.nombre,p.is_active,p.puede_vender,p.estado_laboral from team a join public.personas p on p.id=a.persona_id join public.puestos pu on pu.id=p.puesto_id join public.tiendas t on t.id=a.tienda_id order by p.apellidos,p.nombres,t.nombre;
end $$;

revoke all on function public.current_employee_context() from public,anon,authenticated;
revoke all on function public.current_personal_team_snapshot() from public,anon,authenticated;
grant execute on function public.current_employee_context() to authenticated;
grant execute on function public.current_personal_team_snapshot() to authenticated;
insert into public.app_sql_versions(version,name) values(33,'contexto_usuario_y_equipo');
notify pgrst,'reload schema';
commit;
