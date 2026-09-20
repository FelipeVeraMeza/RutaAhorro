-- ============================================================================
-- 0016 · A dónde va cada unidad cuando se ingresa un producto
--
-- Puntos 1 y 2 de la reunión del 2026-09-19, en palabras de Felipe:
--
--   «no sale a dónde va cada producto cuando lo ingreso»
--   «que se entienda cuánta cantidad agrego en punto de venta y cuántos hay
--    en bodega, y mejorar qué es cada cosa, más simple»
--
-- Son el mismo problema por dos lados. Desde 0014 el local tiene dos lugares
-- —la bodega y la sala— y el sistema los lleva bien, pero **en ninguna parte
-- se dice a cuál entra lo que se está ingresando**. Al crear un producto, el
-- formulario pide "Stock inicial" a secas y las unidades caen todas en la
-- bodega, porque así lo decide `fn_ubicacion_por_tipo`. Quien lo carga cree
-- que las dejó listas para vender, va al POS y la sala está en cero.
--
-- El arreglo es dejar de adivinar: se pregunta cuántas quedan a la vista y
-- cuántas en bodega, y cada una entra donde dice.
--
-- No cambia nada de lo anterior: siguen siendo movimientos 'inventario_inicial'
-- por el kardex (ADR-006), sala + bodega sigue sumando el total, y quien llame
-- sin el parámetro nuevo obtiene exactamente lo de antes (todo a bodega).
-- ============================================================================

-- `create or replace` con un parámetro nuevo crearía una sobrecarga, no un
-- reemplazo. Misma razón y mismo recurso que 0014 con fn_adjust_stock y 0015
-- con fn_register_sale.
drop function if exists public.fn_create_product(
  text, text, text, uuid, text, integer, integer, numeric, boolean, integer, text[], numeric);
