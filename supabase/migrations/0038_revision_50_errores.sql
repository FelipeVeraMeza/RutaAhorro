-- ============================================================================
-- 0038 · Revisión de 50 errores más (docs/29): lo que la 0037 no alcanzó
--
-- Todas las funciones conservan su firma (regla 21) y sus permisos
-- (`create or replace` no los toca). Cada una parte de su última definición,
-- copiada tal cual, con cambios mínimos marcados "0038".
--
-- Antes de aplicarla: 0029 a 0037 aplicadas, en orden.
-- ============================================================================

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
    -- 0038 · Desde 0032 todo se vende por unidad: devolver "0,5" de una
    -- bebida dejaba media unidad en el stock y en los lotes. (Lo que queda de
    -- una venta a granel anterior a 0032 se puede devolver entero.)
    if v_cant <> trunc(v_cant) and v_cant <> v_it.quantity - v_it.ya then
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
-- fn_emitir_factura_manual
-- ---------------------------------------------------------------------------
create or replace function public.fn_emitir_factura_manual(p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant    uuid := current_tenant_id();
  v_user      uuid := auth.uid();
  v_role      text := coalesce(current_user_role()::text, '');
  v_uuid      uuid := nullif(p_datos->>'client_uuid', '')::uuid;
  v_existe    facturas%rowtype;
  v_store     uuid;
  v_receptor  jsonb;
  v_cliente   uuid := nullif(p_datos->>'cliente_id', '')::uuid;
  v_forma     text := coalesce(nullif(p_datos->>'forma_pago', ''), 'contado');
  v_modo      text;
  v_id        uuid := gen_random_uuid();
  v_numero    bigint;
  v_l         jsonb;
  v_i         integer := 0;
  v_prod      products%rowtype;
  v_hay_prod  boolean;
  v_filas     jsonb := '[]'::jsonb;
  v_qty       numeric(14,3);
  v_precio    integer;
  v_desc      integer;
  v_monto     integer;
  v_nombre    text;
  v_tasa      numeric(5,2);
  v_imp_nom   text;
  v_imp_cod   integer;
  v_lotes     jsonb;
  v_total     integer := 0;
  v_para_des  jsonb := '[]'::jsonb;
  v_detalle   jsonb := '[]'::jsonb;
  v_iva       numeric;
  v_des       jsonb;
  v_dte       jsonb;
begin
  if not is_active_user() or v_role not in ('admin', 'supervisor') then
    raise exception 'SIN_PERMISO_FACTURAR' using errcode = '42501';
  end if;
  if v_uuid is null then raise exception 'FALTA_IDENTIFICADOR' using errcode = 'P0001'; end if;

  -- El doble toque espera al primero y recibe la misma factura.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':factura:' || v_uuid::text, 0));
  select * into v_existe from facturas where tenant_id = v_tenant and client_uuid = v_uuid;
  if found then
    return fn_factura_resumen(v_existe.id) || jsonb_build_object('ya_existia', true);
  end if;

  if v_forma not in ('contado', 'credito') then raise exception 'FORMA_PAGO_INVALIDA' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_datos->'lineas') is distinct from 'array' or jsonb_array_length(p_datos->'lineas') = 0 then
    raise exception 'FACTURA_SIN_LINEAS' using errcode = 'P0001';
  end if;
  -- El portal del SII admite 60 líneas por factura.
  if jsonb_array_length(p_datos->'lineas') > 60 then
    raise exception 'FACTURA_DEMASIADAS_LINEAS' using errcode = 'P0001';
  end if;
  v_receptor := fn_receptor_factura(p_datos->'receptor');

  if v_cliente is not null and not exists (
       select 1 from clientes where id = v_cliente and tenant_id = v_tenant and is_active) then
    raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001';
  end if;
  -- 0038 · Un cliente elegido con OTRO RUT que el del receptor no es este
  -- cliente: la factura quedaba ligada al equivocado (su cuenta, su ficha) y
  -- al de abajo se le "completaban" giro y dirección del receptor ajeno.
  if v_cliente is not null and exists (
       select 1 from clientes where id = v_cliente and rut is not null
          and regexp_replace(upper(rut), '[^0-9K]', '', 'g')
              <> regexp_replace(upper(coalesce(v_receptor->>'rut', '')), '[^0-9K]', '', 'g')) then
    v_cliente := null;
  end if;
  -- RQ-20, como la factura del POS: el receptor queda guardado como cliente,
  -- y a uno que ya existe se le completa lo que le falta, sin pisar nada.
  if v_cliente is null then
    select id into v_cliente from clientes where tenant_id = v_tenant and rut = v_receptor->>'rut';
  end if;
  if v_cliente is null then
    insert into clientes (tenant_id, rut, nombre, giro, direccion, comuna, email, created_by)
    values (v_tenant, v_receptor->>'rut', v_receptor->>'razon_social', v_receptor->>'giro',
            v_receptor->>'direccion', v_receptor->>'comuna', v_receptor->>'correo', v_user)
    on conflict (tenant_id, rut) where rut is not null do nothing
    returning id into v_cliente;
    if v_cliente is null then
      select id into v_cliente from clientes where tenant_id = v_tenant and rut = v_receptor->>'rut';
    end if;
  else
    update clientes
       set giro = coalesce(giro, v_receptor->>'giro'),
           direccion = coalesce(direccion, v_receptor->>'direccion'),
           comuna = coalesce(comuna, v_receptor->>'comuna'),
           email = coalesce(email, v_receptor->>'correo')
     where id = v_cliente;
  end if;

  select store_id into v_store from profiles where id = v_user;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant order by created_at limit 1;
  end if;

  -- Stock bloqueado de una vez y en orden (regla 15), antes de leerlo.
  perform fn_lock_stock(v_tenant, v_store, array(
    select (x->>'product_id')::uuid from jsonb_array_elements(p_datos->'lineas') x
     where nullif(x->>'product_id', '') is not null));

  v_modo := case when fn_emision_sii_activa(v_tenant) then 'portal_sii' else 'simulacion' end;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':facturas', 0));
  select coalesce(max(numero), 0) + 1 into v_numero from facturas where tenant_id = v_tenant;
  select coalesce((settings->>'iva_pct')::numeric, 19) into v_iva from tenants where id = v_tenant;

  -- Primero las líneas y el stock; la factura se inserta después, con sus
  -- montos finales: no se puede completar más tarde, es inmutable.
  for v_l in select * from jsonb_array_elements(p_datos->'lineas') loop
    v_i := v_i + 1;
    v_qty := (v_l->>'cantidad')::numeric;
    v_precio := (v_l->>'precio')::integer;
    v_desc := coalesce((v_l->>'descuento')::integer, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;
    if v_precio is null or v_precio < 0 or v_desc < 0 then raise exception 'MONTO_NEGATIVO' using errcode = 'P0001'; end if;
    v_monto := round(v_qty * v_precio)::integer - v_desc;
    if v_monto < 0 then raise exception 'DESCUENTO_MAYOR_QUE_LINEA' using errcode = 'P0001'; end if;
    v_tasa := 0; v_imp_nom := null; v_imp_cod := null; v_lotes := '[]'::jsonb;
    v_hay_prod := nullif(v_l->>'product_id', '') is not null;

    if v_hay_prod then
      select * into v_prod from products where id = (v_l->>'product_id')::uuid and tenant_id = v_tenant;
      if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
      if not v_prod.is_active then raise exception 'PRODUCTO_INACTIVO: %', v_prod.name using errcode = 'P0001'; end if;
      -- Lo mismo que el POS: lo que se cuenta, entero (kg, gramo, litro y ml
      -- admiten decimales). Acá la base sí lo exige: es un documento tributario.
      if v_prod.unit not in ('kg', 'gramo', 'litro', 'ml') and v_qty <> trunc(v_qty) then
        raise exception 'CANTIDAD_ENTERA: %', v_prod.name using errcode = 'P0001';
      end if;
      v_nombre := v_prod.name;
      if v_prod.impuesto_adicional_id is not null then
        select tasa, nombre, codigo_sii into v_tasa, v_imp_nom, v_imp_cod
          from impuestos_adicionales where id = v_prod.impuesto_adicional_id and is_active;
        v_tasa := coalesce(v_tasa, 0);
        if v_tasa = 0 then v_imp_nom := null; v_imp_cod := null; end if;
      end if;
      -- Sale de la sala, como una venta (admin y supervisor pueden dejarla en
      -- negativo, igual que en el POS: queda la alerta).
      if v_prod.tracks_expiry then
        v_lotes := coalesce(fn_consume_lots(v_tenant, v_store, v_prod.id, v_qty, null), '[]'::jsonb);
      end if;
      perform fn_post_movement(v_tenant, v_store, v_prod.id, 'venta', -v_qty, v_prod.avg_cost,
                               'factura', v_id, 'Factura N° ' || v_numero, v_user);
    else
      v_nombre := nullif(left(trim(coalesce(v_l->>'nombre', '')), 80), '');
      if v_nombre is null then raise exception 'LINEA_SIN_NOMBRE' using errcode = 'P0001'; end if;
    end if;

    v_filas := v_filas || jsonb_build_object(
      'linea', v_i,
      'product_id', case when v_hay_prod then v_prod.id end,
      'nombre', v_nombre,
      'descripcion', nullif(left(trim(coalesce(v_l->>'descripcion', '')), 1000), ''),
      'unidad', case when v_hay_prod then v_prod.unit
                     else nullif(left(trim(coalesce(v_l->>'unidad', '')), 4), '') end,
      'cantidad', v_qty, 'precio', v_precio, 'descuento', v_desc, 'monto', v_monto,
      'precio_lista', case when v_hay_prod then v_prod.sale_price end,
      'unit_cost', case when v_hay_prod then v_prod.avg_cost else 0 end,
      'tasa', v_tasa, 'nombre_adicional', v_imp_nom, 'codigo_adicional', v_imp_cod, 'lotes', v_lotes);
    v_total := v_total + v_monto;
    v_para_des := v_para_des || jsonb_build_object('subtotal', v_monto, 'tasa', v_tasa,
                                                   'nombre', v_imp_nom, 'codigo', v_imp_cod);
    v_detalle := v_detalle || jsonb_build_object('nombre', v_nombre, 'cantidad', v_qty, 'precio', v_precio,
                                                 'descuento', v_desc, 'monto', v_monto,
                                                 'codigo', v_imp_cod, 'tasa', v_tasa);
  end loop;

  if v_total <= 0 then raise exception 'FACTURA_EN_CERO' using errcode = 'P0001'; end if;
  -- 0027: el IVA sale del neto; el total puede moverse $1 respecto de la suma.
  v_des := fn_desglose_factura(v_para_des, v_iva);
  v_total := (v_des->>'total')::integer;

  insert into facturas (id, tenant_id, store_id, numero, client_uuid, modo, estado, cliente_id, receptor,
                        forma_pago, fecha_emision, observaciones, neto, iva, iva_pct,
                        impuestos_adicionales, impuestos_detalle, total, created_by)
  values (v_id, v_tenant, v_store, v_numero, v_uuid, v_modo, 'por_emitir', v_cliente, v_receptor, v_forma,
          (now() at time zone fn_tenant_timezone(v_tenant))::date,
          nullif(left(trim(coalesce(p_datos->>'observaciones', '')), 500), ''),
          (v_des->>'neto')::integer, (v_des->>'iva')::integer, v_iva,
          (v_des->>'adicionales')::integer, coalesce(v_des->'detalle', '[]'::jsonb), v_total, v_user);

  insert into factura_lineas (factura_id, tenant_id, linea, product_id, nombre, descripcion, unidad,
                              cantidad, precio, descuento, monto, precio_lista, unit_cost,
                              tasa, nombre_adicional, codigo_adicional, lotes)
  select v_id, v_tenant, (x->>'linea')::smallint, nullif(x->>'product_id', '')::uuid, x->>'nombre',
         x->>'descripcion', x->>'unidad', (x->>'cantidad')::numeric, (x->>'precio')::integer,
         (x->>'descuento')::integer, (x->>'monto')::integer, (x->>'precio_lista')::integer,
         (x->>'unit_cost')::integer, (x->>'tasa')::numeric, x->>'nombre_adicional',
         (x->>'codigo_adicional')::integer, x->'lotes'
    from jsonb_array_elements(v_filas) x;

  -- Simulación: el documento 33 de 0019, en esta misma transacción.
  if v_modo = 'simulacion' then
    v_dte := fn_emitir_dte(v_tenant, 33::smallint, null, null, v_receptor, v_detalle, v_des,
                           v_total, v_iva, null, v_user);
    update facturas set estado = 'emitida', dte_id = (v_dte->>'id')::uuid,
                        folio = (v_dte->>'folio')::bigint, emitida_en = now()
     where id = v_id;
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'factura_manual', 'facturas', v_id,
          jsonb_build_object('numero', v_numero, 'total', v_total, 'modo', v_modo,
                             'receptor', v_receptor->>'rut', 'folio', v_dte->'folio'));

  return fn_factura_resumen(v_id) || jsonb_build_object('ya_existia', false);
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
begin
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_CREAR_PRODUCTO' using errcode = '42501';
  end if;

  -- 0038 · Una cuenta desactivada con la sesión abierta seguía creando y
  -- editando productos (y sus precios): la 0037 cerró la caja y el stock,
  -- esto quedó afuera.
  if not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  -- 0038 · La categoría tiene que ser de este local: con el id de una ajena
  -- el producto quedaba colgando de la categoría de otro local.
  if p_category_id is not null and not exists (
       select 1 from categories where id = p_category_id and tenant_id = v_tenant) then
    raise exception 'CATEGORIA_NO_ENCONTRADA' using errcode = 'P0001';
  end if;
  -- 0038 · Desde 0032 todo se cuenta por unidad: un mínimo de 2,5 nunca se
  -- cumplía ni se avisaba bien.
  if p_min_stock is not null and p_min_stock <> trunc(p_min_stock) then
    raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
  end if;
  if coalesce(p_initial_stock, 0) <> trunc(coalesce(p_initial_stock, 0))
     or coalesce(p_initial_stock_sala, 0) <> trunc(coalesce(p_initial_stock_sala, 0)) then
    raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
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
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_CREAR_PRODUCTO' using errcode = '42501';
  end if;

  -- 0038 · Una cuenta desactivada con la sesión abierta seguía creando y
  -- editando productos (y sus precios): la 0037 cerró la caja y el stock,
  -- esto quedó afuera.
  if not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  -- 0038 · La categoría tiene que ser de este local: con el id de una ajena
  -- el producto quedaba colgando de la categoría de otro local.
  if p_category_id is not null and not exists (
       select 1 from categories where id = p_category_id and tenant_id = v_tenant) then
    raise exception 'CATEGORIA_NO_ENCONTRADA' using errcode = 'P0001';
  end if;
  -- 0038 · Desde 0032 todo se cuenta por unidad: un mínimo de 2,5 nunca se
  -- cumplía ni se avisaba bien.
  if p_min_stock is not null and p_min_stock <> trunc(p_min_stock) then
    raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
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
  -- 0038 · El robot deja este error cuando el SII YA emitió el folio y solo
  -- falló anotarlo acá (worker, facturas-sii). Descartarla devolvía el stock
  -- de una venta que sí existe ante el SII: se registra a mano, no se descarta.
  if v_f.estado = 'error' and coalesce(v_f.ultimo_error, '') ~* 'emiti[óo] el folio' then
    raise exception 'FACTURA_EMITIDA_EN_SII' using errcode = 'P0001';
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
-- current_tenant_id — una cuenta desactivada ya no es de ningún local
-- ---------------------------------------------------------------------------
-- Todas las políticas RLS dicen `tenant_id = current_tenant_id()` y algunas
-- miran el rol, pero NINGUNA miraba si la cuenta sigue activa. Desactivar a
-- alguien cerraba las funciones (0037) y las pantallas, no las tablas: con la
-- sesión abierta (el token dura hasta una hora y se renueva solo) seguía
-- leyendo ventas, costos y clientes, y escribiendo directo en productos,
-- códigos de barra y categorías con la llave pública.
--
-- Con esto, para una cuenta inactiva no hay local: toda política la deja
-- fuera, y toda función que parte de `current_tenant_id()` recibe null (las
-- que escriben ya respondían NO_AUTENTICADO con eso). Misma firma (regla 21);
-- `create or replace` conserva los permisos.
create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select tenant_id from profiles where id = auth.uid() and is_active $$;

