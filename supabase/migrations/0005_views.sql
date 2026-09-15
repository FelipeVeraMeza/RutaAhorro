-- ============================================================================
-- RutaAhorro · 0005 · Vistas de reporte
-- security_invoker = true: las vistas heredan las políticas RLS de quien
-- consulta. Sin esto, una vista sería una puerta trasera al aislamiento.
-- Ver docs/08-api-contratos.md §3
-- ============================================================================

-- Ventas por día
create or replace view v_sales_daily
with (security_invoker = true) as
select
  s.tenant_id,
  (s.sold_at at time zone 'America/Santiago')::date as sale_date,
  count(*)                                          as sales_count,
  sum(s.total)                                      as total_amount,
  round(avg(s.total))::integer                      as average_ticket
from sales s
where s.status = 'completada'
group by 1, 2;

-- Ventas por producto, con utilidad bruta
create or replace view v_sales_by_product
with (security_invoker = true) as
select
  si.tenant_id,
  si.product_id,
  si.product_name,
  p.category_id,
  (s.sold_at at time zone 'America/Santiago')::date as sale_date,
  sum(si.quantity)                                  as units_sold,
  sum(si.subtotal)                                  as revenue,
  sum(round(si.quantity * si.unit_cost))::integer   as cost,
  sum(si.subtotal - round(si.quantity * si.unit_cost))::integer as gross_profit
from sale_items si
join sales s on s.id = si.sale_id
left join products p on p.id = si.product_id
where s.status = 'completada'
group by 1, 2, 3, 4, 5;

-- Ventas por usuario
create or replace view v_sales_by_user
with (security_invoker = true) as
select
  s.tenant_id,
  s.sold_by                                         as user_id,
  pr.full_name,
  (s.sold_at at time zone 'America/Santiago')::date as sale_date,
  count(*)                                          as sales_count,
  sum(s.total)                                      as total_amount
from sales s
left join profiles pr on pr.id = s.sold_by
where s.status = 'completada'
group by 1, 2, 3, 4;

-- Inventario valorizado al costo promedio
create or replace view v_inventory_valued
with (security_invoker = true) as
select
  p.tenant_id,
  p.id                                    as product_id,
  p.name,
  p.category_id,
  c.name                                  as category_name,
  coalesce(sl.quantity, 0)                as quantity,
  p.avg_cost,
  p.sale_price,
  round(coalesce(sl.quantity,0) * p.avg_cost)::integer   as cost_value,
  round(coalesce(sl.quantity,0) * p.sale_price)::integer as sale_value
from products p
left join stock_levels sl on sl.product_id = p.id
left join categories c on c.id = p.category_id
where p.is_active;

-- Productos bajo stock mínimo
create or replace view v_low_stock
with (security_invoker = true) as
select
  p.tenant_id, p.id as product_id, p.name,
  coalesce(sl.quantity, 0) as quantity,
  p.min_stock,
  (p.min_stock - coalesce(sl.quantity,0)) as shortfall
from products p
left join stock_levels sl on sl.product_id = p.id
where p.is_active and p.min_stock > 0
  and coalesce(sl.quantity, 0) <= p.min_stock;

-- Productos sin movimiento (capital inmovilizado)
create or replace view v_stale_products
with (security_invoker = true) as
select
  p.tenant_id, p.id as product_id, p.name,
  coalesce(sl.quantity, 0) as quantity,
  round(coalesce(sl.quantity,0) * p.avg_cost)::integer as cost_value,
  max(im.created_at) as last_movement_at,
  extract(day from now() - coalesce(max(im.created_at), p.created_at))::integer as days_idle
from products p
left join stock_levels sl on sl.product_id = p.id
left join inventory_movements im
       on im.product_id = p.id and im.movement_type = 'venta'
where p.is_active
group by p.tenant_id, p.id, p.name, sl.quantity, p.avg_cost, p.created_at;

-- Mermas y ajustes por período
create or replace view v_adjustments
with (security_invoker = true) as
select
  im.tenant_id,
  (im.created_at at time zone 'America/Santiago')::date as adj_date,
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

-- Resumen de cierres de caja
create or replace view v_cash_sessions_summary
with (security_invoker = true) as
select
  cs.tenant_id, cs.id as session_id, cs.user_id, pr.full_name,
  cs.opened_at, cs.closed_at, cs.status,
  cs.opening_amount, cs.expected_amount, cs.counted_amount, cs.difference,
  cs.closing_notes,
  (select count(*) from sales s
    where s.cash_session_id = cs.id and s.status = 'completada') as sales_count,
  (select coalesce(sum(s.total),0) from sales s
    where s.cash_session_id = cs.id and s.status = 'completada') as sales_total
from cash_sessions cs
left join profiles pr on pr.id = cs.user_id;
