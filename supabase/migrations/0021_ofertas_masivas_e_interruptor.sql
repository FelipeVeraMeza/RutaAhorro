-- ============================================================================
-- 0021 · Ofertas: por porcentaje, a muchos productos a la vez, y un
--        interruptor para apagarlas en todo el local
--
-- Pedido de Felipe (2026-09-27), sobre lo que 0018 no cubría:
--
-- (1) Tramos por PORCENTAJE. `product_price_tiers.descuento_pct`: "desde 6,
--     10 % menos". Un tramo lleva un monto fijo o un porcentaje, nunca los dos.
--     El porcentaje se calcula contra el precio normal del momento, así que la
--     oferta sigue al producto cuando sube de precio. Es lo que hace útil la
--     aplicación masiva: «todas las cervezas, desde 6, 10 % menos» no se
--     puede escribir como un monto, porque cada cerveza cuesta distinto.
--     `fn_precio_tramo` es la réplica de `precioDelTramo` en core.
--
-- (2) Aplicar una oferta a MUCHOS productos (`fn_aplicar_oferta_masiva`) y
--     quitarlas (`fn_quitar_ofertas`). Cada producto queda con su propio tramo
--     —la venta, el POS y el consultador siguen leyendo lo mismo que desde
--     0018— y el tramo con la misma cantidad y las mismas fechas se
--     reemplaza, no se duplica. Un producto en el que la oferta no tiene
--     sentido (un monto fijo mayor que su precio normal) se salta y se dice
--     cuál y por qué, en vez de fallar todo.
--
-- (3) Interruptor del local: `settings.ofertas_activas`. Apagado, ningún
--     tramo rige (ni por cantidad ni promociones). Dos detalles:
--
--     · Una venta hecha SIN CONEXIÓN antes de apagarlas se sincroniza con el
--       precio de oferta que tenía, y la base no puede rechazarla por eso.
--       Por eso al apagar se guarda `ofertas_pausadas_desde` (lo pone la
--       función, no la pantalla) y rigen para lo vendido antes de ese momento.
--     · Los celulares se enteran en su próxima sincronización del catálogo
--       (al entrar al POS, o cada 10 minutos). Un vendedor con el catálogo
--       viejo cobraría la oferta, la base diría "descuento excede el límite",
--       y la venta quedaría trabada. Se aceptan 15 minutos de gracia: el
--       precio de oferta lo autorizó el dueño, no es un agujero.
--
--     Los precios por cliente (0022) NO se apagan con esto: son un acuerdo
--     con el cliente, no una promoción.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) Tramos por porcentaje
-- ---------------------------------------------------------------------------
alter table product_price_tiers
  add column if not exists descuento_pct numeric(5,2);
alter table product_price_tiers alter column precio drop not null;

-- Uno de los dos, y el porcentaje entre 0 y 100 sin incluirlos.
alter table product_price_tiers drop constraint if exists product_price_tiers_monto_o_pct;
alter table product_price_tiers add constraint product_price_tiers_monto_o_pct
  check ((precio is null) <> (descuento_pct is null)
         and (descuento_pct is null or (descuento_pct > 0 and descuento_pct < 100)));

-- El precio de cada unidad que da un tramo. Réplica de `precioDelTramo`.
create or replace function public.fn_precio_tramo(
  p_base integer, p_precio integer, p_pct numeric
) returns integer
language sql immutable set search_path = public
as $$
  select case
    when p_pct is not null then round(p_base::numeric * (100 - p_pct) / 100)::integer
    else coalesce(p_precio, p_base)
  end
$$;

-- Misma firma que 0018: reemplazo, no sobrecarga (regla 21).
create or replace function public.fn_precio_por_cantidad(
  p_product uuid, p_base integer, p_qty numeric, p_dia date
) returns integer
language sql stable set search_path = public
as $$
  select least(p_base, coalesce((
    select fn_precio_tramo(p_base, t.precio, t.descuento_pct) from product_price_tiers t
     where t.product_id = p_product
       and t.desde <= p_qty
       and (t.vigente_desde is null or (p_dia is not null and t.vigente_desde <= p_dia))
       and (t.vigente_hasta is null or (p_dia is not null and t.vigente_hasta >= p_dia))
     order by t.desde desc, fn_precio_tramo(p_base, t.precio, t.descuento_pct) asc
     limit 1), p_base))
