-- =============================================================================
-- 0039 · Revisión del 2026-10-11 (docs/32): caja, ajustes, toma y lotes
-- =============================================================================
-- Todas con la MISMA firma que ya tenían (create or replace): la pantalla no
-- cambia y se puede aplicar antes o después de publicar el código. Idempotente.
--
--   1. La caja: abrirla, moverla y cerrarla exige una cuenta activa (un
--      administrador desactivado con la sesión abierta seguía moviendo plata),
--      montos en rango y nada negativo al contar. Bodega no abre caja.
--   2. Ajuste y toma: cantidades enteras y no negativas (0032 dejó todo por
--      unidad, pero un "0,5" o un "-3" llegaban igual por la API) y un
--      producto de OTRO local se rechaza en vez de crearle stock acá.
--   3. Ajuste negativo, merma y toma a la baja descuentan de los lotes, del que
--      vence antes (FEFO). Antes los lotes no se tocaban: "Vencimientos" seguía
--      mostrando mercadería que ya se había botado o que no estaba.
--   4. Una venta con la hora del celular adelantada (más de 5 minutos en el
--      futuro) queda con la hora del servidor: salía en los reportes de mañana.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Caja
-- ---------------------------------------------------------------------------
create or replace function public.fn_open_cash_session(p_opening_amount integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_store  uuid := current_store_id();
  v_id     uuid;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  -- Bodega no tiene caja ni ve dinero (matriz del doc 02). La pantalla ya lo
  -- impedía; la base no.
  if coalesce(current_user_role()::text, '') = 'bodega' then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if coalesce(p_opening_amount, 0) < 0 or coalesce(p_opening_amount, 0) > 5000000 then
    raise exception 'MONTO_INVALIDO' using errcode = 'P0001';
  end if;
  if exists (select 1 from cash_sessions where user_id = v_user and status = 'abierta') then
    raise exception 'CAJA_YA_ABIERTA' using errcode = 'P0001';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  begin
    insert into cash_sessions (tenant_id, store_id, user_id, opening_amount)
    values (v_tenant, v_store, v_user, coalesce(p_opening_amount, 0))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'CAJA_YA_ABIERTA' using errcode = 'P0001';
  end;

  return jsonb_build_object('session_id', v_id, 'opening_amount', coalesce(p_opening_amount, 0));
end $$;

create or replace function public.fn_add_cash_movement(
  p_type cash_movement_type, p_amount integer, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_session uuid;
  v_id     uuid;
begin
  -- 0039 · Sin esto, una cuenta desactivada con la sesión abierta seguía
  -- registrando ingresos y egresos.
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if coalesce(p_amount,0) <= 0 or p_amount > 50000000 then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;

  select id into v_session from cash_sessions
   where user_id = v_user and status = 'abierta' limit 1 for share;
  if v_session is null then
    raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
  end if;

  insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
  values (v_tenant, v_session, p_type, p_amount, left(trim(p_reason), 300), v_user)
  returning id into v_id;

  return jsonb_build_object('movement_id', v_id);
end $$;

create or replace function public.fn_close_cash_session(
  p_session_id uuid, p_counted_amount integer, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_user     uuid := auth.uid();
  v_role     user_role := current_user_role();
  v_s        cash_sessions%rowtype;
  v_summary  jsonb;
  v_expected integer;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  -- Contar no da negativo: un "-5000" dejaba el arqueo con un faltante falso.
  if p_counted_amount is null or p_counted_amount < 0 or p_counted_amount > 50000000 then
    raise exception 'MONTO_INVALIDO' using errcode = 'P0001';
  end if;

  select * into v_s from cash_sessions
   where id = p_session_id and tenant_id = v_tenant for update;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_s.status = 'cerrada' then
    raise exception 'CAJA_YA_CERRADA' using errcode = 'P0001';
  end if;
  if v_s.user_id <> v_user and coalesce(v_role::text, '') not in ('admin','supervisor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  v_summary  := fn_cash_session_summary(p_session_id);
  v_expected := (v_summary->>'expected_amount')::integer;

  if p_counted_amount <> v_expected and coalesce(trim(p_notes),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  update cash_sessions
     set status = 'cerrada', closed_at = now(), closed_by = v_user,
         expected_amount = v_expected, counted_amount = p_counted_amount,
         closing_notes = p_notes
   where id = p_session_id;

  if v_s.user_id <> v_user then
    insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
    values (v_tenant, v_user, 'cash_force_close', 'cash_sessions', p_session_id,
            jsonb_build_object('original_user', v_s.user_id, 'notes', p_notes));
  end if;

  return fn_cash_session_summary(p_session_id);
end $$;

-- ---------------------------------------------------------------------------
-- 2 y 3 · Ajuste y toma de inventario
-- ---------------------------------------------------------------------------
create or replace function public.fn_adjust_stock(
  p_product_id uuid, p_new_quantity numeric,
  p_movement_type movement_type, p_reason text,
  p_ubicacion ubicacion_stock default 'sala'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_store  uuid := current_store_id();
  v_current numeric(14,3);
  v_delta  numeric(14,3);
  v_cost   integer;
  v_lotes  boolean;
begin
  p_ubicacion := 'sala';
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_AJUSTAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_movement_type not in ('ajuste_positivo','ajuste_negativo','merma','inventario_inicial') then
    raise exception 'TIPO_MOVIMIENTO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 or p_new_quantity > 1000000 then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;
  if p_new_quantity <> trunc(p_new_quantity) then
    raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
  end if;

  -- El producto tiene que ser de este local ANTES de tocar el stock.
  select avg_cost, tracks_expiry into v_cost, v_lotes from products
   where id = p_product_id and tenant_id = v_tenant;
  if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  perform fn_lock_stock(v_tenant, v_store, array[p_product_id]);
  select coalesce(quantity,0) into v_current from stock_ubicaciones
   where store_id = v_store and product_id = p_product_id and ubicacion = p_ubicacion;
  v_current := coalesce(v_current, 0);
  v_delta := p_new_quantity - v_current;

  if v_delta = 0 then
    return jsonb_build_object('product_id', p_product_id, 'quantity', v_current,
                              'changed', false);
  end if;

  perform fn_post_movement(v_tenant, v_store, p_product_id, p_movement_type,
                           v_delta, v_cost, 'adjustment', null, p_reason, v_user);

  -- 0039 · Lo que sale de un perecible sale de sus lotes, del que vence antes.
  if v_lotes and v_delta < 0 then
    perform fn_consume_lots(v_tenant, v_store, p_product_id, -v_delta, null);
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, v_user, 'stock_adjustment', 'products', p_product_id,
          jsonb_build_object('quantity', v_current),
          jsonb_build_object('quantity', p_new_quantity, 'reason', p_reason,
                             'type', p_movement_type));

  return jsonb_build_object('product_id', p_product_id, 'quantity', p_new_quantity,
                            'delta', v_delta, 'changed', true);
end $$;

create or replace function public.fn_apply_stock_count(
  p_count_id uuid, p_items jsonb, p_ubicacion ubicacion_stock default 'sala')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_count  stock_counts%rowtype;
  v_item   jsonb;
  v_prod   uuid;
  v_sys    numeric(14,3);
  v_counted numeric(14,3);
  v_delta  numeric(14,3);
  v_cost   integer;
  v_lotes  boolean;
  v_diffs  jsonb := '[]'::jsonb;
  v_value  integer := 0;
begin
  p_ubicacion := 'sala';
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select * into v_count from stock_counts
   where id = p_count_id and tenant_id = v_tenant for update;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_count.status <> 'en_progreso' then
    raise exception 'TOMA_YA_APLICADA' using errcode = 'P0001';
  end if;

  -- Todo se revisa antes de mover nada: una línea mala no deja la toma a medias.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
     where nullif(x->>'counted_qty', '') is null
        or (x->>'counted_qty')::numeric < 0
        or (x->>'counted_qty')::numeric > 1000000
        or (x->>'counted_qty')::numeric <> trunc((x->>'counted_qty')::numeric)
  ) then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
     where not exists (select 1 from products p
                        where p.id = (x->>'product_id')::uuid and p.tenant_id = v_tenant)
  ) then
    raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  perform fn_lock_stock(v_tenant, v_count.store_id, array(
    select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x));

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod := (v_item->>'product_id')::uuid;
    v_counted := (v_item->>'counted_qty')::numeric;

    select coalesce(quantity,0) into v_sys from stock_ubicaciones
     where store_id = v_count.store_id and ubicacion = p_ubicacion
       and product_id = v_prod;
    v_sys := coalesce(v_sys, 0);
    v_delta := v_counted - v_sys;

    insert into stock_count_items (count_id, tenant_id, product_id, system_qty, counted_qty)
    values (p_count_id, v_tenant, v_prod, v_sys, v_counted)
    on conflict (count_id, product_id) do update
      set system_qty = excluded.system_qty, counted_qty = excluded.counted_qty;

    if v_delta <> 0 then
      select avg_cost, tracks_expiry into v_cost, v_lotes from products
       where id = v_prod and tenant_id = v_tenant;
      perform fn_post_movement(v_tenant, v_count.store_id,
                               v_prod, 'toma_inventario',
                               v_delta, v_cost, 'stock_count', p_count_id,
                               'Toma de inventario', v_user);
      if v_lotes and v_delta < 0 then
        perform fn_consume_lots(v_tenant, v_count.store_id, v_prod, -v_delta, null);
      end if;
      v_value := v_value + round(v_delta * coalesce(v_cost,0))::integer;
      v_diffs := v_diffs || jsonb_build_object(
        'product_id', v_prod,
        'system_qty', v_sys, 'counted_qty', v_counted, 'difference', v_delta);
    end if;
  end loop;

  update stock_counts set status = 'aplicada', applied_at = now() where id = p_count_id;

  return jsonb_build_object('count_id', p_count_id,
                            'differences', v_diffs,
                            'difference_value', v_value);
end $$;

-- ---------------------------------------------------------------------------
-- 4 · La hora de la venta no puede ser del futuro
-- ---------------------------------------------------------------------------
create or replace function public.fn_venta_sin_futuro()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.sold_at > now() + interval '5 minutes' then
    new.sold_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_venta_sin_futuro on sales;
create trigger trg_venta_sin_futuro
  before insert on sales
  for each row execute function public.fn_venta_sin_futuro();

revoke execute on function public.fn_venta_sin_futuro() from public, anon, authenticated;
