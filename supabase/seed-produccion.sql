-- ============================================================================
-- RutaAhorro · Arranque de PRODUCCIÓN
--
-- Crea únicamente el tenant y la tienda. **No inserta ningún producto,
-- categoría ni código de barra.** El catálogo lo carga el cliente con sus
-- productos reales, desde la pantalla Productos o con la carga masiva.
--
-- Usar este archivo, y no `seed.sql`, cuando la base sea la del cliente.
-- `seed.sql` trae 12 productos de ejemplo con códigos EAN inventados, que
-- sirven para probar la aplicación y no tienen nada que hacer en producción:
-- si entran, después hay que distinguirlos a mano del catálogo real, y un
-- código de barra falso ocupa un número que el producto verdadero no podrá
-- usar (la restricción `unique (tenant_id, barcode)` lo impide).
--
-- SEGURO de ejecutar más de una vez: todo es idempotente.
--
-- No crea usuarios. Se crean desde Supabase Auth y el trigger
-- handle_new_user los vincula al tenant. Instrucciones al final.
-- ============================================================================

do $$
declare
  v_tenant uuid;
  v_store  uuid;
  -- Cambiar por el nombre real del local antes de ejecutar.
  v_nombre text := 'RutaAhorro';
begin
  -- Tenant -------------------------------------------------------------
  select id into v_tenant from tenants where name = v_nombre;
  if v_tenant is null then
    insert into tenants (name, plan, status)
    values (v_nombre, 'completo', 'activo')
    returning id into v_tenant;
    raise notice 'Tenant creado: %', v_tenant;
  else
    raise notice 'Tenant ya existía: %', v_tenant;
  end if;

  -- Tienda -------------------------------------------------------------
  select id into v_store from stores where tenant_id = v_tenant limit 1;
  if v_store is null then
    insert into stores (tenant_id, name, address)
    values (v_tenant, 'Local principal', null)
    returning id into v_store;
    raise notice 'Tienda creada: %', v_store;
  else
    raise notice 'Tienda ya existía: %', v_store;
  end if;

  raise notice '--------------------------------------------------';
  raise notice 'tenant_id = %', v_tenant;
  raise notice 'store_id  = %', v_store;
  raise notice 'Catálogo vacío a propósito. Cargar los productos reales.';
  raise notice '--------------------------------------------------';
end $$;

-- ============================================================================
-- VERIFICAR QUE LA BASE QUEDÓ LIMPIA
-- ============================================================================
-- Las tres consultas deben devolver 0 antes de entregar el sistema:
--
--   select count(*) as productos        from products;
--   select count(*) as codigos_de_barra from product_barcodes;
--   select count(*) as ventas           from sales;
--
-- Si devuelven algo distinto de 0, se ejecutó `seed.sql` por error. Para
-- limpiar SOLO los datos de ejemplo (no hacerlo si ya hay ventas reales):
--
--   delete from product_barcodes
--    where barcode like '78012340001%';
--   delete from products
--    where sku in ('ARR-1K','FID-400','ACE-900','AZU-1K','LEC-1L','YOG-150',
--                  'QUE-250','BEB-15','AGU-15','JUG-1L','DET-3L','CLO-900');
--
-- El borrado falla si algún producto ya tiene movimientos de kardex, y eso
-- es correcto: significa que alguien vendió con el catálogo de prueba y hay
-- que revisar qué pasó antes de borrar nada.

-- ============================================================================
-- CÓMO CREAR EL PRIMER USUARIO ADMINISTRADOR
-- ============================================================================
-- 1. Copiar el tenant_id y el store_id:
--
--      select t.id as tenant_id, s.id as store_id
--        from tenants t join stores s on s.tenant_id = t.id;
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
-- DESPUÉS DE ESTO
-- ============================================================================
-- 1. Entrar a la aplicación con el administrador recién creado.
-- 2. Cargar el catálogo real: Productos > Importar, con la planilla del local.
--    Los códigos de barra van en la columna correspondiente de la plantilla y
--    quedan enlazados al producto automáticamente.
-- 3. Invitar al resto del personal desde Usuarios, con su rol.
-- 4. Abrir caja y hacer una venta de prueba de $1 para verificar el circuito
--    completo, y después anularla.
-- ============================================================================
