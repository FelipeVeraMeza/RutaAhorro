-- ============================================================================
-- 0038 · Revisión por rol, ronda 8 (docs/29): lo que la base todavía dejaba
--
-- Igual que 0037: las funciones conservan su firma (regla 21) y parten de su
-- última definición copiada tal cual, con el cambio mínimo marcado "0038".
--
--   · Desactivar a alguien no le cortaba los datos: con su sesión (el token
--     se renueva solo) seguía leyendo ventas, costos y clientes por la API y
--     escribiendo productos, categorías y proveedores. current_tenant_id()
--     vuelve null para una cuenta desactivada: todas las políticas dejan de
--     mostrarle filas. profiles_read le sigue mostrando su propio perfil, para
--     que la app le diga "tu cuenta está desactivada" y no "no vinculada".
--   · products: la política de UPDATE dejaba cambiar cualquier columna por la
--     API (costo, impuesto de otro local, perecible) sin las revisiones de
--     fn_update_product. Queda solo `is_active` (activar/desactivar, que la
--     app hace directo). Insertar va solo por fn_create_product (regla 14).
--   · product_barcodes: sin escritura directa (regla 14): la escriben las
--     funciones de producto.
--   · profiles: cada uno podía cambiarse el correo que muestran Usuarios y la
--     Bitácora. Solo se pueden escribir las columnas que la app usa; el
--     perfil lo crea handle_new_user (sin INSERT ni DELETE directos).
--   · stores / categories / suppliers / product_suppliers: la política "for
--     all" revisaba el rol al leer y editar, pero al insertar solo el local:
--     un vendedor creaba proveedores, categorías y tiendas. Crear proveedor
--     y categoría queda para admin, supervisor y bodega (Recibir mercadería
--     y Producto nuevo); tiendas, solo admin.
--   · fn_devolver_venta / fn_nota_credito_factura: devoluciones por unidad.
--   · fn_reintentar_factura / fn_descartar_factura: una factura que el SII
--     ya emitió (el worker no alcanzó a registrarla) no se reintenta ni se
--     descarta.
--   · fn_guardar_impuesto: tasa con hasta dos decimales y código SII positivo.
--   · v_adjustments: mismas columnas y una más al final, `movement_id`, para
--     que Reportes → Ajustes pagine con un orden que termine en algo único.
--   · fn_guardar_combo y fn_problema_tramo (ofertas por cantidad): por unidad.
--   · fn_create_product / fn_update_product: cuenta activa, categoría del
--     mismo local, cantidades enteras, códigos repetidos en la lista, y un
--     perecible con stock inicial necesita su vencimiento.
--
-- Antes de aplicarla: 0029 a 0037 aplicadas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Cuenta desactivada = sin datos
-- ---------------------------------------------------------------------------
-- Misma firma y mismo tipo (regla 21). Las funciones `security definer` ya
-- revisaban is_active_user(); las políticas RLS no.
create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select tenant_id from profiles where id = auth.uid() and is_active $$;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated
  using (tenant_id = current_tenant_id() or id = auth.uid());

-- ---------------------------------------------------------------------------
-- Escrituras directas que sobraban (reglas 6 y 14)
-- ---------------------------------------------------------------------------
drop policy if exists products_insert on products;
revoke insert, update on products from anon, authenticated;
-- La app activa y desactiva productos con un update directo
-- (repoSupabase.desactivar / reactivar). updated_at y updated_by los pone el
-- disparador: no necesitan permiso de columna.
grant update (is_active) on products to authenticated;

drop policy if exists barcodes_write on product_barcodes;
revoke insert, update, delete on product_barcodes from anon, authenticated;

drop policy if exists profiles_insert on profiles;
revoke insert, update, delete on profiles from anon, authenticated;
-- Lo que la app escribe: rol, activo, tope (Usuarios, solo el admin: lo
-- vigila fn_guard_profile_privileges) y la última actividad. El nombre lo
-- sigue pudiendo corregir cada uno. El correo y el local, no.
grant update (full_name, store_id, role, is_active, max_discount_pct, last_seen_at) on profiles to authenticated;

-- Las políticas "for all" de 0004 revisaban el rol en USING (leer, editar,
-- borrar) y solo el local en WITH CHECK, que es lo único que mira un INSERT:
-- cualquier rol —un vendedor— creaba proveedores, categorías, tiendas y
-- vínculos producto-proveedor por la API. Ahora WITH CHECK pide lo mismo.
drop policy if exists stores_write on stores;
create policy stores_write on stores for all to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() = 'admin')
  with check (tenant_id = current_tenant_id() and current_user_role() = 'admin');

drop policy if exists categories_write on categories;
create policy categories_write on categories for all to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() in ('admin','supervisor'))
  with check (tenant_id = current_tenant_id() and current_user_role() in ('admin','supervisor'));

drop policy if exists suppliers_write on suppliers;
create policy suppliers_write on suppliers for all to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() = 'admin')
  with check (tenant_id = current_tenant_id() and current_user_role() = 'admin');

