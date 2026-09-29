-- ============================================================================
-- 0017 · Respuestas del cuestionario (2026-09-26) y la vista del vendedor
--
-- (1) products_public no tenía las columnas de vencimiento.
--     La vista se creó en 0004 para que un vendedor no reciba costos.
--     `tracks_expiry` y `expiry_alert_days` llegaron a `products` en 0006 y
--     nunca se agregaron a la vista. La pantalla Productos las pide, así que a
--     un vendedor la lista le respondía 400 y quedaba vacía. En la maqueta no
--     se notaba: no pasa por la base. Lo encontró `tools/ui/movil.mjs`.
--
-- (2) Vender sin stock registrado (respuesta 13: «sí»).
--     Hasta ahora solo admin y supervisor. El cliente dice que se vende lo que
--     está físicamente aunque el sistema diga cero, y en un local con un solo
--     cajón el que atiende suele ser cualquiera. Queda como parámetro del local,
--     `tenants.settings.vender_sin_stock`, porque es una política del negocio y
--     no una regla del sistema (regla 13). Vender en negativo sigue generando
--     la alerta de 0012, así que el dueño se entera.
--
-- (3) Efectivo inicial sugerido (respuesta 23: «20.000 y monedas»).
--     `tenants.settings.efectivo_inicial_sugerido`. La base no lo usa: es lo
--     que la pantalla de Caja propone al abrir. Se guarda acá para que viva en
--     el mismo lugar que el resto de la configuración del local.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) La vista sin costos, con todo lo que la pantalla pide
-- ---------------------------------------------------------------------------
-- `create or replace view` solo permite agregar columnas al final. Y 0025 le
-- agrega `updated_by`: reaplicar esta migración sobre una base instalada
-- quitaría esa columna y fallaría (regla 22), así que se borra antes.
drop view if exists products_public;
create or replace view products_public
with (security_invoker = true) as
  select id, tenant_id, sku, name, description, category_id, unit,
         sale_price, min_stock, image_url, is_active, created_at, updated_at,
         tracks_expiry, expiry_alert_days
    from products;

-- ---------------------------------------------------------------------------
-- (2) fn_register_sale — igual que 0015, con la política del local
-- ---------------------------------------------------------------------------
-- Misma firma que 0015: es un reemplazo, no una sobrecarga (regla 21).
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
    return jsonb_build_object(
      'sale_id', v_existing.id, 'folio', v_existing.folio,
      'total', v_existing.total, 'change_amount', 0,
      'sold_at', v_existing.sold_at, 'synced_at', v_existing.synced_at,
      'already_existed', true, 'document_type', v_existing.document_type);
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
    v_price := coalesce((v_item->>'unit_price')::integer, v_product.sale_price);
    v_disc  := coalesce((v_item->>'discount_amount')::integer, 0);
    if v_disc < 0 then
      raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
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
                            quantity, unit_price, unit_cost, discount_amount, subtotal)
    values (v_sale, v_tenant, v_product.id, v_product.name,
            v_qty, v_price, v_product.avg_cost, v_disc, v_subtotal)
    returning id into v_item_id;

    if v_product.tracks_expiry then
      perform fn_consume_lots(v_tenant, v_store, v_product.id, v_qty, v_item_id);
    end if;

    perform fn_post_movement(v_tenant, v_store, v_product.id, 'venta',
                             -v_qty, v_product.avg_cost, 'sale', v_sale, null, v_user);
  end loop;

  v_desc := v_desc + coalesce(p_discount_total, 0);
  if v_desc > 0 then
    select coalesce(max_discount_pct, 0) into v_tope from profiles where id = v_user;
    if not fn_discount_within_limit(v_desc, v_bruto, v_tope) then
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

  update sales
     set subtotal   = v_bruto,
         discount_total = v_desc,
         total      = v_sum,
         tax_amount = round(v_sum - (v_sum / (1 + v_iva/100.0)))::integer
   where id = v_sale;

  return jsonb_build_object(
    'sale_id', v_sale, 'folio', v_folio, 'total', v_sum,
    'change_amount', v_change, 'sold_at', coalesce(p_sold_at, now()),
    'synced_at', now(), 'already_existed', false,
    'document_type', v_doc);
end $$;

-- ---------------------------------------------------------------------------
-- (2) y (3) Valores del local
-- ---------------------------------------------------------------------------
-- Solo donde no están: si el dueño ya decidió otra cosa, reinstalar no se la
-- pisa. `true` y 20000 son las respuestas de este cliente; un local nuevo que
-- no quiera vender sin stock lo pone en false.
update tenants
   set settings = coalesce(settings, '{}'::jsonb)
                  || jsonb_build_object('vender_sin_stock', true)
 where not (coalesce(settings, '{}'::jsonb) ? 'vender_sin_stock');

update tenants
   set settings = coalesce(settings, '{}'::jsonb)
                  || jsonb_build_object('efectivo_inicial_sugerido', 20000)
 where not (coalesce(settings, '{}'::jsonb) ? 'efectivo_inicial_sugerido');

-- Un local creado después de esta migración (instalar.sql crea el local al
-- final, y `db:limpiar` reinstala) nacería sin estas claves: el update de
-- arriba no lo alcanza. Por eso también van en el valor por omisión.
alter table tenants alter column settings set default jsonb_build_object(
  'iva_pct', 19,
  'timezone', 'America/Santiago',
  'currency', 'CLP',
  'max_discount_pct', jsonb_build_object(
    'admin', 100, 'supervisor', 10, 'vendedor', 0, 'bodega', 0),
  'cash_alert_hours', 12,
  'cost_variation_alert_pct', 20,
  'tarjeta_emite_documento', true,
  'vender_sin_stock', true,
  'efectivo_inicial_sugerido', 20000
);
