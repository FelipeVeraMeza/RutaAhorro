-- ============================================================================
-- 0027 · El IVA de una factura sale del neto, como lo calcula el SII
--
-- Defecto de 0026 encontrado al preparar la prueba del robot (2026-09-28).
-- 0026 calculaba la factura como una boleta: el total es la suma de las
-- líneas con IVA y el IVA se EXTRAE de ese total. Pero en un DTE 33 el IVA es
-- el neto (un entero) por la tasa, redondeado, y el total es neto + IVA. El
-- portal del SII lo calcula él y no deja escribirlo. Con el neto entero, 1 de
-- cada 6 totales no existe en una factura: $22 con IVA es neto 18 → $21, o
-- neto 19 → $23. El robot, bien hecho, se negaba a firmar esas facturas (el
-- total del portal no era el de la base): habrían quedado en error para
-- siempre.
--
-- Ahora: el neto sale de la suma con IVA, como antes, y el IVA sale del neto.
-- El total puede quedar $1 por debajo o por encima de la suma de las líneas;
-- la pantalla lo muestra antes de emitir (`resumenFactura` de core, `ajuste`).
--
-- La nota de crédito no cambia: ya reparte en proporción a `facturas.total`,
-- y la nota total devuelve exactamente ese total.
-- ============================================================================

create or replace function public.fn_desglose_factura(p_lineas jsonb, p_iva numeric)
returns jsonb
language plpgsql immutable set search_path = public
as $$
declare
  v_des jsonb := fn_desglose_lineas(p_lineas, p_iva, 0);
  v_iva integer := round((v_des->>'neto')::integer * p_iva / 100)::integer;
begin
  return v_des || jsonb_build_object(
    'iva', v_iva,
    'total', (v_des->>'neto')::integer + v_iva + (v_des->>'adicionales')::integer);
end $$;
revoke execute on function public.fn_desglose_factura(jsonb, numeric) from public, anon, authenticated;

-- fn_emitir_factura_manual: igual que en 0026 salvo el desglose y el total.
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

-- create or replace conserva los privilegios de 0026; se repiten por si esta
-- migración se aplica sobre una base donde alguien los tocó.
revoke execute on function public.fn_emitir_factura_manual(jsonb) from public, anon;
grant  execute on function public.fn_emitir_factura_manual(jsonb) to authenticated;
