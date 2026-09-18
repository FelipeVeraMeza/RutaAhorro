-- ============================================================================
-- 0012 · Lo que se escribe con una función no se escribe a mano
--
-- Encontrado el 2026-09-18 ejecutando el esquema por primera vez contra un
-- PostgreSQL real (tools/pg-test/seguridad.test.mjs). Hasta entonces el SQL
-- solo se había parseado.
--
-- Supabase le concede ALL sobre cada tabla de `public` a `authenticated`. Eso
-- significa que una política de INSERT o UPDATE no es un detalle de
-- configuración: es la puerta. Y 0004 dejó abiertas puertas que solo
-- comprobaban el tenant, en tablas que el diseño dice que solo se escriben
-- desde funciones. Con la consola del navegador y la sesión de un cajero:
--
--   · update cash_sessions set status = 'cerrada', expected_amount = 5000,
--            counted_amount = 5000 where id = <mi caja>
--     El cajero escribía su propio arqueo. El control contra el faltante de
--     caja lo llenaba la persona a la que controla.
--   · insert into cash_movements (..., type = 'egreso', created_by = <supervisor>)
--     Un egreso inventado baja el esperado, esconde el faltante y queda
--     firmado por otro.
--   · insert into sales / sale_payments / sale_items en la caja de otro cajero.
--   · insert into audit_log a nombre de cualquiera. La bitácora es inmutable:
--     lo inventado no se puede borrar después.
--   · insert into price_history: justo contra lo que T-14 va a comparar.
--   · Un supervisor: update sales set total = 1, o status = 'anulada' sin
--     devolver el stock y saltándose la regla de "solo ventas del día".
--   · Bodega: cambiar la cantidad de un lote sin kardex, reabrir una toma
--     aplicada para aplicarla otra vez, crear recepciones sin mercadería, y
--     cambiar el costo promedio a mano.
--
-- Ninguna de esas tablas la escribe la aplicación directamente (verificado en
-- apps/web y apps/worker): todas las escrituras pasan por funciones
-- `security definer`, que no necesitan estas políticas. Quitarlas no rompe
-- nada que funcione; cierra lo que no debía funcionar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Políticas de escritura que sobraban
-- ---------------------------------------------------------------------------
drop policy if exists sales_insert          on sales;
drop policy if exists sales_update          on sales;
drop policy if exists sale_items_insert     on sale_items;
drop policy if exists sale_payments_insert  on sale_payments;
drop policy if exists sale_item_lots_insert on sale_item_lots;
drop policy if exists cash_sessions_insert  on cash_sessions;
drop policy if exists cash_sessions_update  on cash_sessions;
drop policy if exists cash_mov_insert       on cash_movements;
drop policy if exists audit_insert          on audit_log;
drop policy if exists price_history_insert  on price_history;
drop policy if exists alerts_insert         on alerts;     -- el worker usa service_role
drop policy if exists receipts_insert       on purchase_receipts;
drop policy if exists receipt_items_insert  on purchase_receipt_items;
drop policy if exists lots_write            on product_lots;
drop policy if exists count_items_write     on stock_count_items;

-- La toma sí se crea desde la aplicación (lib/datos/inventario.ts), pero solo
-- se crea: aplicarla es fn_apply_stock_count. "for all" dejaba además
-- devolverla a en_progreso después de aplicada, y aplicarla otra vez.
drop policy if exists counts_write  on stock_counts;
drop policy if exists counts_insert on stock_counts;
create policy counts_insert on stock_counts for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and coalesce(current_user_role()::text, '') in ('admin','supervisor','bodega')
              and status = 'en_progreso');

-- Y además se quita el privilegio. Sin política RLS ya lo niega, pero si
-- alguien vuelve a escribir una política permisiva sobre estas tablas, el
-- privilegio faltante la sigue tapando. Dos candados, no uno.
revoke insert, update, delete on
  sales, sale_items, sale_payments, sale_item_lots,
  cash_sessions, cash_movements,
  audit_log, price_history,
  purchase_receipts, purchase_receipt_items,
  product_lots, stock_count_items,
  inventory_movements, stock_levels, folio_counters
from anon, authenticated;
revoke insert, delete on alerts from anon, authenticated;
revoke update, delete on stock_counts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · El costo de un producto lo escriben las recepciones, no una pantalla
-- ---------------------------------------------------------------------------
-- products_update sigue abierta para admin, supervisor y bodega porque la
-- aplicación desactiva y reactiva productos con un UPDATE directo. Pero RLS
-- trabaja por fila, así que con esa política también se podía escribir
-- `avg_cost`. Dentro de una función `security definer` el usuario efectivo es
-- el dueño del esquema; desde la API es `authenticated`. Eso es lo que
-- distingue "lo cambió una recepción" de "lo cambió alguien a mano".
create or replace function public.fn_guard_product_cost()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.avg_cost  is distinct from old.avg_cost
       or new.last_cost is distinct from old.last_cost
       or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_product_cost on products;
