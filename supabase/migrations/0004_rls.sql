-- ============================================================================
-- RutaAhorro · 0004 · Row Level Security
-- El aislamiento entre locales vive AQUÍ, no en la interfaz.
-- Ver docs/06-modelo-datos.md §6 y docs/adr/ADR-004-multi-tenant.md
-- ============================================================================

-- RLS en el 100 % de las tablas (RNF-24). Sin excepciones: las excepciones
-- son justamente donde se filtran los datos.
alter table tenants                enable row level security;
alter table stores                 enable row level security;
alter table profiles               enable row level security;
alter table categories             enable row level security;
alter table products               enable row level security;
alter table product_barcodes       enable row level security;
alter table price_history          enable row level security;
alter table suppliers              enable row level security;
alter table product_suppliers      enable row level security;
alter table purchase_receipts      enable row level security;
alter table purchase_receipt_items enable row level security;
alter table stock_levels           enable row level security;
alter table inventory_movements    enable row level security;
alter table stock_counts           enable row level security;
alter table stock_count_items      enable row level security;
alter table cash_sessions          enable row level security;
alter table cash_movements         enable row level security;
alter table sales                  enable row level security;
alter table sale_items             enable row level security;
alter table sale_payments          enable row level security;
alter table folio_counters         enable row level security;
alter table audit_log              enable row level security;
alter table alerts                 enable row level security;
alter table job_runs               enable row level security;

-- ---------------------------------------------------------------------------
-- Tenants y tiendas
-- ---------------------------------------------------------------------------
create policy tenant_read on tenants for select to authenticated
  using (id = current_tenant_id());
create policy tenant_update on tenants for update to authenticated
  using (id = current_tenant_id() and current_user_role() = 'admin')
  with check (id = current_tenant_id());

create policy stores_read on stores for select to authenticated
  using (tenant_id = current_tenant_id());
create policy stores_write on stores for all to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() = 'admin')
  with check (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------------
create policy profiles_read on profiles for select to authenticated
  using (tenant_id = current_tenant_id());
create policy profiles_insert on profiles for insert to authenticated
  with check (tenant_id = current_tenant_id() and current_user_role() = 'admin');
create policy profiles_update on profiles for update to authenticated
  using (tenant_id = current_tenant_id()
         and (current_user_role() = 'admin' or id = auth.uid()))
  with check (tenant_id = current_tenant_id());
-- Sin política de DELETE: los usuarios se desactivan, no se borran.

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------
create policy categories_read on categories for select to authenticated
  using (tenant_id = current_tenant_id());
create policy categories_write on categories for all to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor'))
  with check (tenant_id = current_tenant_id());

create policy products_read on products for select to authenticated
  using (tenant_id = current_tenant_id());
create policy products_insert on products for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and current_user_role() in ('admin','supervisor','bodega'));
create policy products_update on products for update to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'))
  with check (tenant_id = current_tenant_id());
create policy products_delete on products for delete to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() = 'admin');

create policy barcodes_read on product_barcodes for select to authenticated
  using (tenant_id = current_tenant_id());
create policy barcodes_write on product_barcodes for all to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'))
  with check (tenant_id = current_tenant_id());

create policy price_history_read on price_history for select to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor'));
create policy price_history_insert on price_history for insert to authenticated
  with check (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Proveedores y compras
-- ---------------------------------------------------------------------------
create policy suppliers_read on suppliers for select to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'));
create policy suppliers_write on suppliers for all to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() = 'admin')
  with check (tenant_id = current_tenant_id());

create policy receipts_read on purchase_receipts for select to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'));
create policy receipts_insert on purchase_receipts for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and current_user_role() in ('admin','supervisor','bodega'));

create policy receipt_items_read on purchase_receipt_items for select to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'));
create policy receipt_items_insert on purchase_receipt_items for insert to authenticated
  with check (tenant_id = current_tenant_id());

create policy prod_sup_read on product_suppliers for select to authenticated
  using (tenant_id = current_tenant_id());
