-- =============================================================================
-- 0039 · Factura desde la caja con RUT, correo y forma de pago
-- =============================================================================
-- Felipe, 2026-10-11: "debería haber un RUT de cliente ya registrado y solo
-- debería pedirme el RUT y correo, nada más", con la forma de pago (contado,
-- crédito, sin costo) en un desplegable.
--
-- La razón social, el giro y la dirección los completa el SII al validar el
-- RUT en el portal (el robot los lee: portal.ts, receptorDelSii), o salen del
-- cliente ya registrado. Por eso fn_register_sale deja de exigir la razón
-- social (RAZON_SOCIAL_REQUERIDA) y guarda el correo y la forma de pago.
--
-- Igual que 0036 salvo lo marcado con "0039".
-- =============================================================================

alter table sales add column if not exists receptor_correo text;
alter table sales add column if not exists receptor_forma_pago text;
do $$ begin
  alter table sales add constraint sales_receptor_forma_pago_check
    check (receptor_forma_pago in ('contado', 'credito', 'sin_costo'));
exception when duplicate_object then null;
end $$;

-- 0015 exigía razón social en toda factura; ahora basta el RUT.
alter table sales drop constraint if exists sales_factura_con_receptor;
alter table sales add constraint sales_factura_con_receptor
  check (document_type <> 'factura' or receptor_rut is not null);

