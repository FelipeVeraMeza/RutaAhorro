/**
 * Aplica `supabase/instalar.sql` en la base real y verifica que quedó bien (B-01).
 *
 * Hasta ahora el paso era pegar el archivo en el SQL Editor de Supabase. Eso
 * funciona, pero no deja verificación: nadie revisaba después si RLS quedó
 * activo en todo, o si alguna función interna quedó expuesta. Este script
 * hace las dos cosas, y las mismas comprobaciones que `db:test` corre contra
 * la réplica local, ahora contra la base de verdad.
 *
 *   npm run db:aplicar              ->  solo diagnostica, no escribe nada
 *   npm run db:aplicar -- --aplicar ->  instala (o reinstala) el esquema
 *
 * Usa DATABASE_URL de .env.local: Supabase > Project Settings > Database >
 * Connection string, con la contraseña real de la base.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(raiz, '.env.local') });

const aplicar = process.argv.includes('--aplicar');

function morir(mensaje) {
  console.error(`\n✖ ${mensaje}\n`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) morir('Falta DATABASE_URL en .env.local');
const clave = decodeURIComponent(url.replace(/^[^:]+:\/\/[^:]+:/, '').split('@')[0] ?? '');
if (!clave || /YOUR|PASSWORD|\[|\]|<|>/i.test(clave)) {
  morir('DATABASE_URL todavía tiene la contraseña de ejemplo.\n' +
    '  Supabase > Project Settings > Database > Connection string, y reemplázala en .env.local.\n' +
    '  No la pegues en un chat: basta con que esté en el archivo.');
}

// Las mismas listas que tools/pg-test/seguridad.test.mjs. Si cambian allá,
// cambian acá: son la definición de "la base quedó cerrada".
const RPC_PERMITIDAS = [
  'current_store_id', 'current_tenant_id', 'current_user_role', 'is_active_user',
  'fn_add_cash_movement', 'fn_adjust_stock', 'fn_apply_stock_count',
  'fn_cash_session_summary', 'fn_close_cash_session', 'fn_confirm_receipt',
  'fn_create_product', 'fn_open_cash_session', 'fn_register_sale',
  'fn_update_product', 'fn_void_receipt', 'fn_void_sale', 'fn_write_off_lot',
].sort();

const local = ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
const db = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
await db.connect().catch((e) => morir(`No se pudo conectar: ${e.message}`));

const existe = async (tabla) =>
  (await db.query(`select to_regclass($1) is not null as ok`, [`public.${tabla}`])).rows[0].ok;

console.log(`\nBase: ${new URL(url).host}`);
console.log(`Esquema instalado: ${(await existe('tenants')) ? 'sí' : 'no'}`);

if (aplicar) {
  execFileSync(process.execPath, [path.join(raiz, 'tools', 'sql-check', 'instalar.js')], { stdio: 'ignore' });
  const sql = fs.readFileSync(path.join(raiz, 'supabase', 'instalar.sql'), 'utf8');
  process.stdout.write('Aplicando instalar.sql… ');
  try {
    await db.query(sql);
  } catch (e) {
    await db.query('rollback').catch(() => {});
    console.log('falló.');
    morir(`${e.message}\n  Va en una transacción: no quedó nada a medias.`);
  }
  console.log('listo.');
}

if (!(await existe('tenants'))) {
  await db.end();
  console.log('\nNada que verificar todavía. Para instalar: npm run db:aplicar -- --aplicar\n');
  process.exit(0);
}

// ------------------------------------------------------------------ verificar
const fallas = [];
const q = async (sql) => (await db.query(sql)).rows;

const sinRls = await q(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
if (sinRls.length) fallas.push(`Tablas sin RLS: ${sinRls.map((r) => r.tablename).join(', ')}`);

const ejecutables = async (rol) => (await q(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('${rol}', p.oid, 'execute') order by 1`)).map((r) => r.proname);

const auth = await ejecutables('authenticated');
const deMas = auth.filter((f) => !RPC_PERMITIDAS.includes(f));
const faltan = RPC_PERMITIDAS.filter((f) => !auth.includes(f));
if (deMas.length) fallas.push(`authenticated ejecuta funciones internas: ${deMas.join(', ')}`);
if (faltan.length) fallas.push(`authenticated no puede ejecutar: ${faltan.join(', ')} (la app fallaría)`);
const anon = await ejecutables('anon');
if (anon.length) fallas.push(`anon ejecuta: ${anon.join(', ')}`);

const escrituras = await q(`
  select tablename, policyname from pg_policies
   where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
     and tablename in ('sales','sale_items','sale_payments','cash_sessions','cash_movements',
                       'audit_log','price_history','inventory_movements','stock_levels',
                       'product_lots','purchase_receipts','purchase_receipt_items')`);
if (escrituras.length) {
  fallas.push(`Políticas de escritura que no deberían existir: ${escrituras.map((r) => `${r.tablename}.${r.policyname}`).join(', ')}`);
}

const [locales] = await q(`select count(*)::int as n from tenants`);
const [perfiles] = await q(`select count(*)::int as n from profiles`);

console.log(`Locales: ${locales.n} · perfiles: ${perfiles.n}`);
console.log(`Funciones expuestas a authenticated: ${auth.length} (esperadas ${RPC_PERMITIDAS.length})`);
await db.end();

if (fallas.length) {
  console.error('\n✖ La base NO quedó como debe:');
  for (const f of fallas) console.error(`  · ${f}`);
  process.exit(1);
}
console.log('\n✔ RLS en todas las tablas, ninguna función interna expuesta, anon sin acceso.\n');
