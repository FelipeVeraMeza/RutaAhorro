-- =============================================================================
-- 0040 · Revisión del 2026-10-11 (docs/32): caja, ajustes, toma y lotes
-- =============================================================================
-- Todas con la MISMA firma que ya tenían (create or replace): la pantalla no
-- cambia y se puede aplicar antes o después de publicar el código. Idempotente.
--
--   1. La caja: abrirla, moverla y cerrarla exige una cuenta activa (un
--      administrador desactivado con la sesión abierta seguía moviendo plata),
--      montos en rango y nada negativo al contar. Bodega no abre caja.
--   2. Ajuste y toma: cantidades enteras y no negativas (0032 dejó todo por
--      unidad, pero un "0,5" o un "-3" llegaban igual por la API) y un
--      producto de OTRO local se rechaza en vez de crearle stock acá.
--   3. Ajuste negativo, merma y toma a la baja descuentan de los lotes, del que
--      vence antes (FEFO). Antes los lotes no se tocaban: "Vencimientos" seguía
--      mostrando mercadería que ya se había botado o que no estaba.
--   4. Una venta con la hora del celular adelantada (más de 5 minutos en el
--      futuro) queda con la hora del servidor: salía en los reportes de mañana.
--   5. Vencimientos con el día del local, no el de UTC (v_expiring_lots y el
--      "ya vencido" al recibir).
--   6. Anular una venta, anular una recepción y editar un producto también
--      exigen una cuenta activa (eran las únicas escrituras que no lo hacían).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Caja
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
  -- Bodega no tiene caja ni ve dinero (matriz del doc 02). La pantalla ya lo
  -- impedía; la base no.
  if coalesce(current_user_role()::text, '') = 'bodega' then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if coalesce(p_opening_amount, 0) < 0 or coalesce(p_opening_amount, 0) > 5000000 then
    raise exception 'MONTO_INVALIDO' using errcode = 'P0001';
  end if;
  if exists (select 1 from cash_sessions where user_id = v_user and status = 'abierta') then
    raise exception 'CAJA_YA_ABIERTA' using errcode = 'P0001';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  begin
    insert into cash_sessions (tenant_id, store_id, user_id, opening_amount)
    values (v_tenant, v_store, v_user, coalesce(p_opening_amount, 0))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'CAJA_YA_ABIERTA' using errcode = 'P0001';
  end;

  return jsonb_build_object('session_id', v_id, 'opening_amount', coalesce(p_opening_amount, 0));
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
  -- 0040 · Sin esto, una cuenta desactivada con la sesión abierta seguía
  -- registrando ingresos y egresos.
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if coalesce(p_amount,0) <= 0 or p_amount > 50000000 then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;

  select id into v_session from cash_sessions
   where user_id = v_user and status = 'abierta' limit 1 for share;
  if v_session is null then
    raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
  end if;

  insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
  values (v_tenant, v_session, p_type, p_amount, left(trim(p_reason), 300), v_user)
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
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  -- Contar no da negativo: un "-5000" dejaba el arqueo con un faltante falso.
  if p_counted_amount is null or p_counted_amount < 0 or p_counted_amount > 50000000 then
    raise exception 'MONTO_INVALIDO' using errcode = 'P0001';
  end if;

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
-- 2 y 3 · Ajuste y toma de inventario
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
  v_lotes  boolean;
begin
  p_ubicacion := 'sala';
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO_AJUSTAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_movement_type not in ('ajuste_positivo','ajuste_negativo','merma','inventario_inicial') then
    raise exception 'TIPO_MOVIMIENTO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 or p_new_quantity > 1000000 then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;
  if p_new_quantity <> trunc(p_new_quantity) then
    raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001';
  end if;

  -- El producto tiene que ser de este local ANTES de tocar el stock.
  select avg_cost, tracks_expiry into v_cost, v_lotes from products
   where id = p_product_id and tenant_id = v_tenant;
  if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

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

  perform fn_post_movement(v_tenant, v_store, p_product_id, p_movement_type,
                           v_delta, v_cost, 'adjustment', null, p_reason, v_user);

  -- 0040 · Lo que sale de un perecible sale de sus lotes, del que vence antes.
  if v_lotes and v_delta < 0 then
    perform fn_consume_lots(v_tenant, v_store, p_product_id, -v_delta, null);
  end if;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_tenant, v_user, 'stock_adjustment', 'products', p_product_id,
          jsonb_build_object('quantity', v_current),
          jsonb_build_object('quantity', p_new_quantity, 'reason', p_reason,
                             'type', p_movement_type));

  return jsonb_build_object('product_id', p_product_id, 'quantity', p_new_quantity,
                            'delta', v_delta, 'changed', true);