create policy prod_sup_write on product_suppliers for all to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor'))
  with check (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------------
create policy stock_read on stock_levels for select to authenticated
  using (tenant_id = current_tenant_id());
-- stock_levels solo lo escribe fn_post_movement (SECURITY DEFINER).
-- Sin política de escritura: nadie lo toca directamente.

create policy movements_read on inventory_movements for select to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'));
-- Sin políticas de INSERT/UPDATE/DELETE: el kardex solo se escribe vía
-- fn_post_movement. La inmutabilidad además está reforzada por trigger.

create policy counts_read on stock_counts for select to authenticated
  using (tenant_id = current_tenant_id());
create policy counts_write on stock_counts for all to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'))
  with check (tenant_id = current_tenant_id());

create policy count_items_read on stock_count_items for select to authenticated
  using (tenant_id = current_tenant_id());
create policy count_items_write on stock_count_items for all to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor','bodega'))
  with check (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------------
create policy cash_sessions_read on cash_sessions for select to authenticated
  using (tenant_id = current_tenant_id()
         and (current_user_role() in ('admin','supervisor') or user_id = auth.uid()));
create policy cash_sessions_insert on cash_sessions for insert to authenticated
  with check (tenant_id = current_tenant_id() and user_id = auth.uid());
create policy cash_sessions_update on cash_sessions for update to authenticated
  using (tenant_id = current_tenant_id()
         and (current_user_role() in ('admin','supervisor') or user_id = auth.uid()))
  with check (tenant_id = current_tenant_id());

create policy cash_mov_read on cash_movements for select to authenticated
  using (tenant_id = current_tenant_id());
create policy cash_mov_insert on cash_movements for insert to authenticated
  with check (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Ventas
-- El vendedor solo ve las suyas (RF-M7-12)
-- ---------------------------------------------------------------------------
create policy sales_read on sales for select to authenticated
  using (tenant_id = current_tenant_id()
         and (current_user_role() in ('admin','supervisor') or sold_by = auth.uid()));
create policy sales_insert on sales for insert to authenticated
  with check (tenant_id = current_tenant_id());
create policy sales_update on sales for update to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor'))
  with check (tenant_id = current_tenant_id());

create policy sale_items_read on sale_items for select to authenticated
  using (tenant_id = current_tenant_id());
create policy sale_items_insert on sale_items for insert to authenticated
  with check (tenant_id = current_tenant_id());

create policy sale_payments_read on sale_payments for select to authenticated
  using (tenant_id = current_tenant_id());
create policy sale_payments_insert on sale_payments for insert to authenticated
  with check (tenant_id = current_tenant_id());

create policy folio_read on folio_counters for select to authenticated
  using (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Transversales
-- ---------------------------------------------------------------------------
create policy audit_read on audit_log for select to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() = 'admin');
create policy audit_insert on audit_log for insert to authenticated
  with check (tenant_id = current_tenant_id());
-- Sin UPDATE ni DELETE: inmutable por política Y por trigger.

create policy alerts_read on alerts for select to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor'));
create policy alerts_update on alerts for update to authenticated
  using (tenant_id = current_tenant_id()
         and current_user_role() in ('admin','supervisor'))
  with check (tenant_id = current_tenant_id());
create policy alerts_insert on alerts for insert to authenticated
  with check (tenant_id = current_tenant_id());

-- job_runs: solo el worker (service_role). Sin política para authenticated,
-- por lo tanto ningún usuario de la aplicación lo lee ni lo escribe.

-- ---------------------------------------------------------------------------
-- Vista sin costos para roles que no deben verlos (§6.2)
-- ---------------------------------------------------------------------------
create or replace view products_public
with (security_invoker = true) as
  select id, tenant_id, sku, name, description, category_id, unit,
         sale_price, min_stock, image_url, is_active, created_at, updated_at
    from products;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución de las funciones de negocio
-- ---------------------------------------------------------------------------
grant execute on function public.fn_register_sale       to authenticated;
grant execute on function public.fn_void_sale           to authenticated;
grant execute on function public.fn_confirm_receipt     to authenticated;
grant execute on function public.fn_void_receipt        to authenticated;
grant execute on function public.fn_adjust_stock        to authenticated;
grant execute on function public.fn_open_cash_session   to authenticated;
grant execute on function public.fn_add_cash_movement   to authenticated;
grant execute on function public.fn_close_cash_session  to authenticated;
grant execute on function public.fn_cash_session_summary to authenticated;
grant execute on function public.fn_apply_stock_count   to authenticated;
grant execute on function public.current_tenant_id      to authenticated;
grant execute on function public.current_user_role      to authenticated;

-- fn_post_movement y fn_rebuild_stock_levels NO se exponen a authenticated:
-- se invocan solo desde otras funciones o desde el worker con service_role.
revoke execute on function public.fn_post_movement        from authenticated, anon;
revoke execute on function public.fn_rebuild_stock_levels from authenticated, anon;
revoke execute on function public.fn_next_folio           from authenticated, anon;