$$;

-- ---------------------------------------------------------------------------
-- (3) ¿Rigen las ofertas para una venta de ese momento?
-- ---------------------------------------------------------------------------
create or replace function public.fn_ofertas_rigen(p_tenant uuid, p_momento timestamptz)
returns boolean
language sql stable set search_path = public
as $$
  select coalesce((t.settings->>'ofertas_activas')::boolean, true)
      or p_momento < coalesce((t.settings->>'ofertas_pausadas_desde')::timestamptz, '-infinity')
                     + interval '15 minutes'
    from tenants t where t.id = p_tenant
$$;

-- ---------------------------------------------------------------------------
-- Validar un tramo que llega como jsonb. Lo usan la edición de un producto y
-- la aplicación masiva, con los mismos límites que `validarTramos` en core.
-- Devuelve el código del problema, o null si está bien.
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
-- fn_guardar_precios_producto — igual que 0018, aceptando porcentaje
-- ---------------------------------------------------------------------------
create or replace function public.fn_guardar_precios_producto(
  p_product_id uuid, p_tramos jsonb
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_prod     products%rowtype;
  v_t        jsonb;
  v_problema text;
  v_desde    numeric;
  v_vd       date;
  v_vh       date;
  v_n        integer := 0;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  select * into v_prod from products
   where id = p_product_id and tenant_id = v_tenant for update;
  if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if p_tramos is not null and jsonb_typeof(p_tramos) <> 'array' then
    raise exception 'TRAMO_INVALIDO' using errcode = 'P0001';
  end if;

  delete from product_price_tiers where product_id = p_product_id;

  for v_t in select * from jsonb_array_elements(coalesce(p_tramos, '[]'::jsonb)) loop
    v_problema := fn_problema_tramo(v_t, v_prod.sale_price);
    if v_problema is not null then
      raise exception '%', v_problema using errcode = 'P0001';
    end if;
    v_desde := (v_t->>'desde')::numeric;
    v_vd    := nullif(v_t->>'vigente_desde', '')::date;
    v_vh    := nullif(v_t->>'vigente_hasta', '')::date;
    if exists (select 1 from product_price_tiers
                where product_id = p_product_id and desde = v_desde
                  and vigente_desde is not distinct from v_vd
                  and vigente_hasta is not distinct from v_vh) then
      raise exception 'TRAMO_REPETIDO' using errcode = 'P0001';
    end if;
    insert into product_price_tiers (tenant_id, product_id, desde, precio, descuento_pct,
                                     vigente_desde, vigente_hasta, created_by)
    values (v_tenant, p_product_id, v_desde,
            nullif(v_t->>'precio', '')::integer, nullif(v_t->>'descuento_pct', '')::numeric,
            v_vd, v_vh, auth.uid());
    v_n := v_n + 1;
  end loop;

  update products set updated_at = now() where id = p_product_id;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, auth.uid(), 'ofertas', 'product', p_product_id,
          jsonb_build_object('tramos', coalesce(p_tramos, '[]'::jsonb)));
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- (2) fn_aplicar_oferta_masiva — la misma oferta a muchos productos
-- ---------------------------------------------------------------------------
-- `p_tramo`: {desde, precio | descuento_pct, vigente_desde?, vigente_hasta?}.
-- Devuelve {aplicados, omitidos: [{id, nombre, motivo}]}. Un producto que no
-- es del local ni se nombra: no hay por qué confirmarle a nadie que existe.
create or replace function public.fn_aplicar_oferta_masiva(
  p_productos uuid[], p_tramo jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant   uuid := current_tenant_id();
  v_prod     products%rowtype;
  v_problema text;
  v_desde    numeric;
  v_vd       date;
  v_vh       date;
  v_n        integer := 0;
  v_omitidos jsonb := '[]'::jsonb;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_productos is null or cardinality(p_productos) = 0 then
    raise exception 'SIN_PRODUCTOS' using errcode = 'P0001';
  end if;
  if cardinality(p_productos) > 5000 then
    raise exception 'DEMASIADOS_PRODUCTOS' using errcode = 'P0001';
  end if;
  -- Lo que no depende del producto se revisa una vez, antes de tocar nada:
  -- con un precio de lista enorme, el único problema posible es del tramo.
  v_problema := fn_problema_tramo(p_tramo, 2147483647);
  if v_problema is not null then
    raise exception '%', v_problema using errcode = 'P0001';
  end if;
  v_desde := (p_tramo->>'desde')::numeric;
  v_vd    := nullif(p_tramo->>'vigente_desde', '')::date;
  v_vh    := nullif(p_tramo->>'vigente_hasta', '')::date;

  -- En orden de id, como fn_lock_stock: dos aplicaciones masivas a la vez no
  -- se traban una con otra.
  for v_prod in
    select * from products
     where tenant_id = v_tenant and id = any(p_productos)
     order by id
       for update
  loop
    v_problema := case when not v_prod.is_active then 'PRODUCTO_INACTIVO'
                       else fn_problema_tramo(p_tramo, v_prod.sale_price) end;
    if v_problema is not null then
      v_omitidos := v_omitidos || jsonb_build_object('id', v_prod.id, 'nombre', v_prod.name, 'motivo', v_problema);
      continue;
    end if;

    delete from product_price_tiers
     where product_id = v_prod.id and desde = v_desde
       and vigente_desde is not distinct from v_vd
       and vigente_hasta is not distinct from v_vh;
    insert into product_price_tiers (tenant_id, product_id, desde, precio, descuento_pct,
                                     vigente_desde, vigente_hasta, created_by)
    values (v_tenant, v_prod.id, v_desde,
            nullif(p_tramo->>'precio', '')::integer, nullif(p_tramo->>'descuento_pct', '')::numeric,
            v_vd, v_vh, auth.uid());
    update products set updated_at = now() where id = v_prod.id;

    insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
    values (v_tenant, auth.uid(), 'ofertas', 'product', v_prod.id,
            jsonb_build_object('masiva', true, 'tramo', p_tramo));
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('aplicados', v_n, 'omitidos', v_omitidos);
end $$;

-- ---------------------------------------------------------------------------
-- fn_quitar_ofertas — todas las ofertas de esos productos
-- ---------------------------------------------------------------------------
create or replace function public.fn_quitar_ofertas(p_productos uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_id     uuid;
  v_n      integer := 0;
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor') or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  for v_id in
    select p.id from products p
     where p.tenant_id = v_tenant and p.id = any(coalesce(p_productos, '{}'))
       and exists (select 1 from product_price_tiers t where t.product_id = p.id)
     order by p.id
       for update
  loop
    delete from product_price_tiers where product_id = v_id;
    update products set updated_at = now() where id = v_id;
    insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
    values (v_tenant, auth.uid(), 'ofertas', 'product', v_id,
            jsonb_build_object('masiva', true, 'tramos', '[]'::jsonb));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- fn_guardar_configuracion — igual que 0018, más `ofertas_activas`
-- ---------------------------------------------------------------------------
-- `ofertas_pausadas_desde` no se acepta de la pantalla: lo pone esta función
-- al apagar, con la hora de la base.
create or replace function public.fn_guardar_configuracion(p_cambios jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_antes  jsonb;
  v_nuevo  jsonb := '{}'::jsonb;
  v_clave  text;
  v_valor  jsonb;
  v_num    numeric;
begin
  if coalesce(current_user_role()::text, '') <> 'admin' or not is_active_user() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'CONFIGURACION_INVALIDA' using errcode = 'P0001';
  end if;

  for v_clave, v_valor in select * from jsonb_each(p_cambios) loop
    case v_clave
      when 'vender_sin_stock', 'tarjeta_emite_documento', 'ofertas_activas' then
        if jsonb_typeof(v_valor) <> 'boolean' then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
      when 'efectivo_inicial_sugerido', 'cash_alert_hours', 'cost_variation_alert_pct' then
        if jsonb_typeof(v_valor) <> 'number' then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
        v_num := (v_valor #>> '{}')::numeric;
        if v_num < 0 or v_num <> trunc(v_num)
           or (v_clave = 'efectivo_inicial_sugerido' and v_num > 5000000)
           or (v_clave = 'cash_alert_hours' and (v_num < 1 or v_num > 72))
           or (v_clave = 'cost_variation_alert_pct' and (v_num < 1 or v_num > 100)) then
          raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
        end if;
      else
        raise exception 'CONFIGURACION_INVALIDA: %', v_clave using errcode = 'P0001';
    end case;
    v_nuevo := v_nuevo || jsonb_build_object(v_clave, v_valor);
  end loop;

  select settings into v_antes from tenants where id = v_tenant for update;
  update tenants set settings = coalesce(settings, '{}'::jsonb) || v_nuevo where id = v_tenant;

  -- Apagar anota desde cuándo; volver a encender lo borra. Apagar dos veces
  -- no mueve la hora: las ventas sin conexión de entremedio ya eran sin oferta.
  if v_nuevo ? 'ofertas_activas' then
    if (v_nuevo->>'ofertas_activas')::boolean then
      update tenants set settings = settings - 'ofertas_pausadas_desde' where id = v_tenant;
    elsif coalesce((v_antes->>'ofertas_activas')::boolean, true) then
      update tenants set settings = settings || jsonb_build_object('ofertas_pausadas_desde', now())
       where id = v_tenant;
    end if;
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, auth.uid(), 'editar', 'configuracion', v_tenant, v_antes, v_nuevo);
  return (select settings from tenants where id = v_tenant);
end $$;

-- ---------------------------------------------------------------------------
-- fn_register_sale — igual que 0019, con el interruptor de ofertas
-- ---------------------------------------------------------------------------
-- Misma firma: reemplazo, no sobrecarga (regla 21). Lo único distinto es el
-- precio que corresponde: con las ofertas apagadas es el precio normal, salvo
-- para lo vendido antes de apagarlas (una venta sin conexión que llega tarde).
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
                     receptor_giro, receptor_direccion)
  values (v_tenant, v_store, v_folio, v_session, v_user,
          coalesce(p_sold_at, now()), now(), p_client_uuid, p_notes,
          coalesce(p_discount_total,0),
          v_doc, v_rut, v_razon,
          nullif(trim(p_document->>'giro'), ''),
          nullif(trim(p_document->>'direccion'), ''))
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
    v_ref := least(v_lista, v_entonces);

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
  if v_desc + v_implicito > 0 then
    select coalesce(max_discount_pct, 0) into v_tope from profiles where id = v_user;
    -- El porcentaje se mide contra lo que correspondía cobrar, no contra lo
    -- que se cobró: si no, bajar el precio achicaría la base del tope.
    if not fn_discount_within_limit(v_desc + v_implicito, greatest(v_bruto_ref, v_bruto), v_tope) then
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

  if v_paid <> v_sum then
    raise exception 'PAGO_NO_CUADRA' using errcode = 'P0001';
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
         impuestos_detalle     = v_des->'detalle'
   where id = v_sale;

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
    'dte', v_dte);
end $$;


-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- Regla 12: se revoca a `public`. Las internas no se exponen a nadie.
revoke execute on function public.fn_precio_tramo(integer, integer, numeric)          from public, anon, authenticated;
revoke execute on function public.fn_precio_por_cantidad(uuid, integer, numeric, date) from public, anon, authenticated;
revoke execute on function public.fn_ofertas_rigen(uuid, timestamptz)                 from public, anon, authenticated;
revoke execute on function public.fn_problema_tramo(jsonb, integer)                   from public, anon, authenticated;

revoke execute on function public.fn_aplicar_oferta_masiva(uuid[], jsonb)  from public, anon;
revoke execute on function public.fn_quitar_ofertas(uuid[])                from public, anon;
revoke execute on function public.fn_guardar_precios_producto(uuid, jsonb) from public, anon;
revoke execute on function public.fn_guardar_configuracion(jsonb)          from public, anon;
grant  execute on function public.fn_aplicar_oferta_masiva(uuid[], jsonb)  to authenticated;
grant  execute on function public.fn_quitar_ofertas(uuid[])                to authenticated;
grant  execute on function public.fn_guardar_precios_producto(uuid, jsonb) to authenticated;
grant  execute on function public.fn_guardar_configuracion(jsonb)          to authenticated;