create trigger trg_guard_product_cost
  before update on products
  for each row execute function public.fn_guard_product_cost();

-- ---------------------------------------------------------------------------
-- 3 · anon no ejecuta nada
-- ---------------------------------------------------------------------------
-- 0009 les quitó `public` a las funciones de negocio, pero Supabase además le
-- concede EXECUTE directo a `anon` sobre toda función nueva. Todas fallaban
-- igual con NO_AUTENTICADO, pero eso es depender de que cada una lo compruebe
-- bien. Nadie sin sesión tiene nada que hacer acá.
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- ============================================================================
-- 4 · Concurrencia (T-40)
--
-- tools/pg-test/concurrencia.test.mjs fuerza cada carrera en su peor
-- intercalado. Ocho fallaban, todas con la misma forma: leer un estado sin
-- bloquearlo, decidir con lo leído, y escribir. Entre la lectura y la
-- escritura otra transacción cambia el estado y la decisión ya no vale.
--
--   CP-05  Dos personas aplican la misma toma: el ajuste se aplica dos veces.
--          La toma decía 7, el sistema quedaba en 4.
--   ·      Anular la misma venta dos veces: el stock vuelve dos veces.
--   ·      Anular la misma recepción dos veces, dar de baja el mismo lote
--          dos veces: lo mismo.
--   ·      Dos recepciones del mismo producto: la segunda calcula el costo
--          promedio con el valor de antes de la primera y lo pisa.
--   ·      Dos ajustes al mismo producto: "dejar en 7" dos veces dejaba 4.
--   CP-07  El supervisor cierra la caja mientras el cajero cobra: la venta
--          queda dentro de la caja cerrada y fuera del arqueo.
--   CP-08  Abrir caja desde dos dispositivos: la regla se cumplía (índice
--          único) pero el usuario recibía un error de restricción de la base.
--   CP-03b Un reintento offline que llega mientras el primer envío sigue en
--          curso: igual, error de restricción en vez de `already_existed`.
--          La cola lo marcaba como fallido y alguien volvía a cobrar.
--
-- El orden de los bloqueos importa: dos transacciones que bloquean las mismas
-- filas en distinto orden se bloquean mutuamente. Toda función que toca varias
-- filas de stock las bloquea primero, todas juntas, ordenadas por producto.
-- ============================================================================

create or replace function public.fn_lock_stock(p_tenant uuid, p_store uuid, p_products uuid[])
returns void
language sql
as $$
  select 1 from stock_levels
   where tenant_id = p_tenant and store_id = p_store and product_id = any(p_products)
   order by product_id
   for update;
$$;
revoke execute on function public.fn_lock_stock from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- fn_register_sale — igual que 0006, con tres cambios marcados
-- ---------------------------------------------------------------------------
create or replace function public.fn_register_sale(
  p_client_uuid    uuid,
  p_items          jsonb,
  p_payments       jsonb,
  p_sold_at        timestamptz default now(),
  p_discount_total integer   default 0,
  p_notes          text      default null,
  p_force          boolean   default false
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
      'already_existed', true);
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'VENTA_VACIA' using errcode = 'P0001';
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
                     sold_at, synced_at, client_uuid, notes, discount_total)
  values (v_tenant, v_store, v_folio, v_session, v_user,
          coalesce(p_sold_at, now()), now(), p_client_uuid, p_notes,
          coalesce(p_discount_total,0))
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
    if coalesce(v_stock,0) < v_qty and not p_force
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
    'synced_at', now(), 'already_existed', false);
end $$;

-- ---------------------------------------------------------------------------
-- fn_void_sale — igual que 0006, con la venta bloqueada antes de mirar su estado
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
begin
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;

  select * into v_sale from sales where id = p_sale_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VENTA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  if v_sale.status = 'anulada' then
    raise exception 'VENTA_YA_ANULADA' using errcode = 'P0001';
  end if;
  if coalesce(v_role::text, '') not in ('admin','supervisor') then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
  end if;
  if v_role = 'supervisor'
     and v_sale.sold_at::date <> (now() at time zone 'America/Santiago')::date then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
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

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, v_user, 'sale_void', 'sales', p_sale_id,
          jsonb_build_object('status','completada','total',v_sale.total),
          jsonb_build_object('status','anulada','reason',p_reason));

  return jsonb_build_object('sale_id', p_sale_id, 'status', 'anulada');
