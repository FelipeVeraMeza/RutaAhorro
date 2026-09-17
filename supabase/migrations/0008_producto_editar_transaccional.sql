-- ============================================================================
-- 0008 · Edición de producto en una sola transacción
--
-- La edición tenía el mismo defecto que el alta tuvo hasta 0007, pero peor.
-- El cliente hacía dos llamadas encadenadas, sin transacción:
--
--   1. update products set ...
--   2. delete from product_barcodes where product_id = ...
--      insert into product_barcodes (...)
--
-- El borrado y la inserción eran dos viajes distintos a la base. Si el segundo
-- fallaba —porque otro usuario acababa de registrar ese código, porque se cayó
-- la conexión en el mostrador, porque el token expiró entre una llamada y la
-- otra— el producto quedaba **sin ningún código de barra**. Y un producto sin
-- código no aparece al escanear: deja de venderse y nadie entiende por qué.
-- El daño no se ve en la pantalla de productos, donde el artículo sigue ahí,
-- con su nombre y su precio. Se ve en la caja, cuando el lector pita y no pasa
-- nada.
--
-- Dos cosas cambian acá:
--
-- a) **Es atómica.** O entra el producto con sus códigos, o no entra nada.
--
-- b) **`p_barcodes` nulo significa "no tocar los códigos".** No es un detalle
--    de estilo: la carga masiva llamaba a la edición con la lista vacía cuando
--    la planilla no traía columna de código de barra, y eso borraba los
--    códigos de todos los productos que la planilla tocara. Una planilla de
--    actualización de precios —nombre, sku, precio, que es exactamente la que
--    manda un proveedor— dejaba el catálogo entero invisible al escáner.
--    Ahora: nulo = no tocar, arreglo = dejar exactamente esos (y el arreglo
--    vacío sí borra, porque eso es lo que pide quien vacía la lista en el
--    formulario).
--
-- Los códigos se reconcilian por diferencia en vez de borrar y reinsertar:
-- se quitan los que sobran y se agregan los que faltan. Los que no cambiaron
-- nunca dejan de existir, ni siquiera dentro de la transacción.
--
-- Ver docs/21-qa-pantallas.md, hallazgo A-4, y docs/22, T-02.
-- ============================================================================

create or replace function public.fn_update_product(
  p_product_id        uuid,
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
  p_barcodes          text[]
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_code     text;
  v_dueno    text;
  v_codigos  text[] := '{}';
  v_quitados integer := 0;
  v_i        integer := 0;
begin
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_CREAR_PRODUCTO' using errcode = '42501';
  end if;

  -- La función es `security definer`: corre sin RLS. Sin esta comprobación,
  -- cualquier usuario podría editar el producto de otro local pasando su id.
  -- El `for update` además bloquea la fila: dos ediciones simultáneas del
  -- mismo producto se ordenan en vez de pisarse a medias.
  perform 1 from products
   where id = p_product_id and tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_name),'') = '' then
    raise exception 'NOMBRE_REQUERIDO' using errcode = 'P0001';
  end if;

  if coalesce(p_sale_price, 0) < 0 or coalesce(p_avg_cost, 0) < 0 then
    raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
  end if;

  if coalesce(p_min_stock, 0) < 0 then
    raise exception 'CANTIDAD_NEGATIVA' using errcode = 'P0001';
  end if;

  if coalesce(p_tracks_expiry, false) and coalesce(p_expiry_alert_days, 0) <= 0 then
    raise exception 'DIAS_ALERTA_REQUERIDOS' using errcode = 'P0001';
  end if;

  -- Los códigos se validan ANTES de escribir nada, para poder nombrar el
  -- código repetido y el producto que lo tiene. Dejárselo a la restricción
  -- unique daría el nombre de un índice como mensaje de error.
  if p_barcodes is not null then
    foreach v_code in array p_barcodes loop
      v_code := trim(v_code);
      continue when v_code = '';

      if v_code = any(v_codigos) then
        raise exception 'CODIGO_EN_USO:%:%', v_code, trim(p_name) using errcode = 'P0001';
      end if;
      v_codigos := v_codigos || v_code;

      select p.name into v_dueno
        from product_barcodes b
        join products p on p.id = b.product_id
       where b.tenant_id = v_tenant
         and b.barcode = v_code
         and b.product_id <> p_product_id
       limit 1;

      if v_dueno is not null then
        raise exception 'CODIGO_EN_USO:%:%', v_code, v_dueno using errcode = 'P0001';
      end if;
    end loop;
  end if;

  update products set
    name              = trim(p_name),
    sku               = nullif(trim(coalesce(p_sku,'')), ''),
    -- Nulo = no tocar, igual que el costo y los códigos. La cadena vacía sí
    -- la borra, porque es lo que pide quien vacía el campo en el formulario.
    description       = case when p_description is null then description
                             else nullif(trim(p_description), '') end,
    category_id       = p_category_id,
    unit              = coalesce(nullif(trim(coalesce(p_unit,'')), ''), 'unidad'),
    sale_price        = coalesce(p_sale_price, sale_price),
    -- El costo promedio lo mantiene fn_confirm_receipt con el promedio
    -- ponderado. Solo se pisa si quien edita lo mandó explícitamente: con el
    -- campo en blanco viajaba 0 y editar el nombre dejaba el costo —y con él
    -- el margen y el inventario valorizado— en cero.
    avg_cost          = coalesce(p_avg_cost, avg_cost),
    min_stock         = coalesce(p_min_stock, min_stock),
    tracks_expiry     = coalesce(p_tracks_expiry, tracks_expiry),
    expiry_alert_days = coalesce(p_expiry_alert_days, expiry_alert_days)
  where id = p_product_id and tenant_id = v_tenant;

  if p_barcodes is not null then
    -- Sobran: los que están en la base y no en la lista nueva.
    with borrados as (
      delete from product_barcodes
       where tenant_id = v_tenant
         and product_id = p_product_id
         and not (barcode = any(v_codigos))
      returning 1
    )
    select count(*) into v_quitados from borrados;

    -- Faltan: los de la lista nueva que todavía no están. El primero de la
    -- lista es el principal.
    --
    -- Deliberadamente sin `on conflict do nothing`: si entre la validación de
    -- más arriba y esta línea otro usuario registró ese mismo código, la
    -- restricción unique tiene que reventar y tumbar la transacción completa.
    -- Tragarse el conflicto dejaría a quien edita creyendo que guardó un
    -- código que quedó en otro producto.
    foreach v_code in array v_codigos loop
      v_i := v_i + 1;
      update product_barcodes set is_primary = (v_i = 1)
       where tenant_id = v_tenant and product_id = p_product_id and barcode = v_code;
      if not found then
        insert into product_barcodes (tenant_id, product_id, barcode, is_primary)
        values (v_tenant, p_product_id, v_code, v_i = 1);
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'product_id', p_product_id,
    'barcodes',   v_i,
    'removed',    v_quitados,
    'touched',    p_barcodes is not null
  );
end $$;

comment on function public.fn_update_product is
  'Edición de producto atómica. p_barcodes nulo = no tocar los códigos; arreglo = dejar exactamente esos. Ver docs/22 T-02.';