drop policy if exists prod_sup_write on product_suppliers;
create policy prod_sup_write on product_suppliers for all to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() in ('admin','supervisor'))
  with check (tenant_id = current_tenant_id() and current_user_role() in ('admin','supervisor'));

-- Lo que sí tienen que poder crear: Recibir mercadería ofrece "+ Nuevo"
-- proveedor a supervisor y bodega, y Producto nuevo deja escribir una
-- categoría nueva a bodega (que crea productos). Crear, no editar ni borrar.
drop policy if exists suppliers_insert on suppliers;
create policy suppliers_insert on suppliers for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and coalesce(current_user_role()::text, '') in ('admin', 'supervisor', 'bodega'));
drop policy if exists categories_insert on categories;
create policy categories_insert on categories for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and coalesce(current_user_role()::text, '') in ('admin', 'supervisor', 'bodega'));

-- ---------------------------------------------------------------------------
-- fn_devolver_venta
-- ---------------------------------------------------------------------------
create or replace function public.fn_devolver_venta(
  p_sale_id uuid, p_items jsonb, p_motivo text, p_reembolso text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant    uuid := current_tenant_id();
  v_user      uuid := auth.uid();
  v_role      text := coalesce(current_user_role()::text, '');
  v_sale      sales%rowtype;
  v_ret       uuid;
  v_numero    bigint;
  v_it        record;
  v_pedido    jsonb;
  v_cant      numeric;
  v_ya        numeric;
  v_sumsub    numeric;
  v_devuelto  integer;
  v_monto     integer;
  v_total     integer := 0;
  v_lineas    jsonb := '[]'::jsonb;
  v_detalle   jsonb := '[]'::jsonb;
  v_es_total  boolean;
  v_ultimo    uuid;
  v_des       jsonb;
  v_iva       numeric;
  v_session   uuid;
  v_orig      dte_documentos%rowtype;
  v_nc        jsonb;
  v_rem       numeric;
  v_lote      record;
  v_toma      numeric;
  -- 0029
  v_fiado     integer := 0;
  v_cliente   uuid;
  v_saldo     integer;
  v_efectivo  integer;
begin
  if not is_active_user() or v_role not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_DEVOLVER' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_reembolso not in ('efectivo', 'transferencia', 'debito', 'credito', 'fiado') then
    raise exception 'REEMBOLSO_INVALIDO' using errcode = 'P0001';
  end if;

  select * into v_sale from sales where id = p_sale_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VENTA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  if v_sale.status = 'anulada' then raise exception 'VENTA_YA_ANULADA' using errcode = 'P0001'; end if;

  -- 0029 · Lo que se fió no se devuelve en plata: se rebaja de la cuenta. Y
  -- una venta pagada no se "devuelve a la cuenta" de nadie.
  select coalesce(sum(amount), 0) into v_fiado from sale_payments
   where sale_id = p_sale_id and method = 'fiado';
  if p_reembolso = 'fiado' and v_fiado = 0 then
    raise exception 'REEMBOLSO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_reembolso <> 'fiado' and v_fiado > 0 then
    raise exception 'VENTA_FIADA_REEMBOLSO_A_CUENTA' using errcode = 'P0001';
  end if;

  -- La plata en efectivo sale de la caja abierta de quien devuelve.
  if p_reembolso = 'efectivo' then
    select id into v_session from cash_sessions
     where user_id = v_user and status = 'abierta' limit 1 for share;
    if v_session is null then raise exception 'CAJA_NO_ABIERTA_DEVOLUCION' using errcode = 'P0001'; end if;
  end if;

  perform fn_lock_stock(v_tenant, v_sale.store_id, array(
    select product_id from sale_items where sale_id = p_sale_id));

  select coalesce(sum(subtotal), 0) into v_sumsub from sale_items where sale_id = p_sale_id;
  select coalesce(sum(monto), 0) into v_devuelto from sale_returns where sale_id = p_sale_id;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':devoluciones', 0));
  select coalesce(max(numero), 0) + 1 into v_numero from sale_returns where tenant_id = v_tenant;

  insert into sale_returns (tenant_id, store_id, sale_id, numero, motivo, reembolso, monto,
                            neto, iva, es_total, cash_session_id, created_by)
  values (v_tenant, v_sale.store_id, p_sale_id, v_numero, trim(p_motivo), p_reembolso, 0,
          0, 0, false, v_session, v_user)
  returning id into v_ret;

  -- Cada línea de la venta, con lo que ya se devolvió y lo que se pide ahora.
  for v_it in
    select si.*, coalesce((select sum(ri.cantidad) from sale_return_items ri where ri.sale_item_id = si.id), 0) as ya,
           p.tracks_expiry
      from sale_items si join products p on p.id = si.product_id
     where si.sale_id = p_sale_id
     order by si.id
  loop
    if p_items is null then
      v_cant := v_it.quantity - v_it.ya;
    else
      select sum((x->>'cantidad')::numeric) into v_cant
        from jsonb_array_elements(p_items) x where (x->>'sale_item_id')::uuid = v_it.id;
    end if;
    continue when coalesce(v_cant, 0) = 0;
    if v_cant < 0 or v_cant > v_it.quantity - v_it.ya then
      raise exception 'CANTIDAD_A_DEVOLVER_INVALIDA: %', v_it.product_name using errcode = 'P0001';
    end if;
    -- 0038 · Desde 0032 todo va por unidad: "1,5" devolvía media unidad al
    -- stock y la mitad de la plata (el disparador de 0032 mira sale_items y
    -- purchase_receipt_items, no las devoluciones).
    if v_cant <> trunc(v_cant) then
      raise exception 'CANTIDAD_ENTERA: %', v_it.product_name using errcode = 'P0001';
    end if;

    -- Lo que efectivamente se pagó por esas unidades (réplica de
    -- `montosDevolucion` en core: una sola división).
    v_monto := case when v_sumsub > 0
                    then round(v_cant * v_it.subtotal * v_sale.total / (v_it.quantity * v_sumsub))::integer
                    else 0 end;

    insert into sale_return_items (return_id, tenant_id, sale_item_id, product_id, cantidad, monto)
    values (v_ret, v_tenant, v_it.id, v_it.product_id, v_cant, v_monto)
    returning id into v_ultimo;
    v_total := v_total + v_monto;

    -- El stock vuelve a la sala, y a los lotes de donde salió (el que vence
    -- más tarde primero: es el que más sirve devolver a la repisa).
    if v_it.tracks_expiry then
      v_rem := v_cant;
      for v_lote in
        select sil.id, sil.lot_id, sil.quantity - sil.devuelto as disponible
          from sale_item_lots sil join product_lots pl on pl.id = sil.lot_id
         where sil.sale_item_id = v_it.id and sil.quantity > sil.devuelto
         order by pl.expiry_date desc
         for update of sil
      loop
        exit when v_rem <= 0;
        v_toma := least(v_rem, v_lote.disponible);
        update product_lots set quantity = quantity + v_toma where id = v_lote.lot_id;
        update sale_item_lots set devuelto = devuelto + v_toma where id = v_lote.id;
        v_rem := v_rem - v_toma;
      end loop;
    end if;
    perform fn_post_movement(v_tenant, v_sale.store_id, v_it.product_id, 'devolucion_venta',
                             v_cant, v_it.unit_cost, 'sale_return', v_ret, p_motivo, v_user);
  end loop;

  if v_ultimo is null then raise exception 'NADA_QUE_DEVOLVER' using errcode = 'P0001'; end if;

  -- ¿Se devolvió todo lo que quedaba? Entonces se devuelve exactamente lo que
  -- falta para el total cobrado: varias devoluciones nunca suman más.
  v_es_total := not exists (
    select 1 from sale_items si
     where si.sale_id = p_sale_id
       and si.quantity > coalesce((select sum(ri.cantidad) from sale_return_items ri where ri.sale_item_id = si.id), 0));
  if v_es_total then
    update sale_return_items set monto = monto + (v_sale.total - v_devuelto - v_total) where id = v_ultimo;
    v_total := v_sale.total - v_devuelto;
  end if;

  -- Impuestos de lo devuelto, por el mismo algoritmo de la venta.
  select jsonb_agg(jsonb_build_object('subtotal', ri.monto, 'tasa', si.impuesto_adicional_tasa,
                                      'nombre', si.impuesto_adicional_nombre, 'codigo', si.impuesto_adicional_codigo)),
         jsonb_agg(jsonb_build_object('nombre', si.product_name, 'cantidad', ri.cantidad,
                                      'precio', round(ri.monto / ri.cantidad)::integer, 'descuento', 0, 'monto', ri.monto,
                                      'codigo', si.impuesto_adicional_codigo, 'tasa', si.impuesto_adicional_tasa)
                   order by si.id)
    into v_lineas, v_detalle
    from sale_return_items ri join sale_items si on si.id = ri.sale_item_id
   where ri.return_id = v_ret;
  select coalesce((settings->>'iva_pct')::numeric, 19) into v_iva from tenants where id = v_tenant;
  v_des := fn_desglose_lineas(v_lineas, v_iva, 0);

  -- La fila se completa una sola vez, desde acá: el disparador solo lo
  -- permite para la devolución marcada en esta transacción.
  perform set_config('ra.devolucion', v_ret::text, true);
  update sale_returns
     set monto = v_total, neto = (v_des->>'neto')::integer, iva = (v_des->>'iva')::integer,
         impuestos_adicionales = (v_des->>'adicionales')::integer, es_total = v_es_total
   where id = v_ret;
  perform set_config('ra.devolucion', '', true);

  -- 0029 · RF-M5-28 · En efectivo se devuelve redondeado, como se cobra: no
  -- hay monedas de $1. Y si se devuelve la venta entera de una sola vez, lo
  -- que se pagó: una venta de $1.463 cobrada $1.460 no se devuelve $1.463.
  -- La nota de crédito sigue por el monto exacto.
  v_efectivo := case when v_es_total and v_devuelto = 0 and v_sale.ajuste_redondeo <> 0
                     then v_total + v_sale.ajuste_redondeo
                     else fn_redondeo_efectivo(v_total) end;
  if p_reembolso = 'efectivo' and v_efectivo > 0 then
    insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
    values (v_tenant, v_session, 'egreso', v_efectivo,
            'Devolución N° ' || v_numero || ' · venta folio ' || v_sale.folio || ' · ' || trim(p_motivo), v_user);
  end if;

  -- 0029 · Devuelto a la cuenta: rebaja la deuda, nunca por debajo de cero
  -- (si ya abonó, lo que sobra se le devuelve aparte, en plata).
  if p_reembolso = 'fiado' and v_total > 0 then
    select cliente_id into v_cliente from sales where id = p_sale_id;
    perform 1 from clientes where id = v_cliente for update;
    v_saldo := fn_saldo_cliente(v_cliente);
    if least(v_total, v_saldo) > 0 then
      insert into cuenta_cliente_movimientos (tenant_id, cliente_id, tipo, monto, sale_id,
                                              nota, created_by)
      values (v_tenant, v_cliente, 'devolucion', least(v_total, v_saldo), p_sale_id,
              'Devolución N° ' || v_numero || ' · ' || trim(p_motivo), v_user);
    end if;
  end if;

  -- La nota de crédito, si la venta tenía boleta o factura.
  select * into v_orig from dte_documentos
   where sale_id = p_sale_id and tipo in (33, 39) order by emitido_en limit 1;
  if found then
    v_nc := fn_emitir_dte(
      v_tenant, 61::smallint, p_sale_id, v_ret, v_orig.receptor, v_detalle, v_des, v_total, v_iva,
      jsonb_build_object('tipo', v_orig.tipo, 'folio', v_orig.folio, 'fecha', v_orig.fecha_emision,
                         'codigo', case when v_es_total and v_devuelto = 0 then 1 else 3 end,
                         'razon', left(trim(p_motivo), 90)),
      v_user);
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'devolucion', 'sales', p_sale_id,
          jsonb_build_object('devolucion', v_numero, 'monto', v_total, 'reembolso', p_reembolso,
                             'es_total', v_es_total, 'nota_credito', v_nc->'folio'));

  return jsonb_build_object('devolucion_id', v_ret, 'numero', v_numero, 'monto', v_total,
                            'efectivo_devuelto', case when p_reembolso = 'efectivo' then v_efectivo else 0 end,
                            'es_total', v_es_total, 'reembolso', p_reembolso, 'nota_credito', v_nc);
