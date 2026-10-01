-- ============================================================================
-- 0032 · Una sola bodega, todo por unidad, y el precio por mayor es del producto
--
-- Decisiones de Felipe (2026-10-01), después de ver el sistema en el local:
--
-- 1. **Una sola bodega.** La sala y la bodega separadas (0014) pedían registrar
--    cada traspaso, y en el local no hay quién lo haga: el stock de la sala
--    quedaba en cero con mercadería en la bodega. Desde acá todo el stock está
--    en un solo lugar.
--    Cómo: lo que había en la bodega pasa a la sala con un traspaso en el
--    kardex (queda cuándo y por qué, ADR-006), y desde ahí todo movimiento cae
--    en la sala, diga lo que diga quien lo registra. Se usa 'sala' y no
--    'bodega' porque las ventas, los avisos de "no alcanza" y el catálogo del
--    celular ya leen la sala. La pantalla lo llama "bodega": para el local es
--    un solo lugar. El tipo y la tabla de 0014 se quedan: borrarlos obligaría
--    a reescribir el kardex, que no se reescribe.
--
-- 2. **Todo se vende y se cuenta por unidad.** Nada de kg, litro ni ml. Un
--    producto nace y queda en 'unidad', y la venta y la recepción no aceptan
--    medias unidades (antes solo la pantalla lo impedía: pendiente del
--    2026-09-28).
--
-- 3. **El precio por mayor es del producto, no del cliente.** "Las papas por
--    mayor desde 3": un cliente que lleva 2 no tiene precio mayorista por ser
--    quien es. La venta deja de aplicar el precio por cliente de 0022 (el % y
--    los precios especiales) y no se pueden guardar nuevos. Lo que ya estaba
--    guardado NO se borra: queda sin efecto, por si algún día se quiere volver.
--    El cliente sigue para la factura y el fiado; el precio por mayor es la
--    oferta por cantidad del producto (0018).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Una sola bodega
-- ---------------------------------------------------------------------------

-- Lo que estaba en la bodega pasa a la sala, con su traspaso en el kardex.
-- El traspaso necesita el disparador de 0014, que respeta el lugar que se
-- pide: con el nuevo, los dos movimientos caerían en el mismo lugar y la
-- bodega no quedaría en cero. Se repone acá para que correr este archivo dos
-- veces (instalar.sql, regla de idempotencia) haga lo mismo que la primera.
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

do $$
declare
  r     record;
  v_ref uuid;
begin
  for r in
    select su.tenant_id, su.store_id, su.product_id, su.quantity, p.avg_cost
      from stock_ubicaciones su
      join products p on p.id = su.product_id
     where su.ubicacion = 'bodega' and su.quantity <> 0
  loop
    v_ref := gen_random_uuid();
    perform fn_en_ubicacion('bodega');
    perform fn_post_movement(r.tenant_id, r.store_id, r.product_id, 'traslado', -r.quantity,
                             r.avg_cost, 'transfer', v_ref, 'Una sola bodega (0032)', null);
    perform fn_en_ubicacion('sala');
    perform fn_post_movement(r.tenant_id, r.store_id, r.product_id, 'traslado', r.quantity,
                             r.avg_cost, 'transfer', v_ref, 'Una sola bodega (0032)', null);
    perform fn_en_ubicacion(null);
  end loop;
end $$;

-- Desde ahora, todo movimiento queda en el único lugar.
create or replace function public.fn_ubicacion_por_tipo(p_tipo movement_type)
returns ubicacion_stock
language sql immutable set search_path = public
as $$ select 'sala'::ubicacion_stock $$;

create or replace function public.fn_movimiento_ubicacion()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Lo que diga quien registra (fn_en_ubicacion, o la columna) ya no cuenta:
  -- hay un solo lugar.
  new.ubicacion := 'sala';
  return new;
end $$;

-- Ajuste y toma leen "lo que hay en ESA ubicación". Con la bodega en cero,
-- dejar en 7 algo contado "en la bodega" sumaba 7 al total en vez de dejarlo
-- en 7. Mismas funciones que 0014, con el lugar fijo.
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
  p_ubicacion := 'sala';
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

  perform fn_post_movement(v_tenant, v_store, p_product_id, p_movement_type,
                           v_delta, v_cost, 'adjustment', null, p_reason, v_user);

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
  v_sys    numeric(14,3);
  v_counted numeric(14,3);
  v_delta  numeric(14,3);
  v_cost   integer;
  v_diffs  jsonb := '[]'::jsonb;
  v_value  integer := 0;
begin
  p_ubicacion := 'sala';
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
      perform fn_post_movement(v_tenant, v_count.store_id,
                               (v_item->>'product_id')::uuid, 'toma_inventario',
                               v_delta, v_cost, 'stock_count', p_count_id,
                               'Toma de inventario', v_user);
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

-- Reponer la sala ya no existe: con un solo lugar no hay a dónde traspasar.
create or replace function public.fn_transfer_stock(
  p_product_id uuid, p_cantidad numeric,
  p_desde ubicacion_stock default 'bodega',
  p_hacia ubicacion_stock default 'sala',
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'UNA_SOLA_BODEGA' using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Todo por unidad
-- ---------------------------------------------------------------------------
update products set unit = 'unidad' where unit is distinct from 'unidad';

create or replace function public.fn_producto_por_unidad()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.unit := 'unidad';
  return new;
end $$;

drop trigger if exists trg_producto_por_unidad on products;
create trigger trg_producto_por_unidad
  before insert or update of unit on products
  for each row execute function public.fn_producto_por_unidad();

-- Unidades enteras al vender y al recibir. Lo vendido o recibido antes queda
-- como está: el disparador mira solo filas nuevas.
create or replace function public.fn_cantidad_entera()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.quantity <> trunc(new.quantity) then
    raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_venta_cantidad_entera on sale_items;
create trigger trg_venta_cantidad_entera
  before insert on sale_items
  for each row execute function public.fn_cantidad_entera();

drop trigger if exists trg_recepcion_cantidad_entera on purchase_receipt_items;
create trigger trg_recepcion_cantidad_entera
  before insert on purchase_receipt_items
  for each row execute function public.fn_cantidad_entera();

-- ---------------------------------------------------------------------------
-- 3 · Sin precio por cliente (sin borrar lo guardado)
-- ---------------------------------------------------------------------------
-- fn_register_sale (0029) la sigue llamando: devolviendo null, ninguna línea
-- baja al precio de un cliente. cliente_precios y clientes.descuento_pct
-- quedan como estaban, sin efecto.
create or replace function public.fn_precio_cliente(
  p_cliente uuid, p_product uuid, p_base integer
) returns integer
language sql stable set search_path = public
as $$ select null::integer $$;

create or replace function public.fn_guardar_precios_cliente(p_cliente_id uuid, p_precios jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'PRECIO_POR_CLIENTE_DESACTIVADO' using errcode = 'P0001';
end $$;

revoke execute on function public.fn_producto_por_unidad() from public, anon, authenticated;
revoke execute on function public.fn_cantidad_entera()     from public, anon, authenticated;
