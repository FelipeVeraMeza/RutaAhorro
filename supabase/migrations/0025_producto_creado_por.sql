-- ============================================================================
-- 0025 · Un producto recién creado dice quién lo creó (RF-M10-11)
--
-- Encontrado por tools/ui/flujo-completo.mjs (2026-09-28): al abrir un
-- producto recién creado, el formulario decía "Última modificación: sin
-- registro". 0020 anota `updated_by` en el disparador de UPDATE
-- (fn_track_price_change), y el alta es un INSERT: hasta que alguien lo
-- editaba, el producto no tenía autor.
--
-- Un disparador y no un cambio en fn_create_product: cubre cualquier camino
-- de alta (formulario, carga masiva) sin tocar la firma de ninguna función.
-- Sin sesión (el worker, una migración) queda en null: no se inventa autor.
-- Los productos ya creados sin autor quedan como están; no hay de dónde
-- sacarlo con certeza.
--
-- Y la vista sin costos (`products_public`) pasa a traer `updated_by`: la
-- lista de Productos de quien no ve costos (vendedor, bodega) y los selectores
-- de productos de Configuración, Ofertas y Clientes leen esa vista pidiendo el
-- autor por la relación products_updated_by_fkey. Sin la columna, la API
-- respondía 400 y la lista no cargaba (encontrado por ofertas.mjs y
-- clientes.mjs antes de subir el cambio que la pedía).
-- ============================================================================

create or replace function public.fn_producto_creado_por()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end $$;

revoke execute on function public.fn_producto_creado_por() from public, anon, authenticated;

drop trigger if exists trg_producto_creado_por on products;
create trigger trg_producto_creado_por
  before insert on products
  for each row execute function public.fn_producto_creado_por();

-- La columna va AL FINAL: `create or replace view` solo puede agregar columnas
-- al final, nunca quitar ni reordenar (regla 22). 0004 borra la vista antes de
-- crearla, así que reinstalar no choca.
create or replace view products_public
with (security_invoker = true) as
  select id, tenant_id, sku, name, description, category_id, unit,
         sale_price, min_stock, image_url, is_active, created_at, updated_at,
         tracks_expiry, expiry_alert_days, updated_by
    from products;
