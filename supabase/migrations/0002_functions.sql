-- ============================================================================
-- RutaAhorro · 0002 · Funciones
-- Helpers de seguridad + operaciones transaccionales. Ver docs/08-api-contratos.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers de seguridad
-- SECURITY DEFINER a propósito: evita la recursión infinita de una política RLS
-- sobre profiles que necesita leer profiles.
-- ---------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select tenant_id from profiles where id = auth.uid() $$;

create or replace function public.current_user_role()
returns user_role
language sql stable security definer set search_path = public
as $$ select role from profiles where id = auth.uid() $$;

create or replace function public.current_store_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select store_id from profiles where id = auth.uid() $$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select is_active from profiles where id = auth.uid()), false) $$;

-- ---------------------------------------------------------------------------
-- Alta automática de perfil al crear usuario en auth.users
-- El tenant_id y el rol llegan en raw_user_meta_data desde la invitación.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid;
  v_store  uuid;
  v_role   user_role;
begin
  v_tenant := nullif(new.raw_user_meta_data->>'tenant_id','')::uuid;
  v_store  := nullif(new.raw_user_meta_data->>'store_id','')::uuid;
  v_role   := coalesce(nullif(new.raw_user_meta_data->>'role',''),'vendedor')::user_role;

  -- Sin tenant asignado no se crea perfil: el usuario queda sin acceso
  -- hasta que un admin lo vincule. Es deliberado.
  if v_tenant is null then
    return new;
  end if;

  insert into profiles (id, tenant_id, store_id, full_name, email, role, max_discount_pct)
  values (
    new.id, v_tenant, v_store,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    new.email, v_role,
    case v_role when 'admin' then 100 when 'supervisor' then 10 else 0 end
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- fn_next_folio — correlativo por tenant
-- ---------------------------------------------------------------------------
create or replace function public.fn_next_folio(p_tenant uuid)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare v_folio bigint;
begin
  insert into folio_counters (tenant_id, last_folio)
  values (p_tenant, 1)
  on conflict (tenant_id) do update
    set last_folio = folio_counters.last_folio + 1
  returning last_folio into v_folio;
  return v_folio;
end $$;

-- ---------------------------------------------------------------------------
-- fn_post_movement — ÚNICA puerta de entrada al kardex
-- Calcula el saldo, inserta el movimiento y actualiza la caché stock_levels.
-- Nada más debe escribir en inventory_movements ni en stock_levels.
-- ---------------------------------------------------------------------------
create or replace function public.fn_post_movement(
  p_tenant uuid, p_store uuid, p_product uuid,
  p_type movement_type, p_quantity numeric, p_unit_cost integer,
  p_ref_type text, p_ref_id uuid, p_reason text, p_user uuid
) returns numeric
language plpgsql security definer set search_path = public
as $$
declare v_balance numeric(14,3);
begin
  insert into stock_levels (tenant_id, store_id, product_id, quantity, updated_at)
  values (p_tenant, p_store, p_product, p_quantity, now())
  on conflict (tenant_id, store_id, product_id) do update
    set quantity = stock_levels.quantity + excluded.quantity,
        updated_at = now()
  returning quantity into v_balance;

  insert into inventory_movements (
    tenant_id, store_id, product_id, movement_type, quantity,
    balance_after, unit_cost, reference_type, reference_id, reason, created_by)
  values (
    p_tenant, p_store, p_product, p_type, p_quantity,
    v_balance, coalesce(p_unit_cost,0), p_ref_type, p_ref_id, p_reason, p_user);

  return v_balance;
end $$;

-- ---------------------------------------------------------------------------
-- fn_register_sale — registro transaccional de una venta (RF-M5-12)
-- ---------------------------------------------------------------------------
create or replace function public.fn_register_sale(
  p_client_uuid    uuid,
  p_items          jsonb,     -- [{product_id, quantity, unit_price, discount_amount}]
  p_payments       jsonb,     -- [{method, amount, received_amount}]
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
  v_qty       numeric(14,3);
  v_price     integer;
  v_disc      integer;
  v_subtotal  integer;
  v_sum       integer := 0;
  v_paid      integer := 0;
  v_change    integer := 0;
  v_stock     numeric(14,3);
  v_iva       numeric;
  v_existing  sales%rowtype;
begin
  if v_tenant is null or not is_active_user() then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;

  -- Idempotencia: un reenvío tras corte de red NO es un error (US-15)
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

  select id, store_id into v_session, v_store
    from cash_sessions
   where user_id = v_user and status = 'abierta'
   limit 1;
  if v_session is null then
    raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
  end if;

  v_folio := fn_next_folio(v_tenant);

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
    v_subtotal := round(v_qty * v_price)::integer - v_disc;
    v_sum := v_sum + v_subtotal;

    -- Stock insuficiente: el vendedor no puede forzar; admin y supervisor sí.
    -- Ver ADR-005: offline se permite y se alerta, no se bloquea la venta.
    select quantity into v_stock from stock_levels
     where tenant_id = v_tenant and store_id = v_store and product_id = v_product.id;
    if coalesce(v_stock,0) < v_qty
       and not p_force
       and coalesce(v_role::text, '') not in ('admin','supervisor') then
      raise exception 'STOCK_INSUFICIENTE: %', v_product.name using errcode = 'P0001';
    end if;

    insert into sale_items (sale_id, tenant_id, product_id, product_name,
                            quantity, unit_price, unit_cost, discount_amount, subtotal)
    values (v_sale, v_tenant, v_product.id, v_product.name,
            v_qty, v_price, v_product.avg_cost, v_disc, v_subtotal);

    perform fn_post_movement(v_tenant, v_store, v_product.id, 'venta',
                             -v_qty, v_product.avg_cost, 'sale', v_sale, null, v_user);
  end loop;

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
     set subtotal   = v_sum + coalesce(p_discount_total,0),
         total      = v_sum,
         tax_amount = round(v_sum - (v_sum / (1 + v_iva/100.0)))::integer
   where id = v_sale;

  return jsonb_build_object(
    'sale_id', v_sale, 'folio', v_folio, 'total', v_sum,
    'change_amount', v_change, 'sold_at', coalesce(p_sold_at, now()),
    'synced_at', now(), 'already_existed', false);
end $$;

-- ---------------------------------------------------------------------------
-- fn_void_sale — anulación (RF-M5-15). Nada se borra.
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

  select * into v_sale from sales where id = p_sale_id and tenant_id = v_tenant;
  if not found then raise exception 'VENTA_NO_ENCONTRADA' using errcode = 'P0001'; end if;
  if v_sale.status = 'anulada' then
    raise exception 'VENTA_YA_ANULADA' using errcode = 'P0001';
  end if;

  -- Supervisor solo anula ventas del día; días anteriores requieren admin
  if coalesce(v_role::text, '') not in ('admin','supervisor') then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
  end if;
  if v_role = 'supervisor' and v_sale.sold_at::date <> (now() at time zone 'America/Santiago')::date then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
  end if;

  for v_item in select * from sale_items where sale_id = p_sale_id loop
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
-- fn_confirm_receipt — recepción + costo promedio ponderado (RF-M3-06)
-- ---------------------------------------------------------------------------
create or replace function public.fn_confirm_receipt(
  p_supplier_id     uuid,
  p_items           jsonb,   -- [{product_id, quantity, unit_cost}]
  p_document_type   text default 'guia',
  p_document_number text default null,
  p_received_at     timestamptz default now(),
  p_notes           text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_store  uuid := current_store_id();
  v_receipt uuid;
  v_item   jsonb;
  v_prod   products%rowtype;
  v_qty    numeric(14,3);
  v_cost   integer;
  v_stock  numeric(14,3);
  v_new_avg integer;
  v_total  integer := 0;
  v_result jsonb := '[]'::jsonb;
begin
  -- El `coalesce` no es decorativo. `current_user_role()` devuelve NULL cuando
  -- el usuario no tiene perfil —el caso que produce `handle_new_user` si la
  -- invitación llegó sin `tenant_id`, que no es raro—, y `NULL not in (...)`
  -- no vale verdadero ni falso: vale NULL. Un `if` con NULL no entra. El
  -- guardia dejaba pasar justo a quien no tiene rol. Va igual en las ocho
  -- comprobaciones de este tipo que hay en el esquema.
  if coalesce(current_user_role()::text, '') not in ('admin','supervisor','bodega') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

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

    v_qty  := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::integer;
    v_total := v_total + round(v_qty * v_cost)::integer;

    select coalesce(quantity,0) into v_stock from stock_levels
     where tenant_id = v_tenant and store_id = v_store and product_id = v_prod.id;
    v_stock := coalesce(v_stock, 0);

    -- Costo promedio ponderado. Con stock <= 0 el promedio pasa a ser el costo
    -- de esta compra: promediar contra un stock negativo daría un número sin sentido.
    if v_stock <= 0 then
      v_new_avg := v_cost;
    else
      v_new_avg := round(((v_stock * v_prod.avg_cost) + (v_qty * v_cost))
                         / (v_stock + v_qty))::integer;
    end if;

    insert into purchase_receipt_items (receipt_id, tenant_id, product_id,
                                        quantity, unit_cost, subtotal)
    values (v_receipt, v_tenant, v_prod.id, v_qty, v_cost,
            round(v_qty * v_cost)::integer);

    update products set avg_cost = v_new_avg, last_cost = v_cost, updated_at = now()
     where id = v_prod.id;

    perform fn_post_movement(v_tenant, v_store, v_prod.id, 'recepcion',
                             v_qty, v_cost, 'purchase_receipt', v_receipt, null, v_user);

    v_result := v_result || jsonb_build_object(
      'product_id', v_prod.id, 'product_name', v_prod.name,
      'old_avg_cost', v_prod.avg_cost, 'new_avg_cost', v_new_avg);
  end loop;

  update purchase_receipts set total_amount = v_total where id = v_receipt;

  return jsonb_build_object('receipt_id', v_receipt, 'total_amount', v_total,
                            'items', v_result);
end $$;

-- ---------------------------------------------------------------------------
-- fn_void_receipt — anulación de recepción (RF-M3-09)
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
   where id = p_receipt_id and tenant_id = v_tenant;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_rec.status = 'anulada' then
    raise exception 'RECEPCION_YA_ANULADA' using errcode = 'P0001';
  end if;

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
-- fn_adjust_stock — ajuste con motivo obligatorio (RF-M4-04)
-- ---------------------------------------------------------------------------
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

  select coalesce(quantity,0) into v_current from stock_levels
   where tenant_id = v_tenant and store_id = v_store and product_id = p_product_id;
  v_current := coalesce(v_current, 0);
  v_delta := p_new_quantity - v_current;

  if v_delta = 0 then
    return jsonb_build_object('product_id', p_product_id, 'quantity', v_current,
                              'changed', false);
  end if;

  select avg_cost into v_cost from products where id = p_product_id;

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
-- Caja
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
  if exists (select 1 from cash_sessions where user_id = v_user and status = 'abierta') then
    raise exception 'CAJA_YA_ABIERTA' using errcode = 'P0001';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  insert into cash_sessions (tenant_id, store_id, user_id, opening_amount)
  values (v_tenant, v_store, v_user, greatest(coalesce(p_opening_amount,0),0))
  returning id into v_id;

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

  select id into v_session from cash_sessions
   where user_id = v_user and status = 'abierta' limit 1;
  if v_session is null then
    raise exception 'CAJA_NO_ABIERTA' using errcode = 'P0001';
  end if;

  insert into cash_movements (tenant_id, cash_session_id, type, amount, reason, created_by)
  values (v_tenant, v_session, p_type, p_amount, p_reason, v_user)
  returning id into v_id;

  return jsonb_build_object('movement_id', v_id);
end $$;

-- Resumen de una sesión de caja. Lo usan el cierre y la pantalla de caja.
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
begin
  select * into v_s from cash_sessions
   where id = p_session_id and tenant_id = current_tenant_id();
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;

  select coalesce(sum(sp.amount),0) into v_cash_sales
    from sale_payments sp join sales s on s.id = sp.sale_id
   where s.cash_session_id = p_session_id and s.status = 'completada'
     and sp.method = 'efectivo';

  select coalesce(sum(amount),0) into v_in from cash_movements
   where cash_session_id = p_session_id and type = 'ingreso';
  select coalesce(sum(amount),0) into v_out from cash_movements
   where cash_session_id = p_session_id and type = 'egreso';

  select count(*), coalesce(sum(total),0) into v_count, v_total
    from sales where cash_session_id = p_session_id and status = 'completada';

  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) into v_methods from (
    select sp.method::text as method, sum(sp.amount) as amt
      from sale_payments sp join sales s on s.id = sp.sale_id
     where s.cash_session_id = p_session_id and s.status = 'completada'
     group by sp.method) t;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', v_s.status,
    'opened_at', v_s.opened_at,
    'opening_amount', v_s.opening_amount,
    'cash_sales', v_cash_sales,
    'cash_in', v_in,
    'cash_out', v_out,
    'expected_amount', v_s.opening_amount + v_cash_sales + v_in - v_out,
    'counted_amount', v_s.counted_amount,
    'difference', v_s.difference,
    'sales_count', v_count,
    'sales_total', v_total,
    'average_ticket', case when v_count > 0 then round(v_total::numeric / v_count)::integer else 0 end,
    'by_payment_method', v_methods);
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
  select * into v_s from cash_sessions where id = p_session_id and tenant_id = v_tenant;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_s.status = 'cerrada' then
    raise exception 'CAJA_YA_CERRADA' using errcode = 'P0001';
  end if;
  if v_s.user_id <> v_user and coalesce(v_role::text, '') not in ('admin','supervisor') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  v_summary  := fn_cash_session_summary(p_session_id);
  v_expected := (v_summary->>'expected_amount')::integer;

  -- RF-M6-06: sin comentario no se cierra una caja descuadrada
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
-- fn_apply_stock_count — toma de inventario (RF-M4-05)
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

  select * into v_count from stock_counts where id = p_count_id and tenant_id = v_tenant;
  if not found then raise exception 'NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_count.status <> 'en_progreso' then
    raise exception 'TOMA_YA_APLICADA' using errcode = 'P0001';
  end if;

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
      select avg_cost into v_cost from products where id = (v_item->>'product_id')::uuid;
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
-- fn_rebuild_stock_levels — reconstruir la caché desde el kardex (§5.4)
-- Red de seguridad que justifica tener una tabla derivada.
-- ---------------------------------------------------------------------------
create or replace function public.fn_rebuild_stock_levels(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_fixed integer := 0;
begin
  with real as (
    select tenant_id, store_id, product_id, sum(quantity) as qty
      from inventory_movements where tenant_id = p_tenant
     group by 1,2,3
  ), upd as (
    update stock_levels sl
       set quantity = r.qty, updated_at = now()
      from real r
     where sl.tenant_id = r.tenant_id and sl.store_id = r.store_id
       and sl.product_id = r.product_id and sl.quantity <> r.qty
    returning 1
  )
  select count(*) into v_fixed from upd;

  return jsonb_build_object('tenant_id', p_tenant, 'corrected', v_fixed);
end $$;