-- Su propio perfil sí lo lee: es lo que permite mostrarle "Tu cuenta está
-- desactivada" (y no "no está vinculada a ningún local") y dejarlo salir.
drop policy if exists profiles_read_self on profiles;
create policy profiles_read_self on profiles for select to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Políticas "for all": el rol se miraba al leer, cambiar y borrar, no al crear
-- ---------------------------------------------------------------------------
-- En 0004 cinco políticas "for all" ponían el rol solo en `using`, y en un
-- INSERT PostgreSQL mira únicamente `with check`, que pedía solo el local. Un
-- vendedor, con la llave pública, podía crear categorías, códigos de barra
-- (para cualquier producto), proveedores, vínculos producto–proveedor y hasta
-- locales nuevos, aunque ninguna pantalla se lo ofrezca. Cada `with check`
-- pasa a pedir los mismos roles que ya pedía `using`, y a los roles que hoy
-- crean desde la app sin estar en `using` se les deja crear (solo crear):
--   · bodega crea categorías (Productos e Importar ofrecen "categoría nueva");
--   · bodega y supervisor crean proveedores ("+ Nuevo" en Recibir mercadería).
drop policy if exists stores_write on stores;
create policy stores_write on stores for all to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() = 'admin')
  with check (tenant_id = current_tenant_id() and current_user_role() = 'admin');

