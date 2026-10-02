-- ============================================================================
-- 0037 · Revisión de 150 errores (docs/28): lo que había que cerrar en la base
--
-- La pantalla validaba y la base no (regla 6: la seguridad vive en la base).
-- Todas las funciones conservan su firma: son reemplazos, no sobrecargas
-- (regla 21), y conservan sus permisos (`create or replace` no los toca).
--
--   · handle_new_user ya no confía en el metadata del usuario: el local y el
--     rol salen de `cuentas_autorizadas`, que escribe solo el servidor. Con el
--     registro público de Supabase, cualquiera con la llave pública se creaba
--     una cuenta de administrador en un local ajeno (docs/28).
--   · fn_register_sale: sin pagos negativos, sin ventas "del futuro" (reloj
--     del celular adelantado) y sin bodega vendiendo.
--   · fn_open_cash_session / fn_add_cash_movement / fn_close_cash_session:
--     bodega no abre caja; una cuenta desactivada no mueve plata; sin montos
--     negativos.
--   · fn_void_sale: anular una venta en efectivo de una caja ya cerrada deja
--     el egreso en la caja abierta de quien anula (antes, faltante sin
--     explicación en la caja de hoy).
--   · fn_adjust_stock / fn_apply_stock_count: sin cantidades negativas ni
--     decimales; una merma no suma; un conteo no toca productos de otro local.
--   · fn_confirm_receipt: sin cantidades ni costos inválidos, proveedor del
--     mismo local, y "vencido" con el día del local (regla 17).
--   · fn_void_receipt / fn_write_off_lot: cuenta activa.
--   · fn_registrar_factura_proveedor: sin fecha de emisión futura ni deuda por
--     una recepción anulada.
--   · v_expiring_lots: "vence hoy" con el día del local (regla 17): de noche
--     un lote que vence hoy salía "vencido" y con un día menos.
--
-- Antes de aplicarla: 0029 a 0036 aplicadas. Después, crear usuarios desde la
-- app o con `npm run db:admin` escribe primero en `cuentas_autorizadas`.
-- ============================================================================

create table if not exists cuentas_autorizadas (
  email      text primary key check (email = lower(email)),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  store_id   uuid references stores(id) on delete set null,
  role       user_role not null,
  full_name  text,
  creada_en  timestamptz not null default now()
);
-- Nadie la lee ni la escribe desde el navegador: solo la llave de servicio
-- (las rutas del servidor y los scripts) y el disparador.
alter table cuentas_autorizadas enable row level security;
revoke all on cuentas_autorizadas from anon, authenticated;

-- ---------------------------------------------------------------------------
-- fn_register_sale
-- ---------------------------------------------------------------------------
create or replace function public.fn_register_sale(
  p_client_uuid    uuid,
  p_items          jsonb,
  p_payments       jsonb,
  p_sold_at        timestamptz default now(),
  p_discount_total integer   default 0,
  p_notes          text      default null,
  p_force          boolean   default false,
  -- {tipo, rut, razon_social, giro, direccion}. Null = el que corresponda al
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
  -- 0037 · Un celular con el reloj adelantado mandaba la venta "de mañana":
  -- caía en otro día del Inicio, de Reportes y del resumen de la caja.
  v_momento   timestamptz := least(coalesce(p_sold_at, now()), now());
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
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  -- 0037 · Bodega no vende ni tiene caja (doc 02). Solo lo decía la pantalla.
  if coalesce(v_role::text, '') not in ('admin', 'supervisor', 'vendedor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
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
  -- 0037 · Un pago negativo cuadraba el total y sacaba plata: efectivo 2.000
  -- más débito −1.000 en una venta de 1.000 dejaba $1.000 de más "en el
  -- cajón" sin que nadie los hubiera cobrado. Solo la pantalla lo impedía.
  if exists (select 1 from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) x
              where coalesce((x->>'amount')::integer, 0) < 0
                 or coalesce(nullif(x->>'received_amount', '')::integer, 0) < 0) then
    raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
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
    v_razon := nullif(trim(p_document->>'razon_social'), '');
    if v_razon is null then
      raise exception 'RAZON_SOCIAL_REQUERIDA' using errcode = 'P0001';
    end if;
    v_rut := fn_rut_formateado(p_document->>'rut');
    if v_rut is null then
      raise exception 'RUT_INVALIDO' using errcode = 'P0001';
    end if;
  else
    v_rut := null; v_razon := null;
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
      insert into clientes (tenant_id, rut, nombre, giro, direccion, created_by)
      values (v_tenant, v_rut, v_razon, nullif(trim(p_document->>'giro'), ''),
              nullif(trim(p_document->>'direccion'), ''), v_user)
      on conflict (tenant_id, rut) where rut is not null do nothing
      returning id into v_cliente;
      -- Otra caja lo creó en el mismo instante.
      if v_cliente is null then
        select id into v_cliente from clientes where tenant_id = v_tenant and rut = v_rut;
      end if;
    else
      update clientes
         set giro      = coalesce(giro, nullif(trim(p_document->>'giro'), '')),
             direccion = coalesce(direccion, nullif(trim(p_document->>'direccion'), ''))
       where id = v_cliente;
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
                     receptor_giro, receptor_direccion, cliente_id)
  values (v_tenant, v_store, v_folio, v_session, v_user,
          v_momento, now(), p_client_uuid, p_notes,
          coalesce(p_discount_total,0),
          v_doc, v_rut, v_razon,
          nullif(trim(p_document->>'giro'), ''),
          nullif(trim(p_document->>'direccion'), ''), v_cliente)
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
    'change_amount', v_change, 'sold_at', v_momento,
    'synced_at', now(), 'already_existed', false,
    'document_type', v_doc,
    'neto', (v_des->>'neto')::integer, 'iva', (v_des->>'iva')::integer,
    'impuestos_adicionales', (v_des->>'adicionales')::integer,
    'ajuste_redondeo', v_redondeo, 'cobrado', v_paid,
    'dte', v_dte);
