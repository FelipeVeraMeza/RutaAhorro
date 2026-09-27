-- ============================================================================
-- 0020 · Productos: quién lo modificó y aviso de edición simultánea
--
-- RF-M10-11: "mostrar quién y cuándo modificó por última vez un producto".
--   `products.updated_by`, lo pone el mismo disparador que ya ponía
--   `updated_at` (fn_track_price_change).
--
-- RF-M10-03 (CP-06, P-24 opción a): si dos personas editan el mismo producto,
--   el segundo en guardar recibe PRODUCTO_CAMBIO_MIENTRAS_EDITABAS con el
--   nombre de quién lo cambió, en vez de pisarle el trabajo sin aviso.
--   fn_update_product recibe el `updated_at` que tenía el producto al abrir el
--   formulario.
--
-- Regla 21: el parámetro nuevo crea otra firma. La vieja se borra acá, y 0008
-- borra esta antes de crear la suya, para que reinstalar no deje dos.
-- ============================================================================

alter table products add column if not exists updated_by uuid references profiles(id) on delete set null;

-- Igual que 0003, más `updated_by`. Sin sesión (el worker, una migración) se
-- conserva el anterior.
create or replace function public.fn_track_price_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.sale_price is distinct from old.sale_price then
    insert into price_history (tenant_id, product_id, old_price, new_price, changed_by)
    values (new.tenant_id, new.id, old.sale_price, new.sale_price, auth.uid());

    insert into audit_log (tenant_id, user_id, action, entity_type, entity_id,
                           old_values, new_values)
    values (new.tenant_id, auth.uid(), 'price_change', 'products', new.id,
            jsonb_build_object('sale_price', old.sale_price),
            jsonb_build_object('sale_price', new.sale_price));
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- fn_update_product — igual que 0008, con la comprobación de edición simultánea
-- ---------------------------------------------------------------------------
drop function if exists public.fn_update_product(uuid, text, text, text, uuid, text, integer, integer, numeric, boolean, integer, text[]);
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
  p_barcodes          text[],
  -- 0020 · el `updated_at` que tenía el producto cuando se abrió el
  -- formulario. Null = no comprobar (la carga masiva).
  p_expected_updated_at timestamptz default null
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
  v_actual   products%rowtype;
  v_quien    text;
begin
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_CREAR_PRODUCTO' using errcode = '42501';
  end if;

  -- La función es `security definer`: corre sin RLS. Sin esta comprobación,
  -- cualquier usuario podría editar el producto de otro local pasando su id.
  -- El `for update` además bloquea la fila: dos ediciones simultáneas del
  -- mismo producto se ordenan en vez de pisarse a medias.
  select * into v_actual from products
   where id = p_product_id and tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  -- 0020 · RF-M10-03 / CP-06. Si alguien lo guardó mientras este formulario
  -- estaba abierto, no se pisa: se avisa quién, y la pantalla muestra lo
  -- actual. Antes el segundo en guardar borraba el cambio del primero sin que
  -- nadie se enterara (P-24, opción a).
  if p_expected_updated_at is not null and v_actual.updated_at <> p_expected_updated_at then
    select coalesce(nullif(full_name, ''), email, 'otra persona') into v_quien
      from profiles where id = v_actual.updated_by;
    raise exception 'PRODUCTO_CAMBIO_MIENTRAS_EDITABAS: %', coalesce(v_quien, 'otra persona')
      using errcode = 'P0001';
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

revoke execute on function public.fn_update_product(uuid, text, text, text, uuid, text, integer, integer, numeric, boolean, integer, text[], timestamptz) from public, anon;
grant  execute on function public.fn_update_product(uuid, text, text, text, uuid, text, integer, integer, numeric, boolean, integer, text[], timestamptz) to authenticated;
