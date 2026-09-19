-- ============================================================================
-- 0014 · Bodega y sala de ventas
--
-- El local guarda la mercadería en dos lugares: la bodega, donde llega todo, y
-- la sala, donde está a la vista para vender. Hasta ahora el sistema sabía el
-- total del local y nada más: no había forma de saber cuánto quedaba en la
-- sala, que es lo que se está vendiendo, ni cuándo reponer.
--
-- Decisiones (Felipe, 2026-09-19):
--   · Lo que llega del proveedor entra a la BODEGA.
--   · La sala se repone con un TRASPASO registrado (bodega -> sala).
--   · Las ventas descuentan de la SALA. Si la sala queda en 0 y hay en
--     bodega, se avisa y se deja vender: no se pierde una venta por no haber
--     registrado un traspaso.
--
-- Diseño: nada de lo existente cambia de significado.
--   · stock_levels sigue siendo el total del local, y el kardex la fuente de
--     verdad. Las pruebas de concurrencia y seguridad siguen valiendo.
--   · Cada movimiento del kardex dice en qué ubicación ocurrió
--     (inventory_movements.ubicacion). Un disparador mantiene
--     stock_ubicaciones, y sala + bodega = total siempre.
--   · Un traspaso son dos movimientos 'traslado' que se anulan (-12 bodega,
--     +12 sala): el total no cambia y queda en el kardex quién movió qué.
--   · La ubicación la decide el tipo de movimiento, salvo que la función que
--     lo registra diga otra cosa (ajustes y tomas, donde se elige).
--
-- Límite conocido: los lotes con vencimiento (0006) siguen siendo del total
-- del local, no de una ubicación.
-- ============================================================================

do $$ begin
  create type ubicacion_stock as enum ('bodega', 'sala');
exception when duplicate_object then null; end $$;

alter type movement_type add value if not exists 'traslado';

alter table inventory_movements
  add column if not exists ubicacion ubicacion_stock;

