/**
 * Deja la base como recién instalada: respalda, borra todo lo de RutaAhorro
 * y vuelve a instalar el esquema.
 *
 *   npm run db:limpiar                     -> solo respalda y dice qué borraría
 *   npm run db:limpiar -- --si-borrar-todo -> respalda, borra y reinstala
 *
 * Para qué existe: los recorridos de `tools/ui/` escriben en el local
 * "QA · pruebas internas" de la misma base, y las pruebas dejan productos y
 * ventas. Antes de mostrarle el sistema al cliente, la base tiene que estar
 * vacía. El kardex y la bitácora son inmutables por diseño (ADR-006): no se
 * borran con DELETE ni siendo el dueño, así que la única forma de dejar la
 * base de cero es esta, borrando los objetos y reinstalando.
 *
 * Borra SOLO lo que instaló este proyecto: no toca extensiones ni los
 * esquemas de Supabase. Los usuarios de acceso (auth.users) sí se borran:
 * sin perfil no sirven de nada.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(raiz, '.env.local') });

const confirmado = process.argv.includes('--si-borrar-todo');
const url = process.env.DATABASE_URL;
if (!url) { console.error('\n✖ Falta DATABASE_URL en .env.local\n'); process.exit(1); }
const partes = url.match(/^\w+:\/\/([^:]+):(.*)@([^@:/]+)(?::(\d+))?\/([^?]*)/);
if (!partes) { console.error('\n✖ DATABASE_URL mal formada\n'); process.exit(1); }
const [, usuario, claveCruda, host, puerto, base] = partes;
let password = claveCruda;
try { if (/%[0-9a-f]{2}/i.test(claveCruda)) password = decodeURIComponent(claveCruda); } catch { /* tal cual */ }
const local = ['localhost', '127.0.0.1'].includes(host);

const db = new pg.Client({
  user: usuario, password, host, port: Number(puerto ?? 5432), database: base || 'postgres',
  ssl: local ? false : { rejectUnauthorized: false },
});
await db.connect();
const q = async (s) => (await db.query(s)).rows;

/** Lo que instaló este proyecto: todo lo de `public` que no viene de una extensión. */
const propios = async (tipos) => (await q(`
  select c.relname as nombre from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in (${tipos})
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
   order by 1`)).map((r) => r.nombre);

const tablas = await propios("'r','p'");
const vistas = await propios("'v','m'");
const funciones = (await q(`
  select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`)).map((r) => r.f);
const tipos = (await q(`
  select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype = 'e'
     and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')`)).map((r) => r.typname);

// ------------------------------------------------------------------ respaldo
const destino = path.join(os.homedir(), `respaldo-rutaahorro-${new Date().toISOString().slice(0, 10)}`);
fs.mkdirSync(destino, { recursive: true });
let filas = 0;
for (const t of tablas) {
  const rows = await q(`select * from public."${t}"`);
  filas += rows.length;
  fs.writeFileSync(path.join(destino, `${t}.json`), JSON.stringify(rows));
}
const usuarios = await q(`select id, email, raw_user_meta_data, created_at from auth.users`);
fs.writeFileSync(path.join(destino, 'auth_users.json'), JSON.stringify(usuarios));
console.log(`\nBase: ${host}`);
console.log(`Respaldo: ${tablas.length} tablas, ${filas} filas y ${usuarios.length} usuarios en ${destino}`);

if (!confirmado) {
  console.log(`\nBorraría ${tablas.length} tablas, ${vistas.length} vistas, ${funciones.length} funciones y ${usuarios.length} usuarios.`);
  console.log('Para hacerlo: npm run db:limpiar -- --si-borrar-todo\n');
  await db.end();
  process.exit(0);
}

// -------------------------------------------------------------------- borrar
await db.query('begin');
for (const v of vistas) await db.query(`drop view if exists public."${v}" cascade`);
for (const t of tablas) await db.query(`drop table if exists public."${t}" cascade`);
for (const f of funciones) await db.query(`drop function if exists ${f} cascade`);
for (const t of tipos) await db.query(`drop type if exists public."${t}" cascade`);
// El disparador de alta de perfiles vive en auth.users y cae con su función.
const borrados = (await q(`delete from auth.users returning id`)).length;
await db.query('commit');
await db.end();
console.log(`Borrado: ${vistas.length} vistas, ${tablas.length} tablas, ${funciones.length} funciones, ${borrados} usuarios.`);

// --------------------------------------------------------------- reinstalar
console.log('Reinstalando el esquema…\n');
execFileSync(process.execPath, [path.join(raiz, 'tools', 'aplicar-esquema.mjs'), '--aplicar'], { stdio: 'inherit' });
console.log('Falta el administrador:  npm run db:admin -- --correo=… --nombre="…"\n');