end $$;

-- ---------------------------------------------------------------------------
-- fn_nota_credito_factura
-- ---------------------------------------------------------------------------
create or replace function public.fn_nota_credito_factura(p_factura uuid, p_items jsonb, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_user     uuid := auth.uid();
  v_role     text := coalesce(current_user_role()::text, '');
  v_f        facturas%rowtype;
  v_l        record;
  v_cant     numeric;
  v_monto    integer;
  v_total    integer := 0;
  v_previo   integer;
  v_sumsub   numeric;
  v_ultima   integer := 0;
  v_items    jsonb := '[]'::jsonb;
  v_para_des jsonb := '[]'::jsonb;
  v_detalle  jsonb := '[]'::jsonb;
  v_es_total boolean;
  v_des      jsonb;
  v_orig     dte_documentos%rowtype;
  v_nc       jsonb;
  v_numero   bigint;
  v_nota     uuid;
  v_rem      numeric;
  v_lote     jsonb;
  v_ya       numeric;
  v_toma     numeric;
begin
  if not is_active_user() or v_role not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001'; end if;

  select * into v_f from facturas where id = p_factura and tenant_id = v_tenant for update;
  if not found then raise exception 'FACTURA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  -- Una factura que el SII todavía no emitió no se corrige con nota: se descarta.
  if v_f.estado <> 'emitida' then raise exception 'FACTURA_NO_EMITIDA' using errcode = 'P0001'; end if;

  perform fn_lock_stock(v_tenant, v_f.store_id, array(
    select product_id from factura_lineas where factura_id = p_factura and product_id is not null));
  select coalesce(sum(monto), 0) into v_sumsub from factura_lineas where factura_id = p_factura;
  select coalesce(sum(monto), 0) into v_previo from factura_notas_credito where factura_id = p_factura;

  for v_l in
    select l.*, p.tracks_expiry from factura_lineas l left join products p on p.id = l.product_id
     where l.factura_id = p_factura order by l.linea for update of l
  loop
    if p_items is null then
      v_cant := v_l.cantidad - v_l.devuelto;
    else
      select sum((x->>'cantidad')::numeric) into v_cant
        from jsonb_array_elements(p_items) x where (x->>'linea_id')::uuid = v_l.id;
    end if;
    continue when coalesce(v_cant, 0) = 0;
    if v_cant < 0 or v_cant > v_l.cantidad - v_l.devuelto then
      raise exception 'CANTIDAD_A_DEVOLVER_INVALIDA: %', v_l.nombre using errcode = 'P0001';
    end if;
    -- 0038 · Un producto vuelve por unidad (0032); una línea libre (un
    -- servicio) sí admite decimales.
    if v_l.product_id is not null and v_cant <> trunc(v_cant) then
      raise exception 'CANTIDAD_ENTERA: %', v_l.nombre using errcode = 'P0001';
    end if;
    v_monto := case when v_sumsub > 0
                    then round(v_cant * v_l.monto * v_f.total / (v_l.cantidad * v_sumsub))::integer else 0 end;
    update factura_lineas set devuelto = devuelto + v_cant where id = v_l.id;
    v_total := v_total + v_monto;
    v_ultima := jsonb_array_length(v_items);
    v_items := v_items || jsonb_build_object('linea_id', v_l.id, 'cantidad', v_cant, 'monto', v_monto,
                                             'tasa', v_l.tasa, 'nombre', v_l.nombre_adicional,
                                             'codigo', v_l.codigo_adicional, 'nombre_linea', v_l.nombre);

    if v_l.product_id is not null then
      -- A los lotes de donde salió, el que vence más tarde primero.
      if v_l.tracks_expiry then
        v_rem := v_cant;
        for v_lote in
          select x from jsonb_array_elements(v_l.lotes) x order by (x->>'expiry_date') desc
        loop
          exit when v_rem <= 0;
          -- Lo que ya volvió a ese lote en notas anteriores de esta línea.
          select coalesce(sum((y->>'cantidad')::numeric), 0) into v_ya
            from factura_notas_credito n, jsonb_array_elements(n.lineas) z,
                 jsonb_array_elements(coalesce(z->'lotes', '[]'::jsonb)) y
           where n.factura_id = p_factura and (z->>'linea_id')::uuid = v_l.id
             and y->>'lot_id' = v_lote->>'lot_id';
          v_toma := least(v_rem, (v_lote->>'quantity')::numeric - v_ya);
          continue when v_toma <= 0;
          update product_lots set quantity = quantity + v_toma where id = (v_lote->>'lot_id')::uuid;
          v_items := jsonb_set(v_items, array[v_ultima::text, 'lotes'],
                       coalesce(v_items->v_ultima->'lotes', '[]'::jsonb)
                       || jsonb_build_object('lot_id', v_lote->>'lot_id', 'cantidad', v_toma));
          v_rem := v_rem - v_toma;
        end loop;
      end if;
      perform fn_post_movement(v_tenant, v_f.store_id, v_l.product_id, 'devolucion_venta', v_cant,
                               v_l.unit_cost, 'factura_nc', p_factura, p_motivo, v_user);
    end if;
  end loop;

  if jsonb_array_length(v_items) = 0 then raise exception 'NADA_QUE_DEVOLVER' using errcode = 'P0001'; end if;

  -- Si se devolvió todo lo que quedaba, la suma de notas es exactamente el
  -- total de la factura: el redondeo va a la última línea.
  v_es_total := not exists (select 1 from factura_lineas where factura_id = p_factura and devuelto < cantidad);
  if v_es_total then
    v_items := jsonb_set(v_items, array[v_ultima::text, 'monto'],
                         to_jsonb((v_items->v_ultima->>'monto')::integer + (v_f.total - v_previo - v_total)));
    v_total := v_f.total - v_previo;
  end if;
  if v_total <= 0 then raise exception 'NADA_QUE_DEVOLVER' using errcode = 'P0001'; end if;

  select jsonb_agg(jsonb_build_object('subtotal', (x->>'monto')::integer, 'tasa', (x->>'tasa')::numeric,
                                      'nombre', x->>'nombre', 'codigo', (x->>'codigo')::integer)),
         jsonb_agg(jsonb_build_object('nombre', x->>'nombre_linea', 'cantidad', (x->>'cantidad')::numeric,
                                      'precio', round((x->>'monto')::numeric / (x->>'cantidad')::numeric)::integer,
                                      'descuento', 0, 'monto', (x->>'monto')::integer,
                                      'codigo', (x->>'codigo')::integer, 'tasa', (x->>'tasa')::numeric))
    into v_para_des, v_detalle
    from jsonb_array_elements(v_items) x;
  v_des := fn_desglose_lineas(v_para_des, v_f.iva_pct, 0);

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':factura_nc', 0));
  select coalesce(max(numero), 0) + 1 into v_numero from factura_notas_credito where tenant_id = v_tenant;

  select * into v_orig from dte_documentos where id = v_f.dte_id;
  -- Una factura emitida en el SII se corrige con una nota emitida en el SII:
  -- eso es el robot, todavía no. Mientras tanto no se registra una nota
  -- simulada contra un documento real.
  if v_orig.ambiente <> 'simulacion' then
    raise exception 'NOTA_CREDITO_REAL_NO_DISPONIBLE' using errcode = 'P0001';
  end if;
  v_nc := fn_emitir_dte(v_tenant, 61::smallint, null, null, v_f.receptor, v_detalle, v_des, v_total, v_f.iva_pct,
                        jsonb_build_object('tipo', 33, 'folio', v_orig.folio, 'fecha', v_orig.fecha_emision,
                                           'codigo', case when v_es_total and v_previo = 0 then 1 else 3 end,
                                           'razon', left(trim(p_motivo), 90)),
                        v_user);

  insert into factura_notas_credito (tenant_id, factura_id, numero, motivo, lineas, monto, neto, iva,
                                     impuestos_adicionales, es_total, dte_id, created_by)
  values (v_tenant, p_factura, v_numero, trim(p_motivo), v_items, v_total, (v_des->>'neto')::integer,
          (v_des->>'iva')::integer, (v_des->>'adicionales')::integer, v_es_total, (v_nc->>'id')::uuid, v_user)
  returning id into v_nota;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'nota_credito', 'facturas', p_factura,
          jsonb_build_object('numero', v_numero, 'monto', v_total, 'es_total', v_es_total, 'folio', v_nc->'folio'));

  return jsonb_build_object('nota_id', v_nota, 'numero', v_numero, 'monto', v_total,
                            'es_total', v_es_total, 'nota_credito', v_nc);
