-- =============================================================================
-- 0037 · Emisor del SII con lo mínimo
-- =============================================================================
-- Para emitir una factura en el portal gratuito del SII basta con el RUT de
-- quien entra, su clave tributaria, la clave del certificado y la ciudad de
-- origen: razón social, giro y dirección del emisor los pone el portal solo, y
-- los del receptor salen del cliente (Felipe, 2026-10-07).
--
-- Antes se pedía además el RUT de la empresa y, para encender, los datos del
-- emisor en Configuración (dte_emisores). Ahora:
--   · rut_empresa es opcional: hace falta solo si la clave del SII maneja más
--     de una empresa (el robot lo dice si es así).
--   · la ciudad de origen vive con las credenciales.
--   · encender ya no exige dte_emisores. Siguen exigiéndose las credenciales
--     y el ensayo en el portal (0028).
-- =============================================================================

alter table sii_credenciales alter column rut_empresa drop not null;
alter table sii_credenciales add column if not exists ciudad text;

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
    'rut_usuario', v_c.rut_usuario, 'rut_empresa', v_c.rut_empresa, 'ciudad', v_c.ciudad,
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
  -- 0037: ya no se exige dte_emisores; el portal pone los datos del emisor.
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