create or replace function public.fn_register_sale(
  p_client_uuid    uuid,
  p_items          jsonb,
  p_payments       jsonb,
  p_sold_at        timestamptz default now(),
  p_discount_total integer   default 0,
  p_notes          text      default null,
  p_force          boolean   default false,
  -- {tipo, rut, razon_social?, giro?, direccion?, correo?, forma_pago?}. Null = el que corresponda al
  -- medio de pago. Una venta que viene de la cola sin conexion tampoco lo trae.
  p_document       jsonb     default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant    uuid := current_tenant_id();
  v_user      uuid := auth.uid();
  v_role      user_role := current_user_role();
  v_store     uuid;
  v_session   uuid;
  v_sale      uuid;
  v_folio     bigint;
  v_item      jsonb;
  v_pay       jsonb;
  v_product   products%rowtype;
  v_item_id   uuid;
  v_qty       numeric(14,3);
  v_price     integer;
  v_disc      integer;
  v_subtotal  integer;
  v_sum       integer := 0;
  v_bruto     integer := 0;
  v_desc      integer := 0;
  v_tope      numeric;
  v_paid      integer := 0;
  v_change    integer := 0;
  v_stock     numeric(14,3);
  v_iva       numeric;
  v_existing  sales%rowtype;
  v_doc       document_type;
  v_tarjeta   boolean;
  v_maquina   boolean;
  v_rut       text;
  v_razon     text;
  v_sin_stock boolean;
  -- 0018
  v_momento   timestamptz := coalesce(p_sold_at, now());
  v_dia       date;
  v_lista     integer;
  v_entonces  integer;
  v_ref       integer;
  v_bruto_ref integer := 0;
  v_implicito integer := 0;
  v_tasa      numeric(5,2);
  v_imp_nom   text;
  v_imp_cod   integer;
  v_des       jsonb;
  v_dte       jsonb;
  -- 0021
  v_ofertas_hoy      boolean;
  v_ofertas_entonces boolean;
  -- 0022
  v_cliente          uuid;
  v_cli              integer;
  -- 0023
  v_lineas           jsonb := '[]'::jsonb;
  v_combos           jsonb := '{"total": 0, "aplicados": []}'::jsonb;
  v_desc_combos      integer := 0;
  -- 0029
  v_redondeo         integer := 0;
  v_fiado            integer := 0;
  v_tope_credito     integer;
  v_saldo            integer;
  -- 0036
  v_aut              autorizaciones_descuento%rowtype;
  -- 0039
  v_correo           text;
  v_forma            text;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;

  -- (1) CP-03b. Dos envíos de la misma venta se esperan uno al otro acá. Sin
  -- esto, el segundo no ve al primero (todavía no confirma), sigue de largo y
  -- choca contra el índice único al insertar.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || p_client_uuid::text, 0));

  select * into v_existing from sales
   where tenant_id = v_tenant and client_uuid = p_client_uuid;
  if found then
    -- 0019 · El reenvío recibe el mismo documento, no uno nuevo.
    return jsonb_build_object(
      'sale_id', v_existing.id, 'folio', v_existing.folio,
      'total', v_existing.total, 'change_amount', 0,
      'sold_at', v_existing.sold_at, 'synced_at', v_existing.synced_at,
      'already_existed', true, 'document_type', v_existing.document_type,
      'ajuste_redondeo', v_existing.ajuste_redondeo,
      'dte', (select fn_dte_resumen(d.id) from dte_documentos d
               where d.sale_id = v_existing.id and d.tipo in (33, 39) limit 1));
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'VENTA_VACIA' using errcode = 'P0001';
  end if;

  -- 0015 - Que documento corresponde. Se decide antes de tocar nada: una venta
  -- con los datos del receptor mal puestos no debe dejar stock movido.
  v_tarjeta := exists (select 1 from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) x
                        where x->>'method' in ('debito','credito'));
  select coalesce((settings->>'tarjeta_emite_documento')::boolean, true)
    into v_maquina from tenants where id = v_tenant;
  v_maquina := coalesce(v_maquina, true) and v_tarjeta;
  select coalesce((settings->>'vender_sin_stock')::boolean, false)
    into v_sin_stock from tenants where id = v_tenant;
  v_sin_stock := coalesce(v_sin_stock, false);

  v_doc := nullif(p_document->>'tipo','')::document_type;
  if v_doc is null then
    v_doc := case when v_maquina then 'voucher' else 'boleta' end::document_type;
  end if;
  if v_doc = 'boleta' and v_maquina then
    raise exception 'DOCUMENTO_LO_EMITE_LA_MAQUINA' using errcode = 'P0001';
  end if;
  if v_doc = 'voucher' and not v_maquina then
    raise exception 'VOUCHER_SIN_TARJETA' using errcode = 'P0001';
  end if;
  if v_doc = 'factura' then
    -- 0039 · La razón social ya no se exige: es la del cliente registrado o,
    -- si es nuevo, la pone el SII al validar el RUT en el portal.
    v_razon := nullif(trim(p_document->>'razon_social'), '');
    v_rut := fn_rut_formateado(p_document->>'rut');
    if v_rut is null then
      raise exception 'RUT_INVALIDO' using errcode = 'P0001';
    end if;
    -- El correo lo exige la caja, no la base: una venta hecha sin conexión con
    -- la versión anterior no lo trae, y rechazarla deja la plata en el cajón
    -- sin venta. Uno mal escrito se descarta.
    v_correo := lower(nullif(left(trim(coalesce(p_document->>'correo', '')), 80), ''));
    if v_correo !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
      v_correo := null;
    end if;
    v_forma := coalesce(nullif(p_document->>'forma_pago', ''), 'contado');
    if v_forma not in ('contado', 'credito', 'sin_costo') then
      raise exception 'FORMA_PAGO_INVALIDA' using errcode = 'P0001';
    end if;
  else
    v_rut := null; v_razon := null; v_correo := null; v_forma := null;
  end if;

  -- 0022 · El cliente. Uno que no es del local, o que está desactivado, no
  -- vende a su precio: se rechaza en vez de cobrar a precio normal sin avisar.
  v_cliente := nullif(p_document->>'cliente_id', '')::uuid;
  if v_cliente is not null and not exists (
       select 1 from clientes where id = v_cliente and tenant_id = v_tenant and is_active) then
    raise exception 'CLIENTE_NO_ENCONTRADO' using errcode = 'P0001';
  end if;
  -- RQ-20 · La factura deja al receptor guardado para la próxima vez. Se
  -- completan los datos que falten; los que ya están no se pisan.
  if v_doc = 'factura' then
    if v_cliente is null then
      select id into v_cliente from clientes where tenant_id = v_tenant and rut = v_rut;
    end if;
    if v_cliente is null then
      -- 0039 · Un cliente nuevo sin razón social queda con su RUT como nombre
      -- hasta que se corrija (la que pone el SII sale impresa en la factura).
      insert into clientes (tenant_id, rut, nombre, giro, direccion, email, created_by)
      values (v_tenant, v_rut, coalesce(v_razon, v_rut), nullif(trim(p_document->>'giro'), ''),
              nullif(trim(p_document->>'direccion'), ''), v_correo, v_user)
      on conflict (tenant_id, rut) where rut is not null do nothing
      returning id into v_cliente;
      -- Otra caja lo creó en el mismo instante.
      if v_cliente is null then
        select id into v_cliente from clientes where tenant_id = v_tenant and rut = v_rut;
      end if;
    else
      update clientes
         set giro      = coalesce(giro, nullif(trim(p_document->>'giro'), '')),
             direccion = coalesce(direccion, nullif(trim(p_document->>'direccion'), '')),
             email     = coalesce(email, v_correo)
       where id = v_cliente;
    end if;
    -- 0039 · Sin razón social en la caja: la del cliente registrado (no su RUT).
    if v_razon is null then
      select nullif(nombre, v_rut) into v_razon from clientes where id = v_cliente;
    end if;
  end if;

  -- 0029 · RF-M5-30 · Fiado: solo a un cliente identificado y hasta su tope.
  -- La fila del cliente se bloquea: dos cajas fiándole a la vez no pasan las
  -- dos el tope mirando el mismo saldo.
  select coalesce(sum((x->>'amount')::integer), 0) into v_fiado
    from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) x where x->>'method' = 'fiado';
  if v_fiado > 0 then
    if v_cliente is null then
      raise exception 'FIADO_SIN_CLIENTE' using errcode = 'P0001';
    end if;
    select credito_tope into v_tope_credito from clientes where id = v_cliente for update;
    v_saldo := fn_saldo_cliente(v_cliente);
    if v_saldo + v_fiado > coalesce(v_tope_credito, 0) then
      raise exception 'FIADO_EXCEDE_TOPE' using errcode = 'P0001';
    end if;
  end if;

  -- (2) CP-07. `for share`: varias ventas de la misma caja no se esperan entre
  -- sí, pero el cierre (que pide `for update`) espera a que terminen, y una
  -- venta que llega con el cierre en curso espera al cierre y después ya no
  -- encuentra la caja abierta.
  select id, store_id into v_session, v_store
    from cash_sessions where user_id = v_user and status = 'abierta'
   limit 1
     for share;
  if v_session is null then
    raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
  end if;

  v_folio := fn_next_folio(v_tenant);

  -- 0018 · El día del local en que se vendió, para las ofertas con fecha.
  v_dia := (v_momento at time zone fn_tenant_timezone(v_tenant))::date;
  -- 0021 · ¿Rigen las ofertas hoy, y regían cuando se vendió?
  v_ofertas_hoy      := fn_ofertas_rigen(v_tenant, now());
  v_ofertas_entonces := fn_ofertas_rigen(v_tenant, v_momento);

  -- (3) Stock bloqueado de una vez y en orden, antes de leerlo.
  perform fn_lock_stock(v_tenant, v_store, array(
    select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x));

  insert into sales (tenant_id, store_id, folio, cash_session_id, sold_by,
                     sold_at, synced_at, client_uuid, notes, discount_total,
                     document_type, receptor_rut, receptor_razon_social,
                     receptor_giro, receptor_direccion, cliente_id,
                     receptor_correo, receptor_forma_pago)
  values (v_tenant, v_store, v_folio, v_session, v_user,
          coalesce(p_sold_at, now()), now(), p_client_uuid, p_notes,
          coalesce(p_discount_total,0),
          v_doc, v_rut, v_razon,
          nullif(trim(p_document->>'giro'), ''),
          nullif(trim(p_document->>'direccion'), ''), v_cliente,
          v_correo, v_forma)
  returning id into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from products
     where id = (v_item->>'product_id')::uuid and tenant_id = v_tenant;
    if not found then
      raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001';
    end if;
    if not v_product.is_active then
      raise exception 'PRODUCTO_INACTIVO: %', v_product.name using errcode = 'P0001';
    end if;

    v_qty   := (v_item->>'quantity')::numeric;

    -- 0018 · El precio que corresponde a esta cantidad, hoy y a la hora de la
    -- venta (una venta sin conexión llega con el precio que tenía). Se toma
    -- el menor. La hora de la venta la manda el dispositivo: más de 7 días
    -- atrás no se le cree.
    v_lista := case when v_ofertas_hoy
                    then fn_precio_por_cantidad(v_product.id, v_product.sale_price, v_qty, v_dia)
                    else v_product.sale_price end;
    if v_momento >= now() - interval '7 days' then
      v_entonces := fn_precio_base_en(v_product.id, v_product.sale_price, v_momento);
      if v_ofertas_entonces then
        v_entonces := fn_precio_por_cantidad(v_product.id, v_entonces, v_qty, v_dia);
      end if;
    else
      v_entonces := v_lista;
    end if;
    -- 0022 · El precio del cliente, si tiene uno y es menor. No se suma a la
    -- oferta: gana el más barato.
    if v_cliente is not null then
      v_cli := fn_precio_cliente(v_cliente, v_product.id, v_product.sale_price);
      if v_cli is not null then
        v_lista := least(v_lista, v_cli);
      end if;
    end if;
    v_ref := least(v_lista, v_entonces);
    -- 0023 · Para medir los combos contra lo que corresponde a cada línea.
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id, 'cantidad', v_qty, 'precio', v_ref));

    v_price := coalesce((v_item->>'unit_price')::integer, v_lista);
    v_disc  := coalesce((v_item->>'discount_amount')::integer, 0);
    if v_disc < 0 or v_price < 0 then
      raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
    end if;
    -- T-14 · Cobrar menos de lo que corresponde es un descuento, y pasa por el
    -- mismo tope que los descuentos declarados.
    v_implicito := v_implicito + greatest(round(v_qty * v_ref)::integer - round(v_qty * v_price)::integer, 0);
    v_bruto_ref := v_bruto_ref + round(v_qty * v_ref)::integer;

    -- 0018 · El impuesto adicional se congela en la línea.
    v_tasa := 0; v_imp_nom := null; v_imp_cod := null;
    if v_product.impuesto_adicional_id is not null then
      select tasa, nombre, codigo_sii into v_tasa, v_imp_nom, v_imp_cod
        from impuestos_adicionales
       where id = v_product.impuesto_adicional_id and is_active;
      v_tasa := coalesce(v_tasa, 0);
      if v_tasa = 0 then v_imp_nom := null; v_imp_cod := null; end if;
    end if;
    v_subtotal := round(v_qty * v_price)::integer - v_disc;
    if v_subtotal < 0 then v_subtotal := 0; end if;
    v_bruto := v_bruto + round(v_qty * v_price)::integer;
    v_desc  := v_desc + v_disc;
    v_sum := v_sum + v_subtotal;

    select quantity into v_stock from stock_levels
     where tenant_id = v_tenant and store_id = v_store and product_id = v_product.id;
    -- 0017 · respuesta 13: el local decide si cualquiera vende sin stock.
    if coalesce(v_stock,0) < v_qty and not p_force and not v_sin_stock
       and coalesce(v_role::text, '') not in ('admin','supervisor') then
      raise exception 'STOCK_INSUFICIENTE: %', v_product.name using errcode = 'P0001';
    end if;

    insert into sale_items (sale_id, tenant_id, product_id, product_name,
                            quantity, unit_price, unit_cost, discount_amount, subtotal,
                            precio_lista, impuesto_adicional_tasa,
                            impuesto_adicional_nombre, impuesto_adicional_codigo)
    values (v_sale, v_tenant, v_product.id, v_product.name,
            v_qty, v_price, v_product.avg_cost, v_disc, v_subtotal,
            v_ref, v_tasa, v_imp_nom, v_imp_cod)
    returning id into v_item_id;

    if v_product.tracks_expiry then
      perform fn_consume_lots(v_tenant, v_store, v_product.id, v_qty, v_item_id);
    end if;

    perform fn_post_movement(v_tenant, v_store, v_product.id, 'venta',
                             -v_qty, v_product.avg_cost, 'sale', v_sale, null, v_user);
  end loop;

  v_desc := v_desc + coalesce(p_discount_total, 0);
  -- 0023 · Los combos son una promoción: rigen si regían las ofertas.
  if v_ofertas_hoy or v_ofertas_entonces then
    v_combos := fn_ahorro_combos(v_tenant, v_lineas, v_dia);
    v_desc_combos := (v_combos->>'total')::integer;
  end if;
  if v_desc + v_implicito > 0 then
    select coalesce(max_discount_pct, 0) into v_tope from profiles where id = v_user;
    -- 0036 · RQ-17: John o María José autorizaron este descuento con su PIN.
    -- De un solo uso, para este vendedor y hasta el tope de quien autorizó.
    if nullif(p_document->>'autorizacion', '') is not null then
      if (p_document->>'autorizacion') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'AUTORIZACION_INVALIDA' using errcode = 'P0001';
      end if;
      select * into v_aut from autorizaciones_descuento
       where id = (p_document->>'autorizacion')::uuid and tenant_id = v_tenant
         and para_usuario = v_user and usada_en is null and expira_en > now()
       for update;
      if not found then raise exception 'AUTORIZACION_INVALIDA' using errcode = 'P0001'; end if;
      v_tope := greatest(v_tope, v_aut.max_pct);
      update autorizaciones_descuento set usada_en = now(), sale_id = v_sale where id = v_aut.id;
      update sales set descuento_autorizado_por = v_aut.autorizado_por where id = v_sale;
    end if;
    -- El porcentaje se mide contra lo que correspondía cobrar, no contra lo
    -- que se cobró: si no, bajar el precio achicaría la base del tope.
    if not fn_discount_within_limit(greatest(v_desc + v_implicito - v_desc_combos, 0), greatest(v_bruto_ref, v_bruto), v_tope) then
      raise exception 'DESCUENTO_EXCEDE_LIMITE' using errcode = 'P0001';
    end if;
    v_sum := v_sum - coalesce(p_discount_total, 0);
    if v_sum < 0 then v_sum := 0; end if;
  end if;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_paid := v_paid + (v_pay->>'amount')::integer;
    insert into sale_payments (sale_id, tenant_id, method, amount, received_amount, change_amount)
    values (v_sale, v_tenant, (v_pay->>'method')::payment_method,
            (v_pay->>'amount')::integer,
            nullif(v_pay->>'received_amount','')::integer,
            greatest(coalesce(nullif(v_pay->>'received_amount','')::integer,0)
                     - (v_pay->>'amount')::integer, 0));
  end loop;

  -- 0029 · RF-M5-28 · Ley 20.956: pagado todo en efectivo, se cobra el total
  -- redondeado a la decena. El total de la venta (y de la boleta) sigue
  -- siendo el exacto; la diferencia queda en `ajuste_redondeo` y el pago en
  -- efectivo es lo que entró al cajón, que es lo que cuadra la caja. Se sigue
  -- aceptando el monto exacto: una venta que esperaba en la cola sin conexión
  -- desde antes de esta versión llega así.
  if v_paid <> v_sum then
    if jsonb_array_length(p_payments) > 0
       and not exists (select 1 from jsonb_array_elements(p_payments) x where x->>'method' <> 'efectivo')
       and v_paid = fn_redondeo_efectivo(v_sum) then
      v_redondeo := v_paid - v_sum;
    else
      raise exception 'PAGO_NO_CUADRA' using errcode = 'P0001';
    end if;
  end if;

  select coalesce((settings->>'iva_pct')::numeric, 19) into v_iva
    from tenants where id = v_tenant;
  select coalesce(sum(greatest(coalesce(received_amount,0) - amount, 0)), 0)
    into v_change from sale_payments where sale_id = v_sale;

  -- 0018 · IVA e impuestos adicionales. Sin adicionales da lo mismo que la
  -- fórmula de antes, round(total - total / 1,19).
  v_des := fn_desglose_impuestos(v_sale, v_iva, coalesce(p_discount_total, 0));

  update sales
     set subtotal   = v_bruto,
         discount_total = v_desc,
         total      = v_sum,
         tax_amount = (v_des->>'iva')::integer,
         neto       = (v_des->>'neto')::integer,
         impuestos_adicionales = (v_des->>'adicionales')::integer,
         impuestos_detalle     = v_des->'detalle',
         -- Lo que se ahorró en combos, nunca más que lo que se descontó.
         descuento_combos      = least(v_desc_combos, v_desc),
         combos_aplicados      = case when v_desc > 0 then v_combos->'aplicados' else '[]'::jsonb end,
         ajuste_redondeo       = v_redondeo
   where id = v_sale;

  -- 0029 · Lo fiado entra a la cuenta del cliente, en la misma transacción.
  if v_fiado > 0 then
    insert into cuenta_cliente_movimientos (tenant_id, cliente_id, tipo, monto, sale_id,
                                            cash_session_id, created_by)
    values (v_tenant, v_cliente, 'cargo', v_fiado, v_sale, v_session, v_user);
  end if;

  -- 0019 · La boleta o la factura, en la misma transacción que la venta. Si
  -- no se puede emitir (folios agotados en producción), la venta no queda.
  -- El voucher lo emite la máquina: no se registra documento.
  v_dte := fn_emitir_dte_venta(v_sale);

  return jsonb_build_object(
    'sale_id', v_sale, 'folio', v_folio, 'total', v_sum,
    'change_amount', v_change, 'sold_at', coalesce(p_sold_at, now()),
    'synced_at', now(), 'already_existed', false,
    'document_type', v_doc,
    'neto', (v_des->>'neto')::integer, 'iva', (v_des->>'iva')::integer,
    'impuestos_adicionales', (v_des->>'adicionales')::integer,
    'ajuste_redondeo', v_redondeo, 'cobrado', v_paid,
    'dte', v_dte);
end $$;
