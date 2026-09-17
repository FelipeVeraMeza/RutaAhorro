-- ============================================================================
-- RutaAhorro · 0006 · Lotes y fecha de vencimiento
-- Responde la pregunta P-07: el local SÍ maneja productos perecibles.
--
-- Decisión de diseño: el control por lote es OPT-IN por producto
-- (products.tracks_expiry). Un paquete de fideos no necesita lote; un lácteo
-- sí. Obligar a todo el catálogo a llevar lote encarecería cada recepción y
-- cada venta para resolver un problema que afecta a una fracción del catálogo.
--
-- Decisión de diseño: el cajero NUNCA elige el lote. La venta consume FEFO
-- (First Expired, First Out) automáticamente. Pedirle al cajero que elija lote
-- destruiría el objetivo de vender en menos de 10 segundos (OP-1).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Marca en el producto
-- ---------------------------------------------------------------------------
alter table products
  add column if not exists tracks_expiry boolean not null default false,
  add column if not exists expiry_alert_days integer not null default 30
    check (expiry_alert_days >= 0);

comment on column products.tracks_expiry is
  'Si es true, el stock se lleva por lote con fecha de vencimiento (FEFO).';
comment on column products.expiry_alert_days is
  'Días de anticipación con que se alerta el vencimiento de un lote.';

-- ---------------------------------------------------------------------------
-- Lotes
-- ---------------------------------------------------------------------------
create table if not exists product_lots (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  lot_code     text,
  expiry_date  date not null,
  quantity     numeric(14,3) not null default 0,
  unit_cost    integer not null default 0,
  received_at  timestamptz not null default now(),
  receipt_id   uuid references purchase_receipts(id) on delete set null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (tenant_id, store_id, product_id, lot_code, expiry_date)
);

create index if not exists idx_lots_fefo
  on product_lots (tenant_id, store_id, product_id, expiry_date asc)
  where is_active and quantity > 0;
create index if not exists idx_lots_expiry
  on product_lots (tenant_id, expiry_date)
  where is_active and quantity > 0;

-- Qué lote consumió cada línea de venta: sin esto, anular una venta no podría
-- devolver las unidades al lote correcto.
create table if not exists sale_item_lots (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  sale_item_id  uuid not null references sale_items(id) on delete cascade,
  lot_id        uuid not null references product_lots(id) on delete restrict,
  quantity      numeric(14,3) not null check (quantity > 0)
);
create index if not exists idx_sale_item_lots_item on sale_item_lots(sale_item_id);

-- El kardex referencia el lote cuando aplica
alter table inventory_movements
  add column if not exists lot_id uuid references product_lots(id) on delete set null;

alter table purchase_receipt_items
  add column if not exists lot_code    text,
  add column if not exists expiry_date date;