end $$;

-- ---------------------------------------------------------------------------
-- fn_create_product
-- ---------------------------------------------------------------------------
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
  p_initial_stock_sala numeric default 0,
  -- 0024 · Cuándo vence lo que se carga, si el producto es perecible. Con
  -- fecha, el stock inicial nace como un lote y entra en las alertas de
  -- vencimiento y en la venta por FEFO. Sin fecha, lo de antes.
  p_initial_expiry    date    default null
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
  v_codigos text[] := '{}';
begin
  -- 0038 · Con la cuenta desactivada se seguían creando productos.
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') or not is_active_user() then
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

  -- 0038 · Todo por unidad (0032): el stock inicial y el mínimo entraban con
  -- decimales por la API (la pantalla ya los rechazaba).
  if coalesce(p_initial_stock, 0) <> trunc(coalesce(p_initial_stock, 0))
     or coalesce(p_initial_stock_sala, 0) <> trunc(coalesce(p_initial_stock_sala, 0))
     or coalesce(p_min_stock, 0) <> trunc(coalesce(p_min_stock, 0)) then
    raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
  end if;
  if coalesce(p_min_stock, 0) < 0 then
    raise exception 'CANTIDAD_NEGATIVA' using errcode = 'P0001';
  end if;

  -- 0038 · Una categoría de otro local: la función corre sin RLS y el
  -- producto quedaba colgado de ella (y mostraba su nombre).
  if p_category_id is not null
     and not exists (select 1 from categories where id = p_category_id and tenant_id = v_tenant) then
    raise exception 'CATEGORIA_NO_ENCONTRADA' using errcode = 'P0001';
  end if;

  -- 0038 · Decisión 4 de 0032: un perecible con stock entra con su fecha.
  -- Sin ella quedaba stock sin lote: sin FEFO, sin aviso de vencimiento y
  -- descuadrado en la revisión semanal.
  if coalesce(p_tracks_expiry, false) and p_initial_expiry is null
     and (coalesce(p_initial_stock, 0) > 0 or coalesce(p_initial_stock_sala, 0) > 0) then
    raise exception 'VENCIMIENTO_REQUERIDO' using errcode = 'P0001';
  end if;

  -- 0024 · Mismo criterio que la recepción (RF-M4-15): no entra mercadería
  -- ya vencida.
  if p_initial_expiry is not null
     and p_initial_expiry < (now() at time zone fn_tenant_timezone(v_tenant))::date then
    raise exception 'VENCIMIENTO_PASADO' using errcode = 'P0001';
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

      -- 0038 · El mismo código dos veces en la lista reventaba en la
      -- restricción unique con el nombre de un índice. fn_update_product ya
      -- lo revisaba.
      if v_code = any(v_codigos) then
        raise exception 'CODIGO_EN_USO:%:%', v_code, trim(p_name) using errcode = 'P0001';
      end if;
      v_codigos := v_codigos || v_code;

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

    -- 0024 · El stock inicial de un perecible, como lote con su vencimiento.
    if coalesce(p_tracks_expiry, false) and p_initial_expiry is not null then
      insert into product_lots (tenant_id, store_id, product_id, lot_code, expiry_date, quantity, unit_cost)
      values (v_tenant, v_store, v_product, 'inicial', p_initial_expiry,
              coalesce(p_initial_stock, 0) + coalesce(p_initial_stock_sala, 0), coalesce(p_avg_cost, 0));
    end if;
  end if;

  return jsonb_build_object(
    'product_id',  v_product,
    'barcodes',    v_i,
    'stock',       coalesce(p_initial_stock, 0) + coalesce(p_initial_stock_sala, 0),
    'stock_bodega', coalesce(p_initial_stock, 0),
    'stock_sala',   coalesce(p_initial_stock_sala, 0)
  );
