-- ============================================================================
-- 0010 · La unidad del producto en las vistas de alerta
--
-- El panel de Inicio escribía la unidad a mano: "2.5 u". Para un producto que
-- se vende por kilo —el queso, el pan, la fruta, que son justo los perecibles
-- que llevan lote— eso es incorrecto y además confuso: "2.5 u" de queso no
-- significa nada, y el dueño no sabe si son dos unidades y media o dos kilos y
-- medio de pérdida.
--
-- La unidad vive en products y las dos vistas ya hacen el join, así que es
-- agregar una columna. Se agrega también el orden por urgencia a v_low_stock:
-- la pantalla mostraba ocho filas sin ningún criterio, porque sin `order by`
-- PostgreSQL devuelve las que quiera. El dueño veía ocho productos bajo mínimo
-- que no eran los ocho más urgentes, y podían cambiar de una recarga a otra sin
-- que nada hubiera pasado.
--
-- `create or replace view` solo deja **agregar** columnas al final: cambiar el
-- nombre o la posición de una existente lo rechaza. Por eso `unit` va última y
-- no junto al nombre del producto, que es donde se leería mejor.
-- ============================================================================

create or replace view v_low_stock
with (security_invoker = true) as
select
  p.tenant_id, p.id as product_id, p.name,
  coalesce(sl.quantity, 0) as quantity,
  p.min_stock,
  (p.min_stock - coalesce(sl.quantity,0)) as shortfall,
  p.unit
from products p
left join stock_levels sl on sl.product_id = p.id
where p.is_active and p.min_stock > 0
  and coalesce(sl.quantity, 0) <= p.min_stock;

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
  end as expiry_status,
  p.unit
from product_lots pl
join products p on p.id = pl.product_id
where pl.is_active and pl.quantity > 0;
