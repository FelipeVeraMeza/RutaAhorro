-- ============================================================================
-- 0033 · La utilidad de Reportes se calcula sin IVA
--
-- Desde 2026-10-01 el costo es NETO (docs/26 N° 13, 0032): sale de la factura
-- del proveedor, sin IVA. `v_sales_by_product.gross_profit` restaba ese costo
-- neto del ingreso CON IVA, y le sumaba a la utilidad el 19 % que es del
-- fisco (y el impuesto adicional de bebidas y alcoholes). Un producto de
-- $2.490 con costo neto $1.850 mostraba $640 de utilidad y deja $242.
--
-- Ahora cada línea pasa a neto antes de restar el costo:
--   neto = round(subtotal / (1 + IVA + tasa adicional)),
-- la misma cuenta que `desglosarImpuestos` (core) y `fn_desglose_lineas`
-- (0019) por grupo. Sumado línea a línea puede diferir en $1 del neto de la
-- boleta, que se calcula por grupo: para un reporte de utilidad da lo mismo.
--
-- Mismas columnas y en el mismo orden que 0019: `create or replace view` no
-- puede quitar ni reordenar columnas (regla 22), y así reinstalar sigue
-- funcionando. `revenue` sigue siendo lo cobrado con IVA, que es lo que se
-- compara con la caja; el margen de la pantalla es utilidad / (utilidad + costo).
-- ============================================================================

create or replace view v_sales_by_product
with (security_invoker = true) as
with m as (
  select si.tenant_id, si.product_id, si.product_name,
         (s.sold_at at time zone fn_tenant_timezone(s.tenant_id))::date as d,
         si.quantity as q, si.subtotal as ingreso, round(si.quantity * si.unit_cost) as costo,
         round(si.subtotal / (1 + coalesce((t.settings->>'iva_pct')::numeric, 19) / 100
                                + coalesce(si.impuesto_adicional_tasa, 0) / 100)) as ingreso_neto
    from sale_items si
    join sales s on s.id = si.sale_id
    join tenants t on t.id = si.tenant_id
   where s.status = 'completada'
  union all
  select si.tenant_id, si.product_id, si.product_name,
         (sr.created_at at time zone fn_tenant_timezone(sr.tenant_id))::date,
         -ri.cantidad, -ri.monto, -round(ri.cantidad * si.unit_cost),
         -round(ri.monto / (1 + coalesce((t.settings->>'iva_pct')::numeric, 19) / 100
                              + coalesce(si.impuesto_adicional_tasa, 0) / 100))
    from sale_return_items ri
    join sale_returns sr on sr.id = ri.return_id
    join sale_items si on si.id = ri.sale_item_id
    join sales s on s.id = sr.sale_id
    join tenants t on t.id = si.tenant_id
   where s.status = 'completada'
)
select m.tenant_id, m.product_id, m.product_name, p.category_id,
       m.d                                     as sale_date,
       sum(m.q)                                as units_sold,
       sum(m.ingreso)                          as revenue,
       sum(m.costo)::integer                   as cost,
       sum(m.ingreso_neto - m.costo)::integer  as gross_profit
  from m left join products p on p.id = m.product_id
 group by 1, 2, 3, 4, 5;