end $$;

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
  v_prod   uuid;
  v_sys    numeric(14,3);
  v_counted numeric(14,3);
  v_delta  numeric(14,3);
  v_cost   integer;
  v_lotes  boolean;
  v_diffs  jsonb := '[]'::jsonb;
  v_value  integer := 0;
begin
  p_ubicacion := 'sala';
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select * into v_count from stock_counts
   where id = p_count_id and tenant_id = v_tenant for update;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_count.status <> 'en_progreso' then
    raise exception 'TOMA_YA_APLICADA' using errcode = 'P0001';
  end if;

  -- Todo se revisa antes de mover nada: una línea mala no deja la toma a medias.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
     where nullif(x->>'counted_qty', '') is null
        or (x->>'counted_qty')::numeric < 0
        or (x->>'counted_qty')::numeric > 1000000
        or (x->>'counted_qty')::numeric <> trunc((x->>'counted_qty')::numeric)
  ) then
    raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
     where not exists (select 1 from products p
                        where p.id = (x->>'product_id')::uuid and p.tenant_id = v_tenant)
  ) then
    raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  perform fn_lock_stock(v_tenant, v_count.store_id, array(
    select (x->>'product_id')::uuid from jsonb_array_elements(p_items) x));

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod := (v_item->>'product_id')::uuid;
    v_counted := (v_item->>'counted_qty')::numeric;

    select coalesce(quantity,0) into v_sys from stock_ubicaciones
     where store_id = v_count.store_id and ubicacion = p_ubicacion
       and product_id = v_prod;
    v_sys := coalesce(v_sys, 0);
    v_delta := v_counted - v_sys;

    insert into stock_count_items (count_id, tenant_id, product_id, system_qty, counted_qty)
    values (p_count_id, v_tenant, v_prod, v_sys, v_counted)
    on conflict (count_id, product_id) do update
      set system_qty = excluded.system_qty, counted_qty = excluded.counted_qty;

    if v_delta <> 0 then
      select avg_cost, tracks_expiry into v_cost, v_lotes from products
       where id = v_prod and tenant_id = v_tenant;
      perform fn_post_movement(v_tenant, v_count.store_id,
                               v_prod, 'toma_inventario',
                               v_delta, v_cost, 'stock_count', p_count_id,
                               'Toma de inventario', v_user);
      if v_lotes and v_delta < 0 then
        perform fn_consume_lots(v_tenant, v_count.store_id, v_prod, -v_delta, null);
      end if;
      v_value := v_value + round(v_delta * coalesce(v_cost,0))::integer;
      v_diffs := v_diffs || jsonb_build_object(
        'product_id', v_prod,
        'system_qty', v_sys, 'counted_qty', v_counted, 'difference', v_delta);
    end if;
  end loop;

  update stock_counts set status = 'aplicada', applied_at = now() where id = p_count_id;

  return jsonb_build_object('count_id', p_count_id,
                            'differences', v_diffs,
                            'difference_value', v_value);
end $$;

-- ---------------------------------------------------------------------------
-- 4 · La hora de la venta no puede ser del futuro
-- ---------------------------------------------------------------------------
create or replace function public.fn_venta_sin_futuro()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.sold_at > now() + interval '5 minutes' then
    new.sold_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_venta_sin_futuro on sales;
create trigger trg_venta_sin_futuro
  before insert on sales
  for each row execute function public.fn_venta_sin_futuro();

revoke execute on function public.fn_venta_sin_futuro() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5 · El "hoy" de los vencimientos es el del local, no el de UTC (regla 17)
-- ---------------------------------------------------------------------------
-- Supabase corre en UTC: desde las 20:00 o 21:00 de Chile `current_date` ya es
-- mañana. Un lote que vence hoy salía "vencido" toda la noche (Inicio,
-- Inventario → Lotes, el aviso de Vender) y recibir un producto que vence hoy
-- se rechazaba con LOTE_YA_VENCIDO. Mismas columnas que 0010 (regla 22).
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

-- fn_confirm_receipt de 0012, con la misma firma; solo cambia el "hoy" del
-- LOTE_YA_VENCIDO.
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
    if v_expiry is not null and v_expiry < (now() at time zone fn_tenant_timezone(v_tenant))::date then
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
-- 6 · Cuenta activa para anular y editar
-- ---------------------------------------------------------------------------
-- Copia de 0019_documentos_tributarios.sql con la cuenta activa exigida al empezar.
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
  -- 0040 · Una cuenta desactivada con la sesión abierta no sigue operando.
  if not is_active_user() then
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

-- Copia de 0031_anular_recepcion_completa.sql con la cuenta activa exigida al empezar.
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
  -- 0040 · Una cuenta desactivada con la sesión abierta no sigue operando.
  if not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
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

-- Copia de 0020_producto_quien_y_cuando.sql con la cuenta activa exigida al empezar.
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
  -- 0040 · Una cuenta desactivada con la sesión abierta no sigue operando.
  if not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;
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
