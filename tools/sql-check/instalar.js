/**
 * Genera `supabase/instalar.sql`: un único archivo que deja la base lista.
 *
 * El bundle traía solo el esquema, así que había que pegar dos archivos en
 * orden y acordarse de cuál iba primero. Peor: el segundo tenía dos variantes
 * —`seed.sql` con 12 productos de ejemplo y `seed-produccion.sql` sin ellos— y
 * equivocarse mete códigos EAN inventados en la base del cliente, que después
 * no se pueden liberar porque `unique (tenant_id, barcode)` los deja ocupados.
 *
 * Este archivo junta esquema + arranque de producción en el orden correcto.
 * Se pega una vez y la base queda vacía de datos pero completa de estructura,
 * que es exactamente lo que hace falta para cargar el catálogo real.
 *
 *   node tools/sql-check/instalar.js  ->  supabase/instalar.sql
 */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const dirMigraciones = path.join(raiz, 'supabase', 'migrations');
const archivoSeed = path.join(raiz, 'supabase', 'seed-produccion.sql');
const salida = path.join(raiz, 'supabase', 'instalar.sql');

const migraciones = fs.readdirSync(dirMigraciones).filter((f) => f.endsWith('.sql')).sort();

const encabezado = `-- ============================================================================
-- RutaAhorro · INSTALACIÓN COMPLETA  (generado, no editar a mano)
--
-- Generado: ${new Date().toISOString()}
-- Contiene: ${migraciones.length} migraciones + arranque de producción
--
-- QUÉ DEJA INSTALADO
--   · Todas las tablas, índices y restricciones
--   · Las funciones de negocio (venta, caja, recepción, ajustes, lotes)
--   · Los disparadores, incluido el que crea el perfil de un usuario nuevo
--   · RLS activa en el 100 % de las tablas, con sus políticas por rol
--   · Las vistas de reporte
--   · Un tenant y una tienda. NINGÚN producto: el catálogo lo carga el cliente
--
-- CÓMO APLICARLO
--   1. Supabase > SQL Editor > New query
--   2. Pegar este archivo completo
--   3. Run
--
-- ANTES DE EJECUTAR: buscar más abajo la línea
--     v_nombre text := 'RutaAhorro';
--   y reemplazarla por el nombre real del local.
--
-- Es idempotente: se puede ejecutar más de una vez sin romper nada.
--
-- DESPUÉS: crear el primer administrador con
--     npm run db:admin -- --correo=dueno@almacen.cl --nombre="Nombre Apellido"
-- ============================================================================


-- ############################################################################
-- PARTE 1 de 2 · ESQUEMA
-- Todo en una transacción: o entra completo, o no entra nada. Un esquema a
-- medias es peor que ninguno.
-- ############################################################################

begin;

`;

const cuerpo = migraciones
  .map((f) => {
    const sql = fs.readFileSync(path.join(dirMigraciones, f), 'utf8');
    return `\n-- >>>>>>>>>>>>>>>>>>>> ${f} <<<<<<<<<<<<<<<<<<<<\n\n${sql}`;
  })
  .join('\n');

const seed = fs.readFileSync(archivoSeed, 'utf8');

const cierre = `

commit;


-- ############################################################################
-- PARTE 2 de 2 · ARRANQUE DE PRODUCCIÓN
-- ############################################################################

${seed}

-- ============================================================================
-- VERIFICACIÓN — ejecutar después y revisar los resultados
-- ============================================================================
-- A) Estructura instalada. Deben salir números, no un error:
--    select
--      (select count(*) from pg_tables where schemaname='public')            as tablas,
--      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public')                                           as funciones,
--      (select count(*) from pg_views where schemaname='public')             as vistas;
--
-- B) La base quedó SIN datos de ejemplo. Los tres deben dar 0:
--    select
--      (select count(*) from products)         as productos,
--      (select count(*) from product_barcodes) as codigos_de_barra,
--      (select count(*) from sales)            as ventas;
--
-- C) Seguridad. Las tres consultas NO deben devolver ninguna fila:
--    -- 1) Tablas sin RLS (RNF-24):
--    select tablename from pg_tables
--     where schemaname = 'public' and not rowsecurity;
--
--    -- 2) Tablas con RLS pero sin política (quedarían inaccesibles):
--    select t.tablename from pg_tables t
--     where t.schemaname = 'public' and t.rowsecurity
--       and not exists (select 1 from pg_policies p
--                        where p.schemaname = 'public' and p.tablename = t.tablename);
--
--    -- 3) Funciones SECURITY DEFINER sin search_path fijo (riesgo de secuestro):
--    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.prosecdef
--       and not exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c
--                        where c like 'search_path=%');
`;

fs.writeFileSync(salida, encabezado + cuerpo + cierre, 'utf8');

const kb = (fs.statSync(salida).size / 1024).toFixed(1);
console.log(`Instalador generado: supabase/instalar.sql  (${kb} KB)`);
console.log(`  esquema: ${migraciones.length} migraciones`);
migraciones.forEach((f) => console.log(`    - ${f}`));
console.log('  arranque: seed-produccion.sql (tenant + tienda, catálogo vacío)');
