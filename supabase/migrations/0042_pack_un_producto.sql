-- =============================================================================
-- 0042 · Packs de un solo producto: "2 por $500"
-- =============================================================================
-- Felipe, 2026-10-13: "le coloco 2 por 500, pero si agrego uno más se debería
-- cobrar la promo y uno a precio normal". Eso es un combo de un solo producto:
-- fn_ahorro_combos (0023) ya lo aplica las veces que quepa y cobra lo que sobra
-- a precio normal. Solo faltaba que fn_guardar_combo lo dejara guardar; antes
-- exigía dos productos distintos (COMBO_UN_SOLO_PRODUCTO).
--
-- Los otros dos tipos de promoción ya existían y no cambian:
--   · precio por mayor: "desde 3, cada uno a $Z" (product_price_tiers, 0018);
--   · escalonado: varios tramos de precio por mayor.
--
-- Igual que 0023 salvo lo marcado con "0042".
-- =============================================================================

create or replace function public.fn_guardar_combo(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_nombre  text := nullif(trim(p_datos->>'nombre'), '');
  v_precio  numeric;
  v_vd      date;
  v_vh      date;
  v_it      jsonb;
  v_prod    products%rowtype;
  v_cant    numeric;
  v_normal  numeric := 0;
  v_ids     uuid[] := '{}';
  v_id      uuid;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if v_nombre is null then raise exception 'NOMBRE_COMBO_REQUERIDO' using errcode = 'P0001'; end if;
  begin
    v_precio := (p_datos->>'precio')::numeric;
    v_vd := nullif(p_datos->>'vigente_desde', '')::date;
    v_vh := nullif(p_datos->>'vigente_hasta', '')::date;
  exception when others then
    raise exception 'COMBO_INVALIDO' using errcode = 'P0001';
  end;
  if v_precio is null or v_precio <= 0 or v_precio <> trunc(v_precio) then
    raise exception 'COMBO_INVALIDO' using errcode = 'P0001';
  end if;
  if v_vd is not null and v_vh is not null and v_vh < v_vd then
    raise exception 'FECHAS_INVERTIDAS' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_datos->'items') is distinct from 'array' then
    raise exception 'COMBO_INVALIDO' using errcode = 'P0001';
  end if;

  for v_it in select * from jsonb_array_elements(p_datos->'items') loop
    begin
      v_cant := (v_it->>'cantidad')::numeric;
      select * into v_prod from products
       where id = (v_it->>'product_id')::uuid and tenant_id = v_tenant and is_active;
    exception when others then
      raise exception 'COMBO_INVALIDO' using errcode = 'P0001';
    end;
    if v_prod.id is null then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
    if v_cant is null or v_cant <= 0 then raise exception 'COMBO_INVALIDO' using errcode = 'P0001'; end if;
    if v_prod.id = any(v_ids) then raise exception 'COMBO_PRODUCTO_REPETIDO' using errcode = 'P0001'; end if;
    v_ids := v_ids || v_prod.id;
    v_normal := v_normal + v_prod.sale_price * v_cant;
    v_prod := null;
  end loop;
  -- 0042 · Un solo producto es un pack ("2 por $500"): vale con 2 o más
  -- unidades. fn_ahorro_combos ya lo aplica las veces que quepa y lo que sobra
  -- va a precio normal. Con una unidad sería un cambio de precio, no un pack.
  if cardinality(v_ids) = 0 then raise exception 'COMBO_INVALIDO' using errcode = 'P0001'; end if;
  if cardinality(v_ids) = 1 and v_cant < 2 then raise exception 'COMBO_UN_SOLO_PRODUCTO' using errcode = 'P0001'; end if;
  if v_precio >= round(v_normal) then raise exception 'COMBO_NO_ES_MAS_BARATO' using errcode = 'P0001'; end if;

  if p_id is null then
    insert into combos (tenant_id, nombre, precio, vigente_desde, vigente_hasta, is_active, created_by)
    values (v_tenant, v_nombre, v_precio::integer, v_vd, v_vh, coalesce((p_datos->>'activo')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update combos set nombre = v_nombre, precio = v_precio::integer, vigente_desde = v_vd, vigente_hasta = v_vh,
                      is_active = coalesce((p_datos->>'activo')::boolean, true), updated_at = now()
     where id = p_id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'COMBO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
    delete from combo_items where combo_id = v_id;
  end if;
  insert into combo_items (tenant_id, combo_id, product_id, cantidad)
  select v_tenant, v_id, (x->>'product_id')::uuid, (x->>'cantidad')::numeric
    from jsonb_array_elements(p_datos->'items') x;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), case when p_id is null then 'crear' else 'editar' end, 'combo', v_id, p_datos);
  return v_id;
end $$;
