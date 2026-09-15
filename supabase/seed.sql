-- ============================================================================
-- RutaAhorro · Datos de arranque
--
-- Crea el tenant, la tienda y un catálogo mínimo de prueba.
-- SEGURO de ejecutar más de una vez: todo es idempotente.
--
-- IMPORTANTE: no crea usuarios. Los usuarios se crean desde Supabase Auth
-- (Authentication > Users > Add user) y el trigger handle_new_user los vincula
-- al tenant usando el metadata. Ver instrucciones al final del archivo.
-- ============================================================================

do $$
declare
  v_tenant uuid;
  v_store  uuid;
  v_cat_abarrotes uuid;
  v_cat_lacteos   uuid;
  v_cat_bebidas   uuid;
  v_cat_limpieza  uuid;
begin
  -- Tenant -------------------------------------------------------------
  select id into v_tenant from tenants where name = 'RutaAhorro';
  if v_tenant is null then
    insert into tenants (name, plan, status)
    values ('RutaAhorro', 'completo', 'activo')
    returning id into v_tenant;
  end if;

  -- Tienda -------------------------------------------------------------
  select id into v_store from stores where tenant_id = v_tenant limit 1;
  if v_store is null then
    insert into stores (tenant_id, name, address)
    values (v_tenant, 'Local principal', null)
    returning id into v_store;
  end if;

  -- Categorías ---------------------------------------------------------
  insert into categories (tenant_id, name, sort_order) values
    (v_tenant, 'Abarrotes', 1),
    (v_tenant, 'Lácteos',   2),
    (v_tenant, 'Bebidas',   3),
    (v_tenant, 'Limpieza',  4),
    (v_tenant, 'Snacks',    5)
  on conflict (tenant_id, name) do nothing;

  select id into v_cat_abarrotes from categories where tenant_id = v_tenant and name = 'Abarrotes';
  select id into v_cat_lacteos   from categories where tenant_id = v_tenant and name = 'Lácteos';
  select id into v_cat_bebidas   from categories where tenant_id = v_tenant and name = 'Bebidas';
  select id into v_cat_limpieza  from categories where tenant_id = v_tenant and name = 'Limpieza';

  -- Productos de ejemplo -----------------------------------------------
  -- Incluye perecibles (tracks_expiry = true) para poder probar FEFO.
  insert into products (tenant_id, sku, name, category_id, unit, sale_price,
                        avg_cost, last_cost, min_stock, tracks_expiry, expiry_alert_days)
  values
    (v_tenant, 'ARR-1K',  'Arroz grado 1 · 1 kg',        v_cat_abarrotes, 'unidad', 1590,  1100, 1100, 10, false, 30),
    (v_tenant, 'FID-400', 'Fideos spaghetti · 400 g',    v_cat_abarrotes, 'unidad',  990,   640,  640, 12, false, 30),
    (v_tenant, 'ACE-900', 'Aceite vegetal · 900 ml',     v_cat_abarrotes, 'unidad', 2490,  1850, 1850,  6, false, 30),
    (v_tenant, 'AZU-1K',  'Azúcar · 1 kg',               v_cat_abarrotes, 'unidad', 1290,   900,  900,  8, false, 30),
    (v_tenant, 'LEC-1L',  'Leche entera · 1 L',          v_cat_lacteos,   'unidad', 1190,   850,  850, 20, true,  10),
    (v_tenant, 'YOG-150', 'Yogurt frutilla · 150 g',     v_cat_lacteos,   'unidad',  590,   390,  390, 24, true,   7),
    (v_tenant, 'QUE-250', 'Queso gauda · 250 g',         v_cat_lacteos,   'unidad', 3290,  2400, 2400,  6, true,  14),
    (v_tenant, 'BEB-15',  'Bebida cola · 1.5 L',         v_cat_bebidas,   'unidad', 1890,  1350, 1350, 15, false, 30),
    (v_tenant, 'AGU-15',  'Agua mineral · 1.5 L',        v_cat_bebidas,   'unidad',  990,   620,  620, 15, false, 30),
    (v_tenant, 'JUG-1L',  'Jugo naranja · 1 L',          v_cat_bebidas,   'unidad', 1390,   980,  980, 10, true,  15),
    (v_tenant, 'DET-3L',  'Detergente líquido · 3 L',    v_cat_limpieza,  'unidad', 5990,  4300, 4300,  4, false, 30),
    (v_tenant, 'CLO-900', 'Cloro · 900 ml',              v_cat_limpieza,  'unidad',  890,   560,  560,  8, false, 30)
  on conflict (tenant_id, sku) do nothing;

  -- Códigos de barras --------------------------------------------------
  -- Todos con dígito de control EAN-13 válido.
  insert into product_barcodes (tenant_id, product_id, barcode, is_primary)
  select v_tenant, p.id, b.code, true
    from (values
      ('ARR-1K',  '7801234000018'),
      ('FID-400', '7801234000025'),
      ('ACE-900', '7801234000032'),
      ('AZU-1K',  '7801234000049'),
      ('LEC-1L',  '7801234000056'),
      ('YOG-150', '7801234000063'),
      ('QUE-250', '7801234000070'),
      ('BEB-15',  '7801234000087'),
      ('AGU-15',  '7801234000094'),
      ('JUG-1L',  '7801234000100'),
      ('DET-3L',  '7801234000117'),
      ('CLO-900', '7801234000124')
    ) as b(sku, code)
    join products p on p.sku = b.sku and p.tenant_id = v_tenant
  on conflict (tenant_id, barcode) do nothing;

  raise notice 'Seed listo. tenant_id = %  store_id = %', v_tenant, v_store;
end $$;

-- ============================================================================
-- CÓMO CREAR EL PRIMER USUARIO ADMINISTRADOR
-- ============================================================================
-- 1. Copiar el tenant_id y el store_id:
--
--      select t.id as tenant_id, s.id as store_id
--        from tenants t join stores s on s.tenant_id = t.id
--       where t.name = 'RutaAhorro';
--
-- 2. Supabase > Authentication > Users > Add user
--      Email: el correo del dueño
--      Password: una contraseña temporal
--      Auto Confirm User: SÍ
--
-- 3. En "User Metadata" (raw_user_meta_data) pegar, con los ids del paso 1:
--
--      {
--        "tenant_id": "<TENANT_ID>",
--        "store_id":  "<STORE_ID>",
--        "role":      "admin",
--        "full_name": "Nombre del dueño"
--      }
--
--    El trigger handle_new_user crea el perfil automáticamente.
--
-- 4. Verificar:
--      select p.full_name, p.role, p.is_active, t.name
--        from profiles p join tenants t on t.id = p.tenant_id;
--
-- Si el perfil NO aparece, el metadata no traía tenant_id. Corregirlo con:
--      insert into profiles (id, tenant_id, store_id, full_name, email, role, max_discount_pct)
--      values ('<AUTH_USER_ID>', '<TENANT_ID>', '<STORE_ID>', 'Nombre', 'correo@ej.cl', 'admin', 100);
-- ============================================================================