end $$;

-- ---------------------------------------------------------------------------
-- fn_update_product
-- ---------------------------------------------------------------------------
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
  -- 0038 · Con la cuenta desactivada se seguían editando productos.
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') or not is_active_user() then
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
  -- 0038 · Todo por unidad (0032).
  if coalesce(p_min_stock, 0) <> trunc(coalesce(p_min_stock, 0)) then
    raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
  end if;

  -- 0038 · Una categoría de otro local (la función corre sin RLS).
  if p_category_id is not null
     and not exists (select 1 from categories where id = p_category_id and tenant_id = v_tenant) then
    raise exception 'CATEGORIA_NO_ENCONTRADA' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- fn_guardar_combo
-- ---------------------------------------------------------------------------
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
  -- 0037 · Desactivar no revalida el combo. Si un producto del combo bajó de
  -- precio (el combo ya no sale más barato) o se desactivó, el combo no se
  -- podía apagar: "El combo tiene que costar menos…", y seguía aplicándose.
  if p_id is not null and (p_datos->>'activo') = 'false' then
    update combos set is_active = false, updated_at = now()
     where id = p_id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'COMBO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
    insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
    values (v_tenant, auth.uid(), 'desactivar', 'combo', v_id, p_datos);
    return v_id;
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
    -- 0038 · Todo por unidad (0032): "1,5 × Pan" no se puede vender, y el
    -- ahorro del combo se calculaba sobre media unidad.
    if v_cant <> trunc(v_cant) then raise exception 'CANTIDAD_ENTERA: %', v_prod.name using errcode = 'P0001'; end if;
    if v_prod.id = any(v_ids) then raise exception 'COMBO_PRODUCTO_REPETIDO' using errcode = 'P0001'; end if;
    v_ids := v_ids || v_prod.id;
    v_normal := v_normal + v_prod.sale_price * v_cant;
    v_prod := null;
  end loop;
  if cardinality(v_ids) < 2 then raise exception 'COMBO_UN_SOLO_PRODUCTO' using errcode = 'P0001'; end if;
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

