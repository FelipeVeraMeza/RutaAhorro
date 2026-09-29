-- ============================================================================
-- 0028 · La emisión real no se enciende sin un ensayo en el portal del SII
--
-- Pedido de Felipe (2026-09-29): dejar la factura real lista para cuando el
-- cliente entregue sus claves, "de forma profesional". El robot tiene dos
-- supuestos que solo se confirman contra el portal real (el botón de la 2ª
-- línea y los campos de totales; VSV nunca los usó). Encender la emisión y
-- descubrirlo con una factura de un cliente es la forma equivocada.
--
-- El ensayo (`npm run ensayo-sii -w @rutaahorro/worker`, `ensayarEnPortal`)
-- hace todo el recorrido con las credenciales guardadas —entrar, elegir la
-- empresa, receptor, dos líneas, validar, comparar el total— y se detiene
-- ANTES de firmar. Queda registrado acá, y:
--   · encender exige un ensayo exitoso POSTERIOR a las credenciales vigentes;
--   · guardar credenciales nuevas APAGA la emisión: nunca se ensayaron.
-- ============================================================================

create table if not exists sii_ensayos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  ok          boolean not null,
  -- {total_portal, razon_social_sii, lineas} o {error}
  detalle     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sii_ensayos_tenant on sii_ensayos(tenant_id, created_at desc);
-- Como sii_credenciales: sin política ni privilegios. Lo escribe el worker y
-- lo resume fn_estado_emision_sii.
alter table sii_ensayos enable row level security;
revoke all on sii_ensayos from anon, authenticated;

-- ¿Hay un ensayo exitoso con las credenciales que están guardadas hoy?
create or replace function public.fn_sii_ensayo_vigente(p_tenant uuid)
returns boolean
language sql stable set search_path = public
as $$
  select exists (
    select 1 from sii_ensayos e join sii_credenciales c on c.tenant_id = e.tenant_id
     where e.tenant_id = p_tenant and e.ok and e.created_at >= c.actualizado_en)
$$;
revoke execute on function public.fn_sii_ensayo_vigente(uuid) from public, anon, authenticated;

-- El worker registra el resultado de un ensayo.
create or replace function public.fn_sii_registrar_ensayo(p_tenant uuid, p_ok boolean, p_detalle jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into sii_ensayos (tenant_id, ok, detalle) values (p_tenant, p_ok, coalesce(p_detalle, '{}'::jsonb));
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (p_tenant, null, 'ensayo_sii', 'tenants', p_tenant,
          jsonb_build_object('ok', p_ok) || coalesce(p_detalle, '{}'::jsonb));
end $$;
revoke execute on function public.fn_sii_registrar_ensayo(uuid, boolean, jsonb) from public, anon, authenticated;
grant  execute on function public.fn_sii_registrar_ensayo(uuid, boolean, jsonb) to service_role;

-- Credenciales nuevas o cambiadas: se fecha el cambio y la emisión se apaga.
-- En la base y no en la pantalla (regla 6): da igual quién las cambie.
create or replace function public.fn_sii_credenciales_cambiaron()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.actualizado_en := clock_timestamp();
  update tenants set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('emision_sii_portal', false)
   where id = new.tenant_id and coalesce((settings->>'emision_sii_portal')::boolean, false);
  return new;
end $$;
revoke execute on function public.fn_sii_credenciales_cambiaron() from public, anon, authenticated;
drop trigger if exists trg_sii_credenciales_cambiaron on sii_credenciales;
create trigger trg_sii_credenciales_cambiaron before insert or update on sii_credenciales
  for each row execute function public.fn_sii_credenciales_cambiaron();

-- El estado, ahora con lo que falta: emisor, credenciales y ensayo.
create or replace function public.fn_estado_emision_sii()
returns jsonb
language plpgsql security definer stable set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_c      sii_credenciales%rowtype;
  v_e      sii_ensayos%rowtype;
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  select * into v_c from sii_credenciales where tenant_id = v_tenant;
  select * into v_e from sii_ensayos where tenant_id = v_tenant order by created_at desc limit 1;
  return jsonb_build_object(
    'activa', fn_emision_sii_activa(v_tenant),
    'encendida', coalesce((select (settings->>'emision_sii_portal')::boolean from tenants where id = v_tenant), false),
    'emisor', exists (select 1 from dte_emisores where tenant_id = v_tenant),
    'credenciales', v_c.tenant_id is not null,
    'rut_usuario', v_c.rut_usuario, 'rut_empresa', v_c.rut_empresa,
    'actualizado_en', v_c.actualizado_en,
    'ensayo_vigente', fn_sii_ensayo_vigente(v_tenant),
    'ultimo_ensayo', case when v_e.id is null then null
                          else jsonb_build_object('en', v_e.created_at, 'ok', v_e.ok, 'detalle', v_e.detalle) end,
    'en_cola', (select count(*) from facturas where tenant_id = v_tenant and estado in ('por_emitir', 'emitiendo')),
    'con_error', (select count(*) from facturas where tenant_id = v_tenant and estado = 'error'));
end $$;

create or replace function public.fn_activar_emision_sii(p_activa boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') <> 'admin' then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_activa and not exists (select 1 from sii_credenciales where tenant_id = v_tenant) then
    raise exception 'FALTAN_CREDENCIALES_SII' using errcode = 'P0001';
  end if;
  if p_activa and not exists (select 1 from dte_emisores where tenant_id = v_tenant) then
    raise exception 'EMISOR_SIN_CONFIGURAR' using errcode = 'P0001';
  end if;
  -- 0028: primero ver el portal real con estas credenciales, sin firmar.
  if p_activa and not fn_sii_ensayo_vigente(v_tenant) then
    raise exception 'FALTA_ENSAYO_SII' using errcode = 'P0001';
  end if;
  update tenants set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('emision_sii_portal', p_activa)
   where id = v_tenant;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'emision_sii', 'tenants', v_tenant, jsonb_build_object('activa', p_activa));
  return fn_estado_emision_sii();
end $$;

revoke execute on function public.fn_estado_emision_sii()        from public, anon;
grant  execute on function public.fn_estado_emision_sii()        to authenticated;
revoke execute on function public.fn_activar_emision_sii(boolean) from public, anon;
grant  execute on function public.fn_activar_emision_sii(boolean) to authenticated;
