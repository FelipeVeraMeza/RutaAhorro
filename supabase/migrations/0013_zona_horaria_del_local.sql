-- ============================================================================
-- 0013 · El día es el del local, no el de un valor escrito a mano
--
-- `tenants.settings.timezone` existe desde 0001, y ninguna función ni vista lo
-- leía: todas decían 'America/Santiago'. Mientras el cliente esté en Chile
-- continental el resultado coincide, pero un local en Isla de Pascua, o
-- cualquier otro cliente, vería sus ventas agrupadas en el día equivocado sin
-- dónde corregirlo.
--
-- Y en fn_void_sale no era solo un valor fijo: era un defecto. La regla "el
-- supervisor solo anula ventas del día" comparaba
--
--   v_sale.sold_at::date  <>  (now() at time zone 'America/Santiago')::date
--
-- El lado izquierdo convierte a fecha en la zona de la SESIÓN, que en
-- Supabase es UTC; el derecho, en la de Chile. Una venta de las 21:30 es
-- "mañana" en UTC, así que el supervisor no podía anularla esa misma noche:
-- recibía SIN_PERMISO_ANULAR. Reproducido en tools/pg-test, que hasta el
-- 2026-09-18 corría en la hora de esta máquina y por eso no lo veía.
-- ============================================================================

-- Invoker y no definer a propósito: lee `tenants` con los permisos de quien
-- consulta, así que nadie obtiene la zona de un local que no es el suyo. El
-- respaldo es el mismo valor que pone la columna por omisión (0001) cuando el
-- local no tiene `timezone` en su configuración.
create or replace function public.fn_tenant_timezone(p_tenant uuid)
returns text
language sql stable set search_path = public
as $$
  select coalesce(
    (select settings->>'timezone' from tenants where id = p_tenant),
    'America/Santiago')
$$;
revoke execute on function public.fn_tenant_timezone from public, anon;
grant  execute on function public.fn_tenant_timezone to authenticated;

-- ---------------------------------------------------------------------------
-- fn_void_sale — igual que 0012, con el día del local en los dos lados
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

-- ---------------------------------------------------------------------------
-- Vistas de reporte — iguales que 0005, agrupadas por el día del local
-- ---------------------------------------------------------------------------
create or replace view v_sales_daily
with (security_invoker = true) as
select
  s.tenant_id,
  (s.sold_at at time zone fn_tenant_timezone(s.tenant_id))::date as sale_date,
  count(*)                                          as sales_count,
  sum(s.total)                                      as total_amount,
  round(avg(s.total))::integer                      as average_ticket
from sales s
where s.status = 'completada'
group by 1, 2;

create or replace view v_sales_by_product
with (security_invoker = true) as
select
  si.tenant_id,
  si.product_id,
  si.product_name,
  p.category_id,
  (s.sold_at at time zone fn_tenant_timezone(s.tenant_id))::date as sale_date,
  sum(si.quantity)                                  as units_sold,
  sum(si.subtotal)                                  as revenue,
  sum(round(si.quantity * si.unit_cost))::integer   as cost,
  sum(si.subtotal - round(si.quantity * si.unit_cost))::integer as gross_profit
from sale_items si
join sales s on s.id = si.sale_id
left join products p on p.id = si.product_id
where s.status = 'completada'
group by 1, 2, 3, 4, 5;

create or replace view v_sales_by_user
with (security_invoker = true) as
select
  s.tenant_id,
  s.sold_by                                         as user_id,
  pr.full_name,
  (s.sold_at at time zone fn_tenant_timezone(s.tenant_id))::date as sale_date,
  count(*)                                          as sales_count,
  sum(s.total)                                      as total_amount
from sales s
left join profiles pr on pr.id = s.sold_by
where s.status = 'completada'
group by 1, 2, 3, 4;

create or replace view v_adjustments
with (security_invoker = true) as
select
  im.tenant_id,
  (im.created_at at time zone fn_tenant_timezone(im.tenant_id))::date as adj_date,
  im.movement_type,
  im.product_id,
  p.name as product_name,
  im.quantity,
  im.reason,
  round(im.quantity * im.unit_cost)::integer as value_impact,
  pr.full_name as created_by_name
from inventory_movements im
left join products p on p.id = im.product_id
left join profiles pr on pr.id = im.created_by
where im.movement_type in ('ajuste_positivo','ajuste_negativo','merma','toma_inventario');