-- ---------------------------------------------------------------------------
-- fn_problema_tramo (la usan fn_guardar_precios_producto y fn_aplicar_oferta_masiva)
-- ---------------------------------------------------------------------------
create or replace function public.fn_problema_tramo(p_t jsonb, p_precio_lista integer)
returns text
language plpgsql immutable set search_path = public
as $$
declare
  v_desde  numeric;
  v_precio numeric;
  v_pct    numeric;
  v_vd     date;
  v_vh     date;
begin
  if p_t is null or jsonb_typeof(p_t) <> 'object' then return 'TRAMO_INVALIDO'; end if;
  begin
    v_desde  := (p_t->>'desde')::numeric;
    v_precio := nullif(p_t->>'precio', '')::numeric;
    v_pct    := nullif(p_t->>'descuento_pct', '')::numeric;
    v_vd     := nullif(p_t->>'vigente_desde', '')::date;
    v_vh     := nullif(p_t->>'vigente_hasta', '')::date;
  exception when others then
    return 'TRAMO_INVALIDO';
  end;
  if v_desde is null or v_desde < 1 then return 'TRAMO_INVALIDO'; end if;
  -- 0038 · Por unidad (0032): "desde 2,5" se guardaba y se mostraba así.
  if v_desde <> trunc(v_desde) then return 'CANTIDAD_ENTERA'; end if;
  if (v_precio is null) = (v_pct is null) then return 'TRAMO_INVALIDO'; end if;
  if v_pct is not null then
    if v_pct <= 0 or v_pct >= 100 or v_pct <> round(v_pct, 2) then return 'PORCENTAJE_INVALIDO'; end if;
  else
    if v_precio <= 0 or v_precio <> trunc(v_precio) then return 'TRAMO_INVALIDO'; end if;
    if v_precio >= p_precio_lista then return 'OFERTA_NO_ES_MAS_BARATA'; end if;
  end if;
  if v_desde = 1 and v_vd is null and v_vh is null then return 'OFERTA_SIN_FECHAS_DESDE_1'; end if;
  if v_vd is not null and v_vh is not null and v_vh < v_vd then return 'FECHAS_INVERTIDAS'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- v_adjustments (regla 22: las mismas columnas de 0013, en el mismo orden, y
-- una nueva al final)
-- ---------------------------------------------------------------------------
create or replace view v_adjustments
with (security_invoker = true) as
select
  im.tenant_id,
  (im.created_at at time zone fn_tenant_timezone(im.tenant_id))::date as adj_date,
  im.movement_type,
  im.product_id,
  p.name as product_name,
  im.quantity,
  im.reason,
  round(im.quantity * im.unit_cost)::integer as value_impact,
  pr.full_name as created_by_name,
  im.id as movement_id