end $$;

-- ---------------------------------------------------------------------------
-- fn_confirm_receipt — igual que 0006, con los productos bloqueados antes de
-- leer su costo promedio
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
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
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
          p_document_number, coalesce(p_received_at, now()), p_notes, v_user)
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
    v_total   := v_total + round(v_qty * v_cost)::integer;

    if v_prod.tracks_expiry and v_expiry is null then
      raise exception 'VENCIMIENTO_REQUERIDO: %', v_prod.name using errcode = 'P0001';
    end if;
    if v_expiry is not null and v_expiry < current_date then
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
-- fn_void_receipt — igual que 0002, con la recepción bloqueada
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
begin
  if coalesce(current_user_role()::text, '') <> 'admin' then
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
    perform fn_post_movement(v_tenant, v_rec.store_id, v_item.product_id,
                             'anulacion_recepcion', -v_item.quantity, v_item.unit_cost,
                             'receipt_void', p_receipt_id, p_reason, v_user);
  end loop;

  update purchase_receipts
     set status = 'anulada', voided_by = v_user, voided_at = now(), void_reason = p_reason
   where id = p_receipt_id;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'receipt_void', 'purchase_receipts', p_receipt_id,
          jsonb_build_object('reason', p_reason));

  return jsonb_build_object('receipt_id', p_receipt_id, 'status', 'anulada');
end $$;

-- ---------------------------------------------------------------------------
-- fn_write_off_lot — igual que 0006, con el lote bloqueado
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
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
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
-- fn_adjust_stock — igual que 0002, con el stock bloqueado antes de leerlo
-- ---------------------------------------------------------------------------
-- El ajuste recibe la cantidad final ("dejar en 7") y calcula la diferencia
-- contra el stock actual. Sin bloqueo, dos ajustes simultáneos calculan la
-- diferencia contra el mismo stock y la aplican dos veces; y una venta que se
-- confirma entre la lectura y la escritura deja el stock en 6, no en 7.
create or replace function public.fn_adjust_stock(
  p_product_id uuid, p_new_quantity numeric,
  p_movement_type movement_type, p_reason text
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
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_AJUSTAR' using errcode = '42501';
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
  select coalesce(quantity,0) into v_current from stock_levels
   where tenant_id = v_tenant and store_id = v_store and product_id = p_product_id;
  v_current := coalesce(v_current, 0);
  v_delta := p_new_quantity - v_current;

  if v_delta = 0 then
    return jsonb_build_object('product_id', p_product_id, 'quantity', v_current,
                              'changed', false);
  end if;

  select avg_cost into v_cost from products where id = p_product_id and tenant_id = v_tenant;
  if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

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
-- fn_apply_stock_count — igual que 0002, con la toma bloqueada (CP-05)
-- ---------------------------------------------------------------------------
create or replace function public.fn_apply_stock_count(p_count_id uuid, p_items jsonb)
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
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
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

    select coalesce(quantity,0) into v_sys from stock_levels
     where tenant_id = v_tenant and store_id = v_count.store_id
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
-- Caja: abrir, mover, cerrar
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
-- Stock negativo siempre alerta (ADR-005)
-- ---------------------------------------------------------------------------
-- ADR-005 permite vender sin stock "y se alerta". El disparador de 0003 solo
-- alertaba al cruzar el mínimo, y exigía `min_stock > 0`: un producto sin
-- mínimo configurado —la mayoría, recién cargado el catálogo— podía quedar
-- en −5 sin que nadie se enterara.
create or replace function public.fn_low_stock_alert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_min numeric(14,3); v_name text;
begin
  select min_stock, name into v_min, v_name from products where id = new.product_id;

  if (v_min > 0 and new.quantity <= v_min
      and (tg_op = 'INSERT' or old.quantity > v_min))
  or (new.quantity < 0
      and (tg_op = 'INSERT' or old.quantity >= 0)) then
    insert into alerts (tenant_id, type, severity, payload)
    values (new.tenant_id, 'low_stock',
            case when new.quantity <= 0 then 'critical' else 'warning' end,
            jsonb_build_object('product_id', new.product_id, 'product_name', v_name,
                               'quantity', new.quantity, 'min_stock', v_min));
  end if;
  return new;
end $$;

-- `create or replace` conserva los permisos de las funciones que ya existían.
-- La única nueva que se podría llamar es el disparador, que no es una RPC,
-- pero se cierra igual para que la lista de lo ejecutable no dependa de eso.
revoke execute on function public.fn_guard_product_cost from public, anon, authenticated;