-- ---------------------------------------------------------------------------
-- fn_consume_lots — descuenta FEFO y devuelve qué lotes se usaron
-- ---------------------------------------------------------------------------
create or replace function public.fn_consume_lots(
  p_tenant uuid, p_store uuid, p_product uuid,
  p_quantity numeric, p_sale_item_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_pending numeric(14,3) := p_quantity;
  v_take    numeric(14,3);
  v_lot     record;
  v_used    jsonb := '[]'::jsonb;
begin
  for v_lot in
    select id, quantity, expiry_date, lot_code
      from product_lots
     where tenant_id = p_tenant and store_id = p_store and product_id = p_product
       and is_active and quantity > 0
     order by expiry_date asc, received_at asc
     for update
  loop
    exit when v_pending <= 0;

    v_take := least(v_lot.quantity, v_pending);

    update product_lots set quantity = quantity - v_take where id = v_lot.id;

    if p_sale_item_id is not null then
      insert into sale_item_lots (tenant_id, sale_item_id, lot_id, quantity)
      values (p_tenant, p_sale_item_id, v_lot.id, v_take);
    end if;

    v_used := v_used || jsonb_build_object(
      'lot_id', v_lot.id, 'lot_code', v_lot.lot_code,
      'expiry_date', v_lot.expiry_date, 'quantity', v_take);

    v_pending := v_pending - v_take;
  end loop;

  -- Si quedó pendiente, se vendió más de lo que hay en lotes. No se bloquea:
  -- el faltante queda registrado para que el descuadre sea visible (ADR-005).
  if v_pending > 0 then
    v_used := v_used || jsonb_build_object('unallocated', v_pending);
  end if;

  return v_used;
end $$;

-- ---------------------------------------------------------------------------
-- fn_discount_within_limit — el tope de descuento del usuario
--
-- Réplica exacta de `discountWithinLimit` en packages/core/src/cart.ts,
-- incluida la tolerancia: un descuento de "10 %" sobre $1.999 da 10,005 % por
-- el redondeo a pesos, y rechazarlo sería incomprensible para quien lo aplicó.
-- ---------------------------------------------------------------------------
create or replace function public.fn_discount_within_limit(
  p_discount integer, p_gross integer, p_max_pct numeric
) returns boolean
language sql immutable set search_path = public
as $$
  select case
    when coalesce(p_discount, 0) <= 0 then true
    when coalesce(p_gross, 0) <= 0     then false
    else (p_discount::numeric * 100 / p_gross) <= coalesce(p_max_pct, 0) + 0.01
  end;
$$;

-- ---------------------------------------------------------------------------
-- fn_register_sale — versión con consumo FEFO
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
    from cash_sessions where user_id = v_user and status = 'abierta' limit 1;
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
    if v_disc < 0 then
      raise exception 'MONTO_NEGATIVO' using errcode = 'P0001';
    end if;
    v_subtotal := round(v_qty * v_price)::integer - v_disc;
    -- Un descuento mayor que la línea no regala plata: igual que en core
    -- (cart.ts), el subtotal de una línea nunca es negativo.
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

    -- FEFO: consume primero lo que vence antes
    if v_product.tracks_expiry then
      perform fn_consume_lots(v_tenant, v_store, v_product.id, v_qty, v_item_id);
    end if;

    perform fn_post_movement(v_tenant, v_store, v_product.id, 'venta',
                             -v_qty, v_product.avg_cost, 'sale', v_sale, null, v_user);
  end loop;

  -- El tope de descuento, aplicado acá y no solo en la pantalla. Hasta 0011
  -- `max_discount_pct` existía en la tabla de perfiles, `discountWithinLimit`
  -- existía en core y DESCUENTO_EXCEDE_LIMITE existía en la tabla de errores,
  -- y esta función no leía ninguno de los tres: el descuento entraba tal como
  -- lo mandara el cliente. Ver docs/21, hallazgo U-2.
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

  -- subtotal es el bruto de verdad: antes era `v_sum + p_discount_total`, que
  -- no devolvía los descuentos por línea y dejaba subtotal - descuento <> total
  -- en cuanto alguno existiera.
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
-- fn_void_sale — devuelve las unidades a SU lote original
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
  if coalesce(v_role::text, '') not in ('admin','supervisor') then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
  end if;
  if v_role = 'supervisor'
     and v_sale.sold_at::date <> (now() at time zone 'America/Santiago')::date then
    raise exception 'SIN_PERMISO_ANULAR' using errcode = '42501';
  end if;

  for v_item in select * from sale_items where sale_id = p_sale_id loop
    -- Devolver a los lotes exactos de los que salió
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
-- fn_confirm_receipt — crea el lote cuando el producto lleva vencimiento
-- ---------------------------------------------------------------------------
create or replace function public.fn_confirm_receipt(
  p_supplier_id     uuid,
  p_items           jsonb,   -- [{product_id, quantity, unit_cost, lot_code?, expiry_date?}]
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
  v_result  jsonb := '[]'::jsonb;
begin
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

    v_qty     := (v_item->>'quantity')::numeric;
    v_cost    := (v_item->>'unit_cost')::integer;
    v_expiry  := nullif(v_item->>'expiry_date','')::date;
    v_lotcode := nullif(v_item->>'lot_code','');
    v_total   := v_total + round(v_qty * v_cost)::integer;

    -- Un producto perecible SIN fecha de vencimiento es un error de operación,
    -- no un dato opcional: sin fecha no hay FEFO ni alerta posible.
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
-- fn_write_off_expired — dar de baja un lote vencido como merma
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
-- Vistas de vencimiento
-- ---------------------------------------------------------------------------
create or replace view v_expiring_lots
with (security_invoker = true) as
select
  pl.tenant_id, pl.id as lot_id, pl.product_id, p.name as product_name,
  pl.lot_code, pl.expiry_date, pl.quantity, pl.unit_cost,
  round(pl.quantity * pl.unit_cost)::integer as value_at_risk,
  (pl.expiry_date - current_date) as days_to_expiry,
  case
    when pl.expiry_date < current_date then 'vencido'
    when pl.expiry_date <= current_date + p.expiry_alert_days then 'por_vencer'
    else 'vigente'
  end as expiry_status
from product_lots pl
join products p on p.id = pl.product_id
where pl.is_active and pl.quantity > 0;

create or replace view v_stock_by_lot
with (security_invoker = true) as
select
  pl.tenant_id, pl.product_id, p.name as product_name,
  count(*)            as lot_count,
  sum(pl.quantity)    as total_quantity,
  min(pl.expiry_date) as nearest_expiry
from product_lots pl
join products p on p.id = pl.product_id
where pl.is_active and pl.quantity > 0
group by 1, 2, 3;

-- ---------------------------------------------------------------------------
-- RLS de las tablas nuevas
-- ---------------------------------------------------------------------------
alter table product_lots   enable row level security;
alter table sale_item_lots enable row level security;

create policy lots_read on product_lots for select to authenticated
  using (tenant_id = current_tenant_id());
create policy lots_write on product_lots for all to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'))
  with check (tenant_id = current_tenant_id());

create policy sale_item_lots_read on sale_item_lots for select to authenticated
  using (tenant_id = current_tenant_id());
create policy sale_item_lots_insert on sale_item_lots for insert to authenticated
  with check (tenant_id = current_tenant_id());

grant execute on function public.fn_write_off_lot to authenticated;
revoke execute on function public.fn_consume_lots from authenticated, anon;