end $$;

-- ---------------------------------------------------------------------------
-- fn_open_cash_session
-- ---------------------------------------------------------------------------
create or replace function public.fn_open_cash_session(p_opening_amount integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_store  uuid := current_store_id();
  v_id     uuid;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  -- 0037 · Bodega no tiene caja (doc 02): por la API la abría y con ella
  -- podía vender y registrar egresos.
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor', 'vendedor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if coalesce(p_opening_amount, 0) < 0 then
    raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
  end if;
  if exists (select 1 from cash_sessions where user_id = v_user and status = 'abierta') then
    raise exception 'CAJA_YA_ABIERTA' using errcode = 'P0001';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  -- CP-08. El `exists` de arriba no ve una apertura que otro dispositivo
  -- todavía no confirma; el índice único one_open_session_per_user sí la
  -- detiene. Lo que cambia es el mensaje: el del índice es de la base, este es
  -- el que la aplicación sabe traducir.
  begin
    insert into cash_sessions (tenant_id, store_id, user_id, opening_amount)
    values (v_tenant, v_store, v_user, greatest(coalesce(p_opening_amount,0),0))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'CAJA_YA_ABIERTA' using errcode = 'P0001';
  end;

  return jsonb_build_object('session_id', v_id, 'opening_amount', p_opening_amount);
end $$;

-- ---------------------------------------------------------------------------
-- fn_add_cash_movement
-- ---------------------------------------------------------------------------
create or replace function public.fn_add_cash_movement(
  p_type cash_movement_type, p_amount integer, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_session uuid;
  v_id     uuid;
begin
  -- 0037 · Una cuenta desactivada con la sesión abierta seguía sacando plata.
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor', 'vendedor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if coalesce(p_amount,0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;

  -- `for share`, por lo mismo que la venta: un egreso no puede colarse en una
  -- caja que se está cerrando.
  select id into v_session from cash_sessions
   where user_id = v_user and status = 'abierta' limit 1 for share;
  if v_session is null then
    raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
  end if;

  insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
  values (v_tenant, v_session, p_type, p_amount, p_reason, v_user)
  returning id into v_id;

  return jsonb_build_object('movement_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- fn_close_cash_session
-- ---------------------------------------------------------------------------
create or replace function public.fn_close_cash_session(
  p_session_id uuid, p_counted_amount integer, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_user     uuid := auth.uid();
  v_role     user_role := current_user_role();
  v_s        cash_sessions%rowtype;
  v_summary  jsonb;
  v_expected integer;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  -- 0037 · Un contado negativo se guardaba y la diferencia quedaba absurda.
  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
  end if;
  -- CP-07. `for update` espera a que terminen las ventas en curso de esta caja
  -- (que la tienen `for share`), así el esperado las incluye. Sin esto, una
  -- venta confirmada un instante después del cálculo quedaba dentro de la caja
  -- cerrada y fuera del arqueo.
  select * into v_s from cash_sessions
   where id = p_session_id and tenant_id = v_tenant for update;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_s.status = 'cerrada' then
    raise exception 'CAJA_YA_CERRADA' using errcode = 'P0001';
  end if;
  if v_s.user_id <> v_user and coalesce(v_role::text, '') not in ('admin','supervisor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  v_summary  := fn_cash_session_summary(p_session_id);
  v_expected := (v_summary->>'expected_amount')::integer;

  if p_counted_amount <> v_expected and coalesce(trim(p_notes),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  update cash_sessions
     set status = 'cerrada', closed_at = now(), closed_by = v_user,
         expected_amount = v_expected, counted_amount = p_counted_amount,
         closing_notes = p_notes
   where id = p_session_id;

  if v_s.user_id <> v_user then
    insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
    values (v_tenant, v_user, 'cash_force_close', 'cash_sessions', p_session_id,
            jsonb_build_object('original_user', v_s.user_id, 'notes', p_notes));
  end if;

  return fn_cash_session_summary(p_session_id);
end $$;

-- ---------------------------------------------------------------------------
-- fn_void_sale
-- ---------------------------------------------------------------------------
create or replace function public.fn_void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_role   user_role := current_user_role();
  v_sale   sales%rowtype;
  v_item   sale_items%rowtype;
  -- 0037
  v_caja      text;
  v_efectivo  integer;
  v_session   uuid;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  select * into v_sale from sales where id = p_sale_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VENTA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  if v_sale.status = 'anulada' then
    raise exception 'VENTA_YA_ANULADA' using errcode = 'P0001';
  end if;
  -- 0019 · Una venta con boleta o factura emitida no se anula: el documento
  -- no se puede borrar, se corrige con nota de crédito (fn_devolver_venta).
  -- Y una venta con devoluciones tampoco: anularla devolvería el stock dos
  -- veces.
  if exists (select 1 from dte_documentos where sale_id = p_sale_id) then
    raise exception 'VENTA_CON_DOCUMENTO_USAR_DEVOLUCION' using errcode = 'P0001';
  end if;
  if exists (select 1 from sale_returns where sale_id = p_sale_id) then
    raise exception 'VENTA_CON_DEVOLUCIONES' using errcode = 'P0001';
  end if;
  if coalesce(v_role::text, '') not in ('admin','supervisor') then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
  end if;
  -- "Del día" es el día del local, en los dos lados de la comparación.
  if v_role = 'supervisor'
     and (v_sale.sold_at at time zone fn_tenant_timezone(v_tenant))::date
      <> (now()           at time zone fn_tenant_timezone(v_tenant))::date then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
  end if;

  -- 0037 · Una venta en efectivo de una caja YA CERRADA: la plata se le
  -- devuelve al cliente del cajón de hoy. Antes no quedaba ningún egreso, y la
  -- caja de hoy cerraba con faltante sin explicación (la de ayer ya estaba
  -- cerrada y no cambia). Sale de la caja abierta de quien anula, como una
  -- devolución en efectivo.
  select status::text into v_caja from cash_sessions where id = v_sale.cash_session_id;
  select coalesce(sum(amount), 0) into v_efectivo from sale_payments
   where sale_id = p_sale_id and method = 'efectivo';
  if v_efectivo > 0 and coalesce(v_caja, 'cerrada') <> 'abierta' then
    select id into v_session from cash_sessions
     where user_id = v_user and status = 'abierta' limit 1 for share;
    if v_session is null then
      raise exception 'CAJA_NO_ABIERTA_DEVOLUCION' using errcode = 'P0001';
    end if;
  end if;

  perform fn_lock_stock(v_tenant, v_sale.store_id, array(
    select product_id from sale_items where sale_id = p_sale_id));

  for v_item in select * from sale_items where sale_id = p_sale_id loop
    update product_lots pl
       set quantity = pl.quantity + sil.quantity
      from sale_item_lots sil
     where sil.sale_item_id = v_item.id and pl.id = sil.lot_id;

    perform fn_post_movement(v_tenant, v_sale.store_id, v_item.product_id,
                             'anulacion_venta', v_item.quantity, v_item.unit_cost,
                             'sale_void', p_sale_id, p_reason, v_user);
  end loop;

  update sales set status = 'anulada', voided_by = v_user,
                   voided_at = now(), void_reason = p_reason
   where id = p_sale_id;

  if v_session is not null then
    insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
    values (v_tenant, v_session, 'egreso', v_efectivo,
            'Anulación venta folio ' || v_sale.folio || ' (de una caja ya cerrada) · ' || trim(p_reason), v_user);
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, v_user, 'sale_void', 'sales', p_sale_id,
          jsonb_build_object('status','completada','total',v_sale.total),
          jsonb_build_object('status','anulada','reason',p_reason));

  return jsonb_build_object('sale_id', p_sale_id, 'status', 'anulada');
end $$;

-- ---------------------------------------------------------------------------
-- fn_adjust_stock
-- ---------------------------------------------------------------------------
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
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') or not is_active_user() then
    raise exception 'SIN_PERMISO_AJUSTAR' using errcode = '42501';
  end if;
  -- 0037 · "Dejar en −5" dejaba un saldo que no existe en ninguna bodega.
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'CANTIDAD_NEGATIVA' using errcode = 'P0001';
  end if;
  if p_new_quantity <> trunc(p_new_quantity) then
    raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
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

  -- 0037 · El tipo sigue al signo. Una "merma" que sumaba stock salía en
  -- Reportes → Ajustes como pérdida con valor positivo. Suma o resta lo decide
  -- la cantidad real contra la de AHORA (pudo venderse algo mientras se
  -- escribía); una merma solo resta.
  if p_movement_type = 'merma' and v_delta > 0 then
    raise exception 'MERMA_SUMA_STOCK' using errcode = 'P0001';
  end if;
  if p_movement_type in ('ajuste_positivo', 'ajuste_negativo') then
    p_movement_type := case when v_delta > 0 then 'ajuste_positivo' else 'ajuste_negativo' end;
  end if;

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

-- ---------------------------------------------------------------------------
-- fn_apply_stock_count
-- ---------------------------------------------------------------------------
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
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') or not is_active_user() then
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
    -- 0037 · Un conteo negativo o con decimales entraba tal cual, y un
    -- producto de otro local dejaba un movimiento en el kardex de este.
    if v_counted is null or v_counted < 0 then
      raise exception 'CANTIDAD_NEGATIVA' using errcode = 'P0001';
    end if;
    if v_counted <> trunc(v_counted) then
      raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
    end if;
    if not exists (select 1 from products
                    where id = (v_item->>'product_id')::uuid and tenant_id = v_tenant) then
      raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001';
    end if;

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

-- ---------------------------------------------------------------------------
-- fn_confirm_receipt
-- ---------------------------------------------------------------------------
create or replace function public.fn_confirm_receipt(
  p_supplier_id     uuid,
  p_items           jsonb,
  p_document_type   text default 'guia',
  p_document_number text default null,
  p_received_at     timestamptz default now(),
  p_notes           text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_user    uuid := auth.uid();
  v_store   uuid := current_store_id();
  v_receipt uuid;
  v_item    jsonb;
  v_prod    products%rowtype;
  v_qty     numeric(14,3);
  v_cost    integer;
  v_stock   numeric(14,3);
  v_new_avg integer;
  v_total   integer := 0;
  v_expiry  date;
  v_lotcode text;
  v_lot_id  uuid;
  v_ids     uuid[];
  v_result  jsonb := '[]'::jsonb;
begin
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  -- 0037 · Un proveedor de otro local quedaba como proveedor de esta recepción.
  if p_supplier_id is not null
     and not exists (select 1 from suppliers where id = p_supplier_id and tenant_id = v_tenant) then
    raise exception 'PROVEEDOR_NO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  -- El promedio ponderado lee costo y stock y escribe un costo nuevo. Si otra
  -- recepción del mismo producto está en curso, hay que esperarla: si no, las
  -- dos promedian contra el mismo punto de partida y la segunda pisa a la
  -- primera. Productos primero y stock después, siempre en ese orden.
  v_ids := array(select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x);
  perform 1 from products where id = any(v_ids) and tenant_id = v_tenant order by id for update;
  perform fn_lock_stock(v_tenant, v_store, v_ids);

  insert into purchase_receipts (tenant_id, store_id, supplier_id, document_type,
                                 document_number, received_at, notes, created_by)
  values (v_tenant, v_store, p_supplier_id, p_document_type,
          p_document_number, least(coalesce(p_received_at, now()), now()), p_notes, v_user)  -- 0037 · no en el futuro: la hora venía del reloj del celular
  returning id into v_receipt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from products
     where id = (v_item->>'product_id')::uuid and tenant_id = v_tenant;
    if not found then
      raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001';
    end if;

    v_qty     := (v_item->>'quantity')::numeric;
    v_cost    := (v_item->>'unit_cost')::integer;
    v_expiry  := nullif(v_item->>'expiry_date','')::date;
    v_lotcode := nullif(v_item->>'lot_code','');
    -- 0037 · Cantidad cero o negativa, o un costo negativo, entraban: una
    -- "recepción" de −10 sacaba stock, y un costo negativo dejaba el costo
    -- promedio bajo cero. Solo la pantalla lo impedía.
    if v_qty is null or v_qty <= 0 then
      raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
    end if;
    if v_cost is null or v_cost < 0 then
      raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
    end if;
    v_total   := v_total + round(v_qty * v_cost)::integer;

    if v_prod.tracks_expiry and v_expiry is null then
      raise exception 'VENCIMIENTO_REQUERIDO: %', v_prod.name using errcode = 'P0001';
    end if;
    -- 0037 · El día del LOCAL (regla 17): current_date es el de UTC, y de
    -- noche rechazaba como vencido un lote que vence hoy.
    if v_expiry is not null
       and v_expiry < (now() at time zone fn_tenant_timezone(v_tenant))::date then
      raise exception 'LOTE_YA_VENCIDO: %', v_prod.name using errcode = 'P0001';
    end if;

    select coalesce(quantity,0) into v_stock from stock_levels
     where tenant_id = v_tenant and store_id = v_store and product_id = v_prod.id;
    v_stock := coalesce(v_stock, 0);

    if v_stock <= 0 then
      v_new_avg := v_cost;
    else
      v_new_avg := round(((v_stock * v_prod.avg_cost) + (v_qty * v_cost))
                         / (v_stock + v_qty))::integer;
    end if;

    insert into purchase_receipt_items (receipt_id, tenant_id, product_id,
                                        quantity, unit_cost, subtotal,
                                        lot_code, expiry_date)
    values (v_receipt, v_tenant, v_prod.id, v_qty, v_cost,
            round(v_qty * v_cost)::integer, v_lotcode, v_expiry);

    v_lot_id := null;
    if v_prod.tracks_expiry then
      insert into product_lots (tenant_id, store_id, product_id, lot_code,
                                expiry_date, quantity, unit_cost, receipt_id)
      values (v_tenant, v_store, v_prod.id, v_lotcode, v_expiry, v_qty, v_cost, v_receipt)
      on conflict (tenant_id, store_id, product_id, lot_code, expiry_date)
        do update set quantity = product_lots.quantity + excluded.quantity,
                      unit_cost = excluded.unit_cost
      returning id into v_lot_id;
    end if;

    update products set avg_cost = v_new_avg, last_cost = v_cost, updated_at = now()
     where id = v_prod.id;

    perform fn_post_movement(v_tenant, v_store, v_prod.id, 'recepcion',
                             v_qty, v_cost, 'purchase_receipt', v_receipt, null, v_user);

    if v_lot_id is not null then
      update inventory_movements set lot_id = v_lot_id
       where reference_type = 'purchase_receipt' and reference_id = v_receipt
         and product_id = v_prod.id and lot_id is null;
    end if;

    v_result := v_result || jsonb_build_object(
      'product_id', v_prod.id, 'product_name', v_prod.name,
      'old_avg_cost', v_prod.avg_cost, 'new_avg_cost', v_new_avg,
      'lot_id', v_lot_id, 'expiry_date', v_expiry);
  end loop;

  update purchase_receipts set total_amount = v_total where id = v_receipt;

  return jsonb_build_object('receipt_id', v_receipt, 'total_amount', v_total,
                            'items', v_result);
end $$;

-- ---------------------------------------------------------------------------
-- fn_void_receipt
-- ---------------------------------------------------------------------------
create or replace function public.fn_void_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_rec    purchase_receipts%rowtype;
  v_item   purchase_receipt_items%rowtype;
  v_prod   products%rowtype;
  v_stock  numeric(14,3);
  v_resto  numeric(14,3);
  v_pagada boolean := false;
begin
  if coalesce(current_user_role()::text, '') <> 'admin' or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  select * into v_rec from purchase_receipts
   where id = p_receipt_id and tenant_id = v_tenant for update;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_rec.status = 'anulada' then
    raise exception 'RECEPCION_YA_ANULADA' using errcode = 'P0001';
  end if;

  perform fn_lock_stock(v_tenant, v_rec.store_id, array(
    select product_id from purchase_receipt_items where receipt_id = p_receipt_id));

  for v_item in select * from purchase_receipt_items where receipt_id = p_receipt_id loop
    select * into v_prod from products where id = v_item.product_id for update;
    select coalesce(sum(quantity), 0) into v_stock from stock_levels
     where tenant_id = v_tenant and product_id = v_item.product_id;

    -- El promedio sin esta entrada: lo inverso de lo que hizo la recepción.
    -- Si no queda stock (o el cálculo da negativo), se deja el que había.
    v_resto := v_stock - v_item.quantity;
    if v_resto > 0 then
      update products
         set avg_cost = greatest(round((v_prod.avg_cost * v_stock - v_item.quantity * v_item.unit_cost) / v_resto)::integer, 0),
             updated_at = now()
       where id = v_prod.id
         and (v_prod.avg_cost * v_stock - v_item.quantity * v_item.unit_cost) >= 0;
    end if;

    -- El lote: se le resta lo que entró, sin bajar de cero (lo que ya se
    -- vendió de él no vuelve).
    if v_prod.tracks_expiry and v_item.expiry_date is not null then
      update product_lots
         set quantity = greatest(quantity - v_item.quantity, 0)
       where tenant_id = v_tenant and store_id = v_rec.store_id and product_id = v_item.product_id
         and lot_code is not distinct from v_item.lot_code and expiry_date = v_item.expiry_date;
    end if;

    perform fn_post_movement(v_tenant, v_rec.store_id, v_item.product_id,
                             'anulacion_recepcion', -v_item.quantity, v_item.unit_cost,
                             'receipt_void', p_receipt_id, p_reason, v_user);
  end loop;

  update purchase_receipts
     set status = 'anulada', voided_by = v_user, voided_at = now(), void_reason = p_reason
   where id = p_receipt_id;

  -- La factura por pagar de esta recepción: si no está pagada, se anula con
  -- ella. Si ya se pagó, se deja (la plata salió) y se avisa en la respuesta.
  select exists (select 1 from facturas_proveedor where receipt_id = p_receipt_id
                  and anulada_en is null and pagada_en is not null) into v_pagada;
  update facturas_proveedor
     set anulada_en = now(), anulada_motivo = 'Recepción anulada: ' || trim(p_reason)
   where receipt_id = p_receipt_id and anulada_en is null and pagada_en is null;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'receipt_void', 'purchase_receipts', p_receipt_id,
          jsonb_build_object('reason', p_reason));

  return jsonb_build_object('receipt_id', p_receipt_id, 'status', 'anulada', 'factura_ya_pagada', v_pagada);
end $$;

-- ---------------------------------------------------------------------------
-- fn_write_off_lot
-- ---------------------------------------------------------------------------
create or replace function public.fn_write_off_lot(p_lot_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_lot    product_lots%rowtype;
begin
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') or not is_active_user() then
    raise exception 'SIN_PERMISO_AJUSTAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  select * into v_lot from product_lots where id = p_lot_id and tenant_id = v_tenant;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  -- Stock antes que lote, igual que la venta (que bloquea stock y después
  -- consume lotes): el mismo orden en todas partes para no trabarse entre sí.
  perform fn_lock_stock(v_tenant, v_lot.store_id, array[v_lot.product_id]);
  select * into v_lot from product_lots where id = p_lot_id for update;
  if v_lot.quantity <= 0 then
    return jsonb_build_object('lot_id', p_lot_id, 'changed', false);
  end if;

  perform fn_post_movement(v_tenant, v_lot.store_id, v_lot.product_id, 'merma',
                           -v_lot.quantity, v_lot.unit_cost, 'lot_write_off',
                           p_lot_id, p_reason, v_user);

  update product_lots set quantity = 0, is_active = false where id = p_lot_id;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'stock_adjustment', 'product_lots', p_lot_id,
          jsonb_build_object('written_off', v_lot.quantity, 'reason', p_reason,
                             'expiry_date', v_lot.expiry_date));

  return jsonb_build_object('lot_id', p_lot_id, 'written_off', v_lot.quantity,
                            'changed', true);
end $$;

-- ---------------------------------------------------------------------------
-- fn_registrar_factura_proveedor
-- ---------------------------------------------------------------------------
create or replace function public.fn_registrar_factura_proveedor(p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_rec      purchase_receipts%rowtype;
  v_supplier uuid;
  v_numero   text;
  v_monto    integer;
  v_vence    date;
  v_emitida  date;
  v_id       uuid;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor', 'bodega') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  if nullif(p_datos->>'receipt_id', '') is not null then
    select * into v_rec from purchase_receipts
     where id = (p_datos->>'receipt_id')::uuid and tenant_id = v_tenant;
    if not found then raise exception 'RECEPCION_NO_ENCONTRADA' using errcode = 'P0001'; end if;
    -- 0037 · Una recepción anulada no deja deuda con el proveedor.
    if v_rec.status = 'anulada' then raise exception 'RECEPCION_YA_ANULADA' using errcode = 'P0001'; end if;
  end if;

  v_supplier := coalesce(nullif(p_datos->>'supplier_id', '')::uuid, v_rec.supplier_id);
  v_numero   := coalesce(nullif(trim(p_datos->>'numero'), ''), nullif(trim(v_rec.document_number), ''));
  begin
    v_monto   := coalesce(nullif(p_datos->>'monto', '')::integer, v_rec.total_amount);
    v_vence   := (p_datos->>'vence')::date;
    v_emitida := coalesce(nullif(p_datos->>'emitida', '')::date,
                          (v_rec.received_at at time zone fn_tenant_timezone(v_tenant))::date);
  exception when others then
    raise exception 'DATOS_FACTURA_INVALIDOS' using errcode = 'P0001';
  end;

  if v_supplier is null or not exists (select 1 from suppliers where id = v_supplier and tenant_id = v_tenant) then
    raise exception 'PROVEEDOR_REQUERIDO' using errcode = 'P0001';
  end if;
  if v_numero is null then raise exception 'NUMERO_FACTURA_REQUERIDO' using errcode = 'P0001'; end if;
  if coalesce(v_monto, 0) <= 0 then raise exception 'MONTO_INVALIDO' using errcode = 'P0001'; end if;
  if v_vence is null then raise exception 'VENCIMIENTO_FACTURA_REQUERIDO' using errcode = 'P0001'; end if;
  if v_emitida is not null and v_vence < v_emitida then
    raise exception 'VENCE_ANTES_DE_EMITIDA' using errcode = 'P0001';
  end if;
  -- 0037 · La pantalla ya no deja (docs/27 N° 100), la base tampoco: un año
  -- mal tecleado corría el vencimiento sugerido y el aviso del Inicio.
  if v_emitida > (now() at time zone fn_tenant_timezone(v_tenant))::date then
    raise exception 'FECHA_INVALIDA' using errcode = 'P0001';
  end if;

  begin
    insert into facturas_proveedor (tenant_id, supplier_id, receipt_id, numero, emitida, vence, monto,
                                    nota, created_by)
    values (v_tenant, v_supplier, v_rec.id, v_numero, v_emitida, v_vence, v_monto,
            nullif(trim(p_datos->>'nota'), ''), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'FACTURA_PROVEEDOR_DUPLICADA' using errcode = 'P0001';
  end;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'crear', 'factura_proveedor', v_id,
          jsonb_build_object('numero', v_numero, 'monto', v_monto, 'vence', v_vence));
  return v_id;
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
-- fn_autorizar_descuento
-- ---------------------------------------------------------------------------
create or replace function public.fn_autorizar_descuento(
  p_autorizador uuid, p_pin text, p_pct numeric, p_motivo text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_aut    profiles%rowtype;
  v_pin    pines_autorizacion%rowtype;
  v_malos  integer;
  v_id     uuid;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  select * into v_aut from profiles
   where id = p_autorizador and tenant_id = v_tenant and is_active and role in ('admin', 'supervisor');
  if not found then raise exception 'AUTORIZADOR_INVALIDO' using errcode = 'P0001'; end if;
  -- 0037 · Con la fila del PIN tomada: sin el candado, cien intentos
  -- mandados a la vez pasaban todos la cuenta de "5 malos en 15 minutos"
  -- antes de que el primero quedara anotado, y un PIN de 4 dígitos se
  -- adivinaba desde el celular de un vendedor en segundos.
  select * into v_pin from pines_autorizacion where user_id = p_autorizador for update;
  if not found then raise exception 'SIN_PIN' using errcode = 'P0001'; end if;

  -- Cinco intentos malos en 15 minutos bloquean a ese autorizador: un PIN de
  -- 4 dígitos no aguanta que lo prueben de corrido.
  select count(*) into v_malos from intentos_pin
   where autorizador = p_autorizador and not correcto and creado_en > now() - interval '15 minutes';
  if v_malos >= 5 then raise exception 'PIN_BLOQUEADO' using errcode = 'P0001'; end if;

  if p_pin is null or fn_hash_pin(v_pin.sal, p_pin) <> v_pin.hash then
    insert into intentos_pin (tenant_id, autorizador, solicitante, correcto)
    values (v_tenant, p_autorizador, v_user, false);
    -- El intento fallido tiene que quedar: se devuelve el error sin abortar la
    -- transacción (la llamada RPC no la deshace porque no se levanta excepción).
    return null;
  end if;

  if p_pct is null or p_pct <= 0 or p_pct > 100 then
    raise exception 'PORCENTAJE_INVALIDO' using errcode = 'P0001';
  end if;
  -- Nadie autoriza más de lo que podría hacer él mismo.
  if p_pct > coalesce(v_aut.max_discount_pct, 0) + 0.01 then
    raise exception 'AUTORIZACION_EXCEDE_TOPE' using errcode = 'P0001';
  end if;

  insert into intentos_pin (tenant_id, autorizador, solicitante, correcto)
  values (v_tenant, p_autorizador, v_user, true);
  insert into autorizaciones_descuento (tenant_id, para_usuario, autorizado_por, max_pct, motivo, expira_en)
  values (v_tenant, v_user, p_autorizador, round(p_pct, 2), nullif(trim(coalesce(p_motivo, '')), ''), now() + interval '15 minutes')
  returning id into v_id;
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, p_autorizador, 'autorizar_descuento', 'autorizaciones_descuento', v_id,
          jsonb_build_object('para', v_user, 'pct', p_pct, 'motivo', p_motivo));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- fn_cash_session_summary
-- ---------------------------------------------------------------------------
create or replace function public.fn_cash_session_summary(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_s          cash_sessions%rowtype;
  v_cash_sales integer;
  v_in         integer;
  v_out        integer;
  v_count      integer;
  v_total      integer;
  v_methods    jsonb;
  v_redondeo   integer;
  v_abonos     integer;
  v_fiado      integer;
begin
  select * into v_s from cash_sessions
   where id = p_session_id and tenant_id = current_tenant_id();
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  -- 0037 · La misma visibilidad que la tabla (RLS de cash_sessions): el
  -- vendedor ve su caja, no la de otro. Con security definer, cualquier
  -- cuenta del local (bodega incluida) leía cuánto vendió y cuánto debería
  -- tener en el cajón otro cajero.
  -- Sin usuario (auth.uid() null) es la llave de servicio: el worker.
  if auth.uid() is not null
     and coalesce(current_user_role()::text, '') not in ('admin', 'supervisor')
     and v_s.user_id is distinct from auth.uid() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select coalesce(sum(sp.amount),0) into v_cash_sales
    from sale_payments sp join sales s on s.id = sp.sale_id
   where s.cash_session_id = p_session_id and s.status = 'completada'
     and sp.method = 'efectivo';

  select coalesce(sum(amount),0) into v_in from cash_movements
   where cash_session_id = p_session_id and type = 'ingreso';
  select coalesce(sum(amount),0) into v_out from cash_movements
   where cash_session_id = p_session_id and type = 'egreso';

  select count(*), coalesce(sum(total),0), coalesce(sum(ajuste_redondeo),0)
    into v_count, v_total, v_redondeo
    from sales where cash_session_id = p_session_id and status = 'completada';

  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) into v_methods from (
    select sp.method::text as method, sum(sp.amount) as amt
      from sale_payments sp join sales s on s.id = sp.sale_id
     where s.cash_session_id = p_session_id and s.status = 'completada'
     group by sp.method) t;
  v_fiado := coalesce((v_methods->>'fiado')::integer, 0);

  select coalesce(sum(monto),0) into v_abonos from cuenta_cliente_movimientos
   where cash_session_id = p_session_id and tipo = 'abono' and metodo = 'efectivo';

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', v_s.status,
    'opened_at', v_s.opened_at,
    'opening_amount', v_s.opening_amount,
    'cash_sales', v_cash_sales,
    'cash_in', v_in,
    'cash_out', v_out,
    'abonos_efectivo', v_abonos,
    'ajuste_redondeo', v_redondeo,
    'fiado', v_fiado,
    'expected_amount', v_s.opening_amount + v_cash_sales + v_in - v_out + v_abonos,
    'counted_amount', v_s.counted_amount,
    'difference', v_s.difference,
    'sales_count', v_count,
    'sales_total', v_total,
    'average_ticket', case when v_count > 0 then round(v_total::numeric / v_count)::integer else 0 end,
    'by_payment_method', v_methods);
end $$;

-- ---------------------------------------------------------------------------
-- handle_new_user
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_aut cuentas_autorizadas%rowtype;
begin
  -- 0037 · El local, la tienda y el rol salen de `cuentas_autorizadas`, que
  -- solo escribe el servidor con la llave de servicio. Antes salían del
  -- metadata del usuario, y ese lo escribe cualquiera: con el registro
  -- público de Supabase (encendido por omisión) un vendedor que conocía el id
  -- del local —viaja en su propio token— se creaba una cuenta de
  -- ADMINISTRADOR con la llave pública. Sin autorización no hay perfil.
  select * into v_aut from cuentas_autorizadas where email = lower(new.email);
  if not found then
    return new;
  end if;

  insert into profiles (id, tenant_id, store_id, full_name, email, role, max_discount_pct)
  values (
    new.id, v_aut.tenant_id, v_aut.store_id,
    coalesce(nullif(v_aut.full_name, ''), new.raw_user_meta_data->>'full_name', ''),
    new.email, v_aut.role,
    -- El tope que el local configuró para el rol (tenants.settings), como
    -- cuando se le cambia el rol desde Usuarios; si no hay, el de omisión.
    -- Antes la cuenta nueva nacía con 100/10/0 aunque el local dijera otro.
    coalesce(
      (select case when jsonb_typeof(t.settings->'max_discount_pct'->(v_aut.role::text)) = 'number'
                   then least(greatest((t.settings->'max_discount_pct'->>(v_aut.role::text))::numeric, 0), 100) end
         from tenants t where t.id = v_aut.tenant_id),
      case v_aut.role when 'admin' then 100 when 'supervisor' then 10 else 0 end)
  )
  on conflict (id) do nothing;

  delete from cuentas_autorizadas where email = lower(new.email);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- v_expiring_lots — las mismas columnas y en el mismo orden que 0010 (regla 22)
-- ---------------------------------------------------------------------------
create or replace view v_expiring_lots
with (security_invoker = true) as
select
  pl.tenant_id, pl.id as lot_id, pl.product_id, p.name as product_name,
  pl.lot_code, pl.expiry_date, pl.quantity, pl.unit_cost,
  round(pl.quantity * pl.unit_cost)::integer as value_at_risk,
  (pl.expiry_date - (now() at time zone fn_tenant_timezone(pl.tenant_id))::date) as days_to_expiry,
  case
    when pl.expiry_date < (now() at time zone fn_tenant_timezone(pl.tenant_id))::date then 'vencido'
    when pl.expiry_date <= (now() at time zone fn_tenant_timezone(pl.tenant_id))::date + p.expiry_alert_days then 'por_vencer'
    else 'vigente'
  end as expiry_status,
  p.unit
from product_lots pl
join products p on p.id = pl.product_id
where pl.is_active and pl.quantity > 0;
