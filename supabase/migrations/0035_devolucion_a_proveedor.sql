-- ============================================================================
-- 0035 · Devolución a proveedor (RQ-35, respuesta 36 del cuestionario)
--
-- El cliente devuelve mercadería a sus proveedores (vencida, dañada, mal
-- despachada) y el sistema no tenía cómo registrarlo: se hacía como un ajuste
-- negativo con motivo, que no dice a quién se devolvió, ni con qué documento,
-- ni cuánto vale lo que se debería recuperar.
--
-- Lo que hace:
--   · Saca el stock por el kardex con su propio tipo ('devolucion_proveedor'),
--     al costo promedio: el promedio del resto no cambia (ADR-006).
--   · Si el producto es perecible, descuenta del lote elegido o, sin elegir,
--     del que vence primero (FEFO, como la venta).
--   · No se puede devolver más de lo que hay: físicamente no existe.
--   · Queda la devolución con proveedor, documento (guía de devolución o la
--     nota de crédito que mande el proveedor), motivo y valor al costo.
--   · No toca la plata: lo que el proveedor devuelva llega como nota de
--     crédito o reembolso, y se registra donde corresponde (Por pagar, Caja).
-- ============================================================================

alter type movement_type add value if not exists 'devolucion_proveedor';

create table if not exists devoluciones_proveedor (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  supplier_id  uuid not null references suppliers(id) on delete restrict,
  documento    text,
  motivo       text not null check (length(trim(motivo)) > 0),
  total_costo  integer not null default 0 check (total_costo >= 0),
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_devoluciones_proveedor on devoluciones_proveedor(tenant_id, created_at desc);

create table if not exists devolucion_proveedor_items (
  id             uuid primary key default gen_random_uuid(),
  devolucion_id  uuid not null references devoluciones_proveedor(id) on delete cascade,
  tenant_id      uuid not null references tenants(id) on delete cascade,
  product_id     uuid not null references products(id) on delete restrict,
  product_name   text not null,
  quantity       numeric(14,3) not null check (quantity > 0 and quantity = trunc(quantity)),
  unit_cost      integer not null default 0,
  lotes          jsonb not null default '[]'::jsonb
);
create index if not exists idx_devolucion_items on devolucion_proveedor_items(devolucion_id);

-- Se leen en compras; se escriben solo con la función (regla 14).
alter table devoluciones_proveedor     enable row level security;
alter table devolucion_proveedor_items enable row level security;
drop policy if exists devoluciones_proveedor_read on devoluciones_proveedor;
create policy devoluciones_proveedor_read on devoluciones_proveedor for select to authenticated
  using (tenant_id = current_tenant_id()
         and coalesce(current_user_role()::text, '') in ('admin', 'supervisor', 'bodega'));
drop policy if exists devolucion_proveedor_items_read on devolucion_proveedor_items;
create policy devolucion_proveedor_items_read on devolucion_proveedor_items for select to authenticated
  using (tenant_id = current_tenant_id()
         and coalesce(current_user_role()::text, '') in ('admin', 'supervisor', 'bodega'));
revoke insert, update, delete on devoluciones_proveedor, devolucion_proveedor_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- fn_devolver_a_proveedor
-- ---------------------------------------------------------------------------
-- `p_items`: [{product_id, quantity, lot_id?}]. Devuelve {id, total_costo}.
create or replace function public.fn_devolver_a_proveedor(
  p_supplier_id uuid, p_items jsonb, p_motivo text, p_documento text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant  uuid := current_tenant_id();
  v_user    uuid := auth.uid();
  v_store   uuid := current_store_id();
  v_id      uuid := gen_random_uuid();
  v_item    jsonb;
  v_prod    products%rowtype;
  v_qty     numeric(14,3);
  v_hay     numeric(14,3);
  v_lote    product_lots%rowtype;
  v_lotes   jsonb;
  v_total   integer := 0;
  v_ids     uuid[];
begin
  if coalesce(current_user_role()::text, '') not in ('admin', 'supervisor', 'bodega') or not is_active_user() then
    raise exception 'SIN_PERMISO_AJUSTAR' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_supplier_id is null or not exists (select 1 from suppliers where id = p_supplier_id and tenant_id = v_tenant) then
    raise exception 'PROVEEDOR_REQUERIDO' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'DEVOLUCION_SIN_PRODUCTOS' using errcode = 'P0001';
  end if;
  if v_store is null then
    select id into v_store from stores where tenant_id = v_tenant and is_active limit 1;
  end if;

  -- Todo el stock de una vez y en orden, como la venta: dos devoluciones
  -- simultáneas no se traban ni sacan lo que no hay.
  select array_agg(distinct (x->>'product_id')::uuid) into v_ids from jsonb_array_elements(p_items) x;
  perform fn_lock_stock(v_tenant, v_store, v_ids);

  insert into devoluciones_proveedor (id, tenant_id, store_id, supplier_id, documento, motivo, created_by)
  values (v_id, v_tenant, v_store, p_supplier_id, nullif(trim(coalesce(p_documento, '')), ''), trim(p_motivo), v_user);

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_qty := (v_item->>'quantity')::numeric;
    exception when others then
      raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
    end;
    if v_qty is null or v_qty <= 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;
    if v_qty <> trunc(v_qty) then raise exception 'CANTIDAD_ENTERA' using errcode = 'P0001'; end if;

    select * into v_prod from products where id = (v_item->>'product_id')::uuid and tenant_id = v_tenant;
    if not found then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

    select coalesce(quantity, 0) into v_hay from stock_levels
     where tenant_id = v_tenant and store_id = v_store and product_id = v_prod.id;
    if coalesce(v_hay, 0) < v_qty then
      raise exception 'STOCK_INSUFICIENTE: %', v_prod.name using errcode = 'P0001';
    end if;

    -- Lotes: el elegido, o FEFO.
    v_lotes := '[]'::jsonb;
    if v_prod.tracks_expiry then
      if nullif(v_item->>'lot_id', '') is not null then
        select * into v_lote from product_lots
         where id = (v_item->>'lot_id')::uuid and tenant_id = v_tenant and product_id = v_prod.id
         for update;
        if not found then raise exception 'LOTE_NO_ENCONTRADO' using errcode = 'P0001'; end if;
        if v_lote.quantity < v_qty then
          raise exception 'STOCK_INSUFICIENTE: % (lote)', v_prod.name using errcode = 'P0001';
        end if;
        update product_lots set quantity = quantity - v_qty where id = v_lote.id;
        v_lotes := jsonb_build_array(jsonb_build_object(
          'lot_id', v_lote.id, 'lot_code', v_lote.lot_code, 'expiry_date', v_lote.expiry_date, 'quantity', v_qty));
      else
        v_lotes := fn_consume_lots(v_tenant, v_store, v_prod.id, v_qty, null);
      end if;
    end if;

    perform fn_post_movement(v_tenant, v_store, v_prod.id, 'devolucion_proveedor', -v_qty,
                             v_prod.avg_cost, 'devolucion_proveedor', v_id, trim(p_motivo), v_user);

    insert into devolucion_proveedor_items (devolucion_id, tenant_id, product_id, product_name, quantity, unit_cost, lotes)
    values (v_id, v_tenant, v_prod.id, v_prod.name, v_qty, v_prod.avg_cost, v_lotes);
    v_total := v_total + round(v_qty * v_prod.avg_cost)::integer;
  end loop;

  update devoluciones_proveedor set total_costo = v_total where id = v_id;

  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, new_values)
  values (v_tenant, v_user, 'devolucion_proveedor', 'devoluciones_proveedor', v_id,
          jsonb_build_object('supplier_id', p_supplier_id, 'documento', p_documento,
                             'motivo', trim(p_motivo), 'total_costo', v_total));

  return jsonb_build_object('id', v_id, 'total_costo', v_total);
end $$;

revoke execute on function public.fn_devolver_a_proveedor(uuid, jsonb, text, text) from public, anon;
grant  execute on function public.fn_devolver_a_proveedor(uuid, jsonb, text, text) to authenticated;