from inventory_movements im
left join products p on p.id = im.product_id
left join profiles pr on pr.id = im.created_by
where im.movement_type in ('ajuste_positivo','ajuste_negativo','merma','toma_inventario');
-- ---------------------------------------------------------------------------
-- fn_reintentar_factura
-- ---------------------------------------------------------------------------
create or replace function public.fn_reintentar_factura(p_factura uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  -- 0038 · "El SII emitió el folio N, pero no se pudo registrar" (lo escribe
  -- el worker) es una factura YA emitida: reintentarla emite otra con otro
  -- folio por la misma venta. La pantalla lo impide; la base también.
  if exists (select 1 from facturas where id = p_factura and tenant_id = v_tenant and estado = 'error'
               and ultimo_error like 'El SII emitió el folio %') then
    raise exception 'FACTURA_YA_EMITIDA_EN_SII' using errcode = 'P0001';
  end if;
  update facturas set estado = 'por_emitir', ultimo_error = null
   where id = p_factura and tenant_id = v_tenant and estado = 'error';
  if not found then raise exception 'FACTURA_NO_REINTENTABLE' using errcode = 'P0001'; end if;
  return fn_factura_resumen(p_factura);
end $$;

-- ---------------------------------------------------------------------------
-- fn_descartar_factura
-- ---------------------------------------------------------------------------
create or replace function public.fn_descartar_factura(p_factura uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_f      facturas%rowtype;
  v_l      record;
  v_lote   jsonb;
begin
  if not is_active_user() or coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001'; end if;
  select * into v_f from facturas where id = p_factura and tenant_id = v_tenant for update;
  if not found then raise exception 'FACTURA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  -- 'emitiendo' tampoco: el robot puede estar firmándola en este momento.
  if v_f.estado not in ('por_emitir', 'error') then
    raise exception 'FACTURA_NO_DESCARTABLE' using errcode = 'P0001';
  end if;
  -- 0038 · Ya emitida en el SII (ver fn_reintentar_factura): descartarla
  -- devolvía al stock mercadería que salió con una factura válida.
  if v_f.ultimo_error like 'El SII emitió el folio %' then
    raise exception 'FACTURA_YA_EMITIDA_EN_SII' using errcode = 'P0001';
  end if;
  perform fn_lock_stock(v_tenant, v_f.store_id, array(
    select product_id from factura_lineas where factura_id = p_factura and product_id is not null));
  for v_l in select * from factura_lineas where factura_id = p_factura and product_id is not null loop
    for v_lote in select * from jsonb_array_elements(v_l.lotes) loop
      update product_lots set quantity = quantity + (v_lote->>'quantity')::numeric
       where id = (v_lote->>'lot_id')::uuid;
    end loop;
    perform fn_post_movement(v_tenant, v_f.store_id, v_l.product_id, 'devolucion_venta', v_l.cantidad,
                             v_l.unit_cost, 'factura_descartada', p_factura, p_motivo, v_user);
  end loop;
  update facturas set estado = 'descartada', ultimo_error = trim(p_motivo) where id = p_factura;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'factura_descartada', 'facturas', p_factura,
          jsonb_build_object('numero', v_f.numero, 'motivo', trim(p_motivo)));
  return fn_factura_resumen(p_factura);
end $$;

-- ---------------------------------------------------------------------------
-- fn_guardar_impuesto
-- ---------------------------------------------------------------------------
create or replace function public.fn_guardar_impuesto(
  p_id uuid, p_nombre text, p_codigo_sii integer, p_tasa numeric, p_activo boolean default true
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_id     uuid;
  v_antes  impuestos_adicionales%rowtype;
begin
  if coalesce(current_user_role()::text, '') <> 'admin' or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if nullif(trim(p_nombre), '') is null then
    raise exception 'NOMBRE_IMPUESTO_REQUERIDO' using errcode = 'P0001';
  end if;
  -- 0038 · La columna guarda dos decimales: 18,555 quedaba en 18,56 sin aviso
  -- (y la pantalla decía "quedó en 18,555%"). Y un código SII negativo o cero
  -- no existe: salía así en la boleta.
  if p_tasa is null or p_tasa <= 0 or p_tasa >= 100 or p_tasa <> round(p_tasa, 2) then
    raise exception 'TASA_INVALIDA' using errcode = 'P0001';
  end if;
  if p_codigo_sii is not null and p_codigo_sii <= 0 then
    raise exception 'CODIGO_SII_INVALIDO' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into impuestos_adicionales (tenant_id, nombre, codigo_sii, tasa, is_active)
    values (v_tenant, trim(p_nombre), p_codigo_sii, p_tasa, coalesce(p_activo, true))
    returning id into v_id;
  else
    select * into v_antes from impuestos_adicionales
     where id = p_id and tenant_id = v_tenant for update;
    if not found then raise exception 'IMPUESTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
    update impuestos_adicionales
       set nombre = trim(p_nombre), codigo_sii = p_codigo_sii, tasa = p_tasa,
           is_active = coalesce(p_activo, true), updated_at = now()
     where id = p_id
    returning id into v_id;
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, auth.uid(), case when p_id is null then 'crear' else 'editar' end,
          'impuesto_adicional', v_id,
          case when p_id is null then null else to_jsonb(v_antes) end,
          jsonb_build_object('nombre', trim(p_nombre), 'codigo_sii', p_codigo_sii,
                             'tasa', p_tasa, 'activo', coalesce(p_activo, true)));
  return v_id;
exception when unique_violation then
  raise exception 'IMPUESTO_DUPLICADO' using errcode = 'P0001';
end $$;