create or replace function public.fn_create_product(
  p_name              text,
  p_sku               text,
  p_description       text,
  p_category_id       uuid,
  p_unit              text,
  p_sale_price        integer,
  p_avg_cost          integer,
  p_min_stock         numeric,
  p_tracks_expiry     boolean,
  p_expiry_alert_days integer,
  p_barcodes          text[],
  -- Cuántas unidades quedan guardadas en la bodega. Se llama así desde 0007 y
  -- se conserva el nombre para no romper a quien ya llama a la función.
  p_initial_stock     numeric,
  -- Cuántas quedan a la vista, en la sala de ventas (0016). Omitirlo es lo de
  -- antes: todo a la bodega.
  p_initial_stock_sala numeric default 0
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_user    uuid := auth.uid();
  v_store   uuid := current_store_id();
  v_product uuid;
  v_code    text;
  v_dueno   text;
  v_i       integer := 0;
begin
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_CREAR_PRODUCTO' using errcode = '42501';
  end if;

  if coalesce(trim(p_name),'') = '' then
    raise exception 'NOMBRE_REQUERIDO' using errcode = 'P0001';
  end if;

  -- El precio y el costo ya tienen CHECK >= 0 en la tabla, pero fallar acá da
  -- un error nombrado en vez de una violación de restricción que el cliente
  -- tendría que traducir.
  if coalesce(p_sale_price, 0) < 0 or coalesce(p_avg_cost, 0) < 0 then
    raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
  end if;

  if coalesce(p_initial_stock, 0) < 0 or coalesce(p_initial_stock_sala, 0) < 0 then
    raise exception 'CANTIDAD_NEGATIVA' using errcode = 'P0001';
  end if;

  -- Un perecible sin días de alerta no serviría para avisar nada.
  if p_tracks_expiry and coalesce(p_expiry_alert_days, 0) <= 0 then
    raise exception 'DIAS_ALERTA_REQUERIDOS' using errcode = 'P0001';
  end if;

  -- Códigos de barra: se revisan ANTES de insertar nada, para poder decir cuál
  -- es el código repetido y de qué producto es. Si se dejara fallar a la
  -- restricción unique, el mensaje sería el nombre del índice.
  if p_barcodes is not null then
    foreach v_code in array p_barcodes loop
      v_code := trim(v_code);
      continue when v_code = '';

      select p.name into v_dueno
        from product_barcodes b
        join products p on p.id = b.product_id
       where b.tenant_id = v_tenant and b.barcode = v_code
       limit 1;

      if v_dueno is not null then
        raise exception 'CODIGO_EN_USO:%:%', v_code, v_dueno using errcode = 'P0001';
      end if;
    end loop;
  end if;

  insert into products (
    tenant_id, name, sku, description, category_id, unit, sale_price,
    avg_cost, last_cost, min_stock, tracks_expiry, expiry_alert_days
  ) values (
    v_tenant, trim(p_name), nullif(trim(coalesce(p_sku,'')), ''),
    nullif(trim(coalesce(p_description,'')), ''), p_category_id,
    coalesce(nullif(trim(coalesce(p_unit,'')), ''), 'unidad'),
    coalesce(p_sale_price, 0), coalesce(p_avg_cost, 0), coalesce(p_avg_cost, 0),
    coalesce(p_min_stock, 0), coalesce(p_tracks_expiry, false),
    coalesce(p_expiry_alert_days, 30)
  )
  returning id into v_product;

  if p_barcodes is not null then
    foreach v_code in array p_barcodes loop
      v_code := trim(v_code);
      continue when v_code = '';
      v_i := v_i + 1;
      insert into product_barcodes (tenant_id, product_id, barcode, is_primary)
      values (v_tenant, v_product, v_code, v_i = 1);
    end loop;
  end if;

  -- El stock inicial entra por el kardex, nunca escribiendo stock_levels
  -- directamente (ADR-006): así el saldo siempre tiene un movimiento que lo
  -- explica y el inventario se puede reconstruir desde cero.
  --
  -- Un movimiento por lugar, y cada uno dice en cuál (0016). Antes había uno
  -- solo y caía en la bodega por omisión, sin que nadie lo hubiera pedido.
  if coalesce(p_initial_stock, 0) > 0 or coalesce(p_initial_stock_sala, 0) > 0 then
    if v_store is null then
      select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
    end if;
    if v_store is null then
      raise exception 'SIN_TIENDA' using errcode = 'P0001';
    end if;

    if coalesce(p_initial_stock, 0) > 0 then
      perform fn_en_ubicacion('bodega');
      perform fn_post_movement(
        v_tenant, v_store, v_product, 'inventario_inicial',
        p_initial_stock, coalesce(p_avg_cost, 0),
        'product', v_product, 'Carga inicial · a la bodega', v_user
      );
    end if;

    if coalesce(p_initial_stock_sala, 0) > 0 then
      perform fn_en_ubicacion('sala');
      perform fn_post_movement(
        v_tenant, v_store, v_product, 'inventario_inicial',
        p_initial_stock_sala, coalesce(p_avg_cost, 0),
        'product', v_product, 'Carga inicial · a la sala de ventas', v_user
      );
    end if;

    -- Se limpia siempre: es local a la transacción, pero dejarla puesta haría
    -- que el siguiente movimiento de esta misma transacción la heredara.
    perform fn_en_ubicacion(null);
  end if;

  return jsonb_build_object(
    'product_id',  v_product,
    'barcodes',    v_i,
    'stock',       coalesce(p_initial_stock, 0) + coalesce(p_initial_stock_sala, 0),
    'stock_bodega', coalesce(p_initial_stock, 0),
    'stock_sala',   coalesce(p_initial_stock_sala, 0)
  );
end $$;

comment on function public.fn_create_product is
  'Alta de producto atómica: producto, códigos de barra y stock inicial repartido entre bodega y sala (0016). Ver docs/21 A-4 y §0f.';

-- Regla 12: para cerrar una función hay que revocarle a `public`, no a
-- `authenticated`. La firma nueva empieza desde cero.
revoke execute on function public.fn_create_product(
  text, text, text, uuid, text, integer, integer, numeric, boolean, integer, text[], numeric, numeric)
  from public, anon;
grant execute on function public.fn_create_product(
  text, text, text, uuid, text, integer, integer, numeric, boolean, integer, text[], numeric, numeric)
  to authenticated;