drop policy if exists categories_write on categories;
create policy categories_write on categories for all to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor'))
  with check (tenant_id = current_tenant_id()
              and current_user_role() in ('admin','supervisor'));
drop policy if exists categories_insert_bodega on categories;
create policy categories_insert_bodega on categories for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and coalesce(current_user_role()::text, '') = 'bodega');

drop policy if exists barcodes_write on product_barcodes;
create policy barcodes_write on product_barcodes for all to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'))
  with check (tenant_id = current_tenant_id()
              and current_user_role() in ('admin','supervisor','bodega'));

drop policy if exists suppliers_write on suppliers;
create policy suppliers_write on suppliers for all to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() = 'admin')
  with check (tenant_id = current_tenant_id() and current_user_role() = 'admin');
drop policy if exists suppliers_insert_recepcion on suppliers;
create policy suppliers_insert_recepcion on suppliers for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and coalesce(current_user_role()::text, '') in ('supervisor','bodega'));

drop policy if exists prod_sup_write on product_suppliers;
create policy prod_sup_write on product_suppliers for all to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor'))
  with check (tenant_id = current_tenant_id()
              and current_user_role() in ('admin','supervisor'));

-- ---------------------------------------------------------------------------
-- alerts — marcar como visto, no reescribir el aviso
-- ---------------------------------------------------------------------------
-- La política de UPDATE (0004) deja a admin y supervisor tocar cualquier
-- columna: un supervisor podía cambiar el texto, el tipo o la gravedad de un
-- aviso del worker (un descuadre de lotes pasaba a "info" con otro producto)
-- o anotar que lo vio otra persona. Lo único que se cambia desde la app es si
-- se vio, cuándo y quién, y "quién" es uno mismo.
create or replace function public.fn_guard_alert_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- El worker escribe con service_role: sin usuario no hay nada que vigilar.
  if auth.uid() is null then
    return new;
  end if;
  if new.tenant_id  is distinct from old.tenant_id
  or new.type       is distinct from old.type
  or new.severity   is distinct from old.severity
  or new.payload    is distinct from old.payload
  or new.created_at is distinct from old.created_at
  or (new.read_by is distinct from old.read_by and new.read_by is distinct from auth.uid()) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_alert_update on alerts;
create trigger trg_guard_alert_update
  before update on alerts
  for each row execute function public.fn_guard_alert_update();