create table if not exists stock_ubicaciones (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  store_id    uuid not null references stores(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  ubicacion   ubicacion_stock not null,
  quantity    numeric(14,3) not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (store_id, product_id, ubicacion)
);
create index if not exists idx_stock_ubicaciones_tenant on stock_ubicaciones(tenant_id);

-- Solo se lee. La escribe el disparador, igual que stock_levels (0012).
alter table stock_ubicaciones enable row level security;
drop policy if exists stock_ubicaciones_read on stock_ubicaciones;
create policy stock_ubicaciones_read on stock_ubicaciones for select to authenticated
  using (tenant_id = current_tenant_id());
revoke insert, update, delete on stock_ubicaciones from anon, authenticated;

-- ---------------------------------------------------------------------------
-- La ubicación de cada movimiento
-- ---------------------------------------------------------------------------
create or replace function public.fn_ubicacion_por_tipo(p_tipo movement_type)
returns ubicacion_stock
language sql immutable set search_path = public
as $$
  select case p_tipo::text
    when 'venta'               then 'sala'
    when 'anulacion_venta'     then 'sala'
    when 'merma'               then 'sala'
    when 'recepcion'           then 'bodega'
    when 'anulacion_recepcion' then 'bodega'
    when 'inventario_inicial'  then 'bodega'
    else 'sala'
  end::ubicacion_stock
$$;

-- Una función que registra movimientos en una ubicación distinta de la de su
-- tipo la fija acá antes de llamar a fn_post_movement, y la limpia después.
-- Es local a la transacción: no se filtra a otra llamada.
create or replace function public.fn_en_ubicacion(p_ubicacion ubicacion_stock)
returns void
language sql
as $$ select set_config('ra.ubicacion', coalesce(p_ubicacion::text, ''), true) $$;

create or replace function public.fn_movimiento_ubicacion()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.ubicacion is null then
    new.ubicacion := coalesce(
      nullif(current_setting('ra.ubicacion', true), '')::ubicacion_stock,
      fn_ubicacion_por_tipo(new.movement_type));
  end if;
  return new;
end $$;

create or replace function public.fn_movimiento_saldo_ubicacion()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into stock_ubicaciones (tenant_id, store_id, product_id, ubicacion, quantity, updated_at)
  values (new.tenant_id, new.store_id, new.product_id, new.ubicacion, new.quantity, now())
  on conflict (store_id, product_id, ubicacion) do update
    set quantity = stock_ubicaciones.quantity + excluded.quantity,
        updated_at = now();
  return new;
end $$;

drop trigger if exists trg_movimiento_ubicacion on inventory_movements;
create trigger trg_movimiento_ubicacion
  before insert on inventory_movements
  for each row execute function public.fn_movimiento_ubicacion();

drop trigger if exists trg_movimiento_saldo_ubicacion on inventory_movements;
create trigger trg_movimiento_saldo_ubicacion
  after insert on inventory_movements
  for each row execute function public.fn_movimiento_saldo_ubicacion();

-- El stock que ya existía se reparte con la misma regla que usa el disparador,
-- sobre el kardex. Así sala + bodega = total desde el primer momento.
insert into stock_ubicaciones (tenant_id, store_id, product_id, ubicacion, quantity)
select tenant_id, store_id, product_id,
       coalesce(ubicacion, fn_ubicacion_por_tipo(movement_type)), sum(quantity)
  from inventory_movements
 group by 1, 2, 3, 4
on conflict (store_id, product_id, ubicacion) do nothing;

-- ---------------------------------------------------------------------------
-- fn_transfer_stock — reponer la sala (o devolver a bodega)
-- ---------------------------------------------------------------------------
-- Cualquier usuario activo del local puede reponer: en un almacén chico el
-- que repone es el mismo que vende. No cambia el total ni el costo.
create or replace function public.fn_transfer_stock(
  p_product_id uuid, p_cantidad numeric,
  p_desde ubicacion_stock default 'bodega',
  p_hacia ubicacion_stock default 'sala',
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_store  uuid := current_store_id();
  v_prod   products%rowtype;
  v_hay    numeric(14,3);
  v_ref    uuid := gen_random_uuid();
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(p_cantidad, 0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;
  if p_desde = p_hacia then
    raise exception 'TRASPASO_MISMA_UBICACION' using errcode = 'P0001';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  select * into v_prod from products where id = p_product_id and tenant_id = v_tenant;
  if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

  -- Mismo orden de bloqueo que todas las demás funciones (0012): stock primero.
  perform fn_lock_stock(v_tenant, v_store, array[p_product_id]);
  select coalesce(quantity, 0) into v_hay from stock_ubicaciones
   where store_id = v_store and product_id = p_product_id and ubicacion = p_desde;
  -- No se puede sacar de un lugar más de lo que hay: físicamente no existe.
  -- Si el sistema dice menos de lo que hay, lo que corresponde es un ajuste.
  if coalesce(v_hay, 0) < p_cantidad then
    raise exception 'STOCK_INSUFICIENTE_EN_UBICACION: %', v_prod.name using errcode = 'P0001';
  end if;

  perform fn_en_ubicacion(p_desde);
  perform fn_post_movement(v_tenant, v_store, p_product_id, 'traslado', -p_cantidad,
                           v_prod.avg_cost, 'transfer', v_ref, p_reason, v_user);
  perform fn_en_ubicacion(p_hacia);
  perform fn_post_movement(v_tenant, v_store, p_product_id, 'traslado', p_cantidad,
                           v_prod.avg_cost, 'transfer', v_ref, p_reason, v_user);
  perform fn_en_ubicacion(null);

  return (select jsonb_build_object(
    'product_id', p_product_id,
    'sala',   coalesce(sum(quantity) filter (where ubicacion = 'sala'), 0),
    'bodega', coalesce(sum(quantity) filter (where ubicacion = 'bodega'), 0))
    from stock_ubicaciones where store_id = v_store and product_id = p_product_id);
end $$;

-- ---------------------------------------------------------------------------
-- Ajuste y toma: ahora en una ubicación. Iguales que 0012 en todo lo demás.
-- ---------------------------------------------------------------------------
drop function if exists public.fn_adjust_stock(uuid, numeric, movement_type, text);
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
begin
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_AJUSTAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_movement_type not in ('ajuste_positivo','ajuste_negativo','merma','inventario_inicial') then
    raise exception 'TIPO_MOVIMIENTO_INVALIDO' using errcode = 'P0001';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  perform fn_lock_stock(v_tenant, v_store, array[p_product_id]);
  -- "Dejar en 7" es 7 en ESA ubicación: lo que se contó es lo que hay en la
  -- sala o en la bodega, no el total del local.
  select coalesce(quantity,0) into v_current from stock_ubicaciones
   where store_id = v_store and product_id = p_product_id and ubicacion = p_ubicacion;
  v_current := coalesce(v_current, 0);
  v_delta := p_new_quantity - v_current;

  if v_delta = 0 then
    return jsonb_build_object('product_id', p_product_id, 'quantity', v_current,
                              'changed', false);
  end if;

  select avg_cost into v_cost from products where id = p_product_id and tenant_id = v_tenant;
  if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

  perform fn_en_ubicacion(p_ubicacion);
  perform fn_post_movement(v_tenant, v_store, p_product_id, p_movement_type,
                           v_delta, v_cost, 'adjustment', null, p_reason, v_user);
  perform fn_en_ubicacion(null);

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, v_user, 'stock_adjustment', 'products', p_product_id,
          jsonb_build_object('quantity', v_current),
          jsonb_build_object('quantity', p_new_quantity, 'reason', p_reason,
                             'type', p_movement_type, 'ubicacion', p_ubicacion));

  return jsonb_build_object('product_id', p_product_id, 'quantity', p_new_quantity,
                            'delta', v_delta, 'changed', true);
end $$;

drop function if exists public.fn_apply_stock_count(uuid, jsonb);
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
  v_sys    numeric(14,3);
  v_counted numeric(14,3);
  v_delta  numeric(14,3);
  v_cost   integer;
  v_diffs  jsonb := '[]'::jsonb;
  v_value  integer := 0;
begin
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select * into v_count from stock_counts
   where id = p_count_id and tenant_id = v_tenant for update;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_count.status <> 'en_progreso' then
    raise exception 'TOMA_YA_APLICADA' using errcode = 'P0001';
  end if;

  perform fn_lock_stock(v_tenant, v_count.store_id, array(
    select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x));

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_counted := (v_item->>'counted_qty')::numeric;

    -- Se cuenta una ubicación a la vez: la sala o la bodega.
    select coalesce(quantity,0) into v_sys from stock_ubicaciones
     where store_id = v_count.store_id and ubicacion = p_ubicacion
       and product_id = (v_item->>'product_id')::uuid;
    v_sys := coalesce(v_sys, 0);
    v_delta := v_counted - v_sys;

    insert into stock_count_items (count_id, tenant_id, product_id, system_qty, counted_qty)
    values (p_count_id, v_tenant, (v_item->>'product_id')::uuid, v_sys, v_counted)
    on conflict (count_id, product_id) do update
      set system_qty = excluded.system_qty, counted_qty = excluded.counted_qty;

    if v_delta <> 0 then
      select avg_cost into v_cost from products
       where id = (v_item->>'product_id')::uuid and tenant_id = v_tenant;
      perform fn_en_ubicacion(p_ubicacion);
      perform fn_post_movement(v_tenant, v_count.store_id,
                               (v_item->>'product_id')::uuid, 'toma_inventario',
                               v_delta, v_cost, 'stock_count', p_count_id,
                               'Toma de inventario', v_user);
      perform fn_en_ubicacion(null);
      v_value := v_value + round(v_delta * coalesce(v_cost,0))::integer;
      v_diffs := v_diffs || jsonb_build_object(
        'product_id', (v_item->>'product_id')::uuid,
        'system_qty', v_sys, 'counted_qty', v_counted, 'difference', v_delta);
    end if;
  end loop;

  update stock_counts set status = 'aplicada', applied_at = now() where id = p_count_id;

  return jsonb_build_object('count_id', p_count_id,
                            'differences', v_diffs,
                            'difference_value', v_value);
end $$;

-- ---------------------------------------------------------------------------
-- Reconstrucción: también las ubicaciones, desde el kardex
-- ---------------------------------------------------------------------------
create or replace function public.fn_rebuild_stock_levels(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_fixed integer := 0; v_ubic integer := 0;
begin
  with real as (
    select tenant_id, store_id, product_id, sum(quantity) as qty
      from inventory_movements where tenant_id = p_tenant
     group by 1,2,3
  ), upd as (
    update stock_levels sl
       set quantity = r.qty, updated_at = now()
      from real r
     where sl.tenant_id = r.tenant_id and sl.store_id = r.store_id
       and sl.product_id = r.product_id and sl.quantity <> r.qty
    returning 1
  )
  select count(*) into v_fixed from upd;

  with real as (
    select tenant_id, store_id, product_id,
           coalesce(ubicacion, fn_ubicacion_por_tipo(movement_type)) as ubicacion,
           sum(quantity) as qty
      from inventory_movements where tenant_id = p_tenant
     group by 1,2,3,4
  ), upd as (
    insert into stock_ubicaciones (tenant_id, store_id, product_id, ubicacion, quantity)
    select * from real
    on conflict (store_id, product_id, ubicacion) do update
      set quantity = excluded.quantity, updated_at = now()
      where stock_ubicaciones.quantity <> excluded.quantity
    returning 1
  )
  select count(*) into v_ubic from upd;

  return jsonb_build_object('tenant_id', p_tenant, 'corrected', v_fixed,
                            'corrected_locations', v_ubic);
end $$;

-- ---------------------------------------------------------------------------
-- Vista para las pantallas: sala, bodega y total por producto
-- ---------------------------------------------------------------------------
create or replace view v_stock_ubicacion
with (security_invoker = true) as
select
  p.tenant_id, p.id as product_id, p.name, p.unit, p.min_stock, p.is_active,
  coalesce(sum(su.quantity) filter (where su.ubicacion = 'sala'), 0)   as sala,
  coalesce(sum(su.quantity) filter (where su.ubicacion = 'bodega'), 0) as bodega,
  coalesce(sum(su.quantity), 0)                                          as total
from products p
left join stock_ubicaciones su on su.product_id = p.id
group by p.tenant_id, p.id, p.name, p.unit, p.min_stock, p.is_active;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function public.fn_transfer_stock    from public, anon;
revoke execute on function public.fn_adjust_stock      from public, anon;
revoke execute on function public.fn_apply_stock_count from public, anon;
grant  execute on function public.fn_transfer_stock    to authenticated;
grant  execute on function public.fn_adjust_stock      to authenticated;
grant  execute on function public.fn_apply_stock_count to authenticated;
revoke execute on function public.fn_en_ubicacion               from public, anon, authenticated;
revoke execute on function public.fn_movimiento_ubicacion       from public, anon, authenticated;
revoke execute on function public.fn_movimiento_saldo_ubicacion from public, anon, authenticated;
revoke execute on function public.fn_rebuild_stock_levels       from public, anon, authenticated;
grant  execute on function public.fn_rebuild_stock_levels       to service_role;
