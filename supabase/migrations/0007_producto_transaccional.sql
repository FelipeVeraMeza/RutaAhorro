-- ============================================================================
-- 0007 · Alta de producto en una sola transacción
--
-- Crear un producto son tres escrituras: la fila del producto, sus códigos de
-- barra y el movimiento de stock inicial. El cliente las hacía encadenadas,
-- una llamada por cada una, sin transacción.
--
-- El modo de falla es feo y silencioso: si la segunda falla —por ejemplo
-- porque otro usuario acaba de registrar ese mismo código de barra— el
-- producto ya quedó creado, el usuario ve un error, y al reintentar crea un
-- duplicado. El catálogo queda con dos filas del mismo artículo y una de
-- ellas sin códigos, que es justo la que no aparecerá al escanear.
--
-- Una función plpgsql es atómica: o entran las tres cosas o no entra ninguna.
-- Es el mismo criterio que ya se aplica a la venta (fn_register_sale) y a la
-- recepción (fn_confirm_receipt).
--
-- Ver docs/21-qa-pantallas.md, hallazgo A-4.
-- ============================================================================

create or replace function public.fn_create_product(
  p_name              text,
  p_sku               text,
  p_category_id       uuid,
  p_unit              text,
  p_sale_price        integer,
  p_avg_cost          integer,
  p_min_stock         numeric,
  p_tracks_expiry     boolean,
  p_expiry_alert_days integer,
  p_barcodes          text[],
  p_initial_stock     numeric
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

  if coalesce(p_initial_stock, 0) < 0 then
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
    tenant_id, name, sku, category_id, unit, sale_price,
    avg_cost, last_cost, min_stock, tracks_expiry, expiry_alert_days
  ) values (
    v_tenant, trim(p_name), nullif(trim(coalesce(p_sku,'')), ''), p_category_id,
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
  if coalesce(p_initial_stock, 0) > 0 then
    if v_store is null then
      select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
    end if;
    if v_store is null then
      raise exception 'SIN_TIENDA' using errcode = 'P0001';
    end if;

    perform fn_post_movement(
      v_tenant, v_store, v_product, 'inventario_inicial',
      p_initial_stock, coalesce(p_avg_cost, 0),
      'product', v_product, 'Stock inicial al crear el producto', v_user
    );
  end if;

  return jsonb_build_object(
    'product_id', v_product,
    'barcodes',   v_i,
    'stock',      coalesce(p_initial_stock, 0)
  );
end $$;

comment on function public.fn_create_product is
  'Alta de producto atómica: producto, códigos de barra y stock inicial, o nada. Ver docs/21 A-4.';
