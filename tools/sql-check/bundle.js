/**
 * Concatena todas las migraciones en un único archivo listo para pegar en el
 * SQL Editor de Supabase.
 *
 * Existe porque este entorno no tiene la CLI de Supabase: sin `supabase db push`,
 * la forma práctica de aplicar el esquema es copiar un archivo y ejecutarlo.
 * Todo va dentro de una transacción: o se aplica el esquema completo, o no se
 * aplica nada. Un esquema a medias es peor que ninguno.
 *
 *   node tools/sql-check/bundle.js  ->  supabase/bundle.sql
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');
const out = path.resolve(__dirname, '..', '..', 'supabase', 'bundle.sql');

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const header = `-- ============================================================================
-- RutaAhorro · BUNDLE DE MIGRACIONES  (generado, no editar a mano)
-- Generado: ${new Date().toISOString()}
-- Fuente:   supabase/migrations/*.sql  (${files.length} archivos)
--
-- CÓMO APLICARLO
--   1. Supabase > SQL Editor > New query
--   2. Pegar este archivo completo
--   3. Run
--
-- Es idempotente: usa IF NOT EXISTS / CREATE OR REPLACE, así que puede
-- ejecutarse más de una vez sin romper nada.
-- ============================================================================

begin;

`;

const body = files
  .map((f) => {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    return `\n-- >>>>>>>>>>>>>>>>>>>> ${f} <<<<<<<<<<<<<<<<<<<<\n\n${sql}`;
  })
  .join('\n');

const footer = `

commit;

-- ============================================================================
-- VERIFICACIÓN POST-INSTALACIÓN
-- Las tres consultas siguientes NO deben devolver ninguna fila.
-- Si alguna devuelve algo, el esquema quedó inseguro.
-- ============================================================================
-- 1) Tablas sin RLS (RNF-24):
--    select tablename from pg_tables
--     where schemaname = 'public' and not rowsecurity;
--
-- 2) Tablas con RLS pero sin ninguna política (quedarían inaccesibles):
--    select t.tablename from pg_tables t
--     where t.schemaname = 'public' and t.rowsecurity
--       and not exists (select 1 from pg_policies p
--                        where p.schemaname = 'public' and p.tablename = t.tablename);
--
-- 3) Funciones SECURITY DEFINER sin search_path fijo (riesgo de secuestro):
--    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.prosecdef
--       and not exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c
--                        where c like 'search_path=%');
`;

fs.writeFileSync(out, header + body + footer, 'utf8');

const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`Bundle generado: supabase/bundle.sql  (${files.length} migraciones, ${kb} KB)`);
files.forEach((f) => console.log(`  - ${f}`));
