/**
 * El instalador, tal como se pega en el SQL Editor de Supabase (B-01).
 *
 * Hasta esto, `instalar.sql` solo se había parseado. Y dos afirmaciones de la
 * documentación dependían de ejecutarlo: que el instalador se puede correr más
 * de una vez, y que las migraciones de seguridad se pueden aplicar sobre una
 * base instalada con una versión anterior.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarBanco, listarMigraciones, leerMigracion, nuevoLocal, rpc, venta } from './banco.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let banco;

before(async () => {
  execFileSync(process.execPath, [path.join(raiz, 'tools', 'sql-check', 'instalar.js')], { stdio: 'ignore' });
  banco = await levantarBanco({ aplicar: false });
});
after(async () => { await banco?.bajar(); });

const instalador = () => fs.readFileSync(path.join(raiz, 'supabase', 'instalar.sql'), 'utf8');

test('instalar.sql se aplica completo sobre una base recién creada', async () => {
  await banco.su.query(instalador());
  const { rows: [t] } = await banco.su.query(`select count(*)::int as n from tenants`);
  const { rows: [s] } = await banco.su.query(`select count(*)::int as n from stores`);
  const { rows: [p] } = await banco.su.query(`select count(*)::int as n from products`);
  assert.equal(t.n, 1, 'un local');
  assert.equal(s.n, 1, 'una tienda');
  assert.equal(p.n, 0, 'sin productos, a propósito');
});

test('RLS activo en todas las tablas de public', async () => {
  const sinRls = await banco.su.query(
    `select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1`);
  assert.deepEqual(sinRls.rows, []);
});

test('las migraciones de seguridad se pueden volver a aplicar sobre una base instalada', async () => {
  // Es lo que HANDOFF le indica a quien ya instaló una versión anterior.
  for (const f of listarMigraciones().filter((f) => f >= '0009')) {
    await assert.doesNotReject(banco.su.query(leerMigracion(f)), `${f} no se puede reaplicar`);
  }
});

test('instalar.sql se puede ejecutar dos veces sin error ni duplicar el local', async () => {
  // Reinstalar es el camino que HANDOFF indica para llevarle los arreglos de
  // seguridad a una base con una versión anterior. Hasta 2026-09-18 la
  // segunda ejecución fallaba en la primera política y no aplicaba nada.
  await assert.doesNotReject(banco.su.query(instalador()));
  const { rows: [t] } = await banco.su.query(`select count(*)::int as n from tenants`);
  assert.equal(t.n, 1);
});

test('Reinstalar sobre una base con ventas no cambia ningún saldo', async () => {
  // Es lo que se hace para llevar una migración nueva a la base real, que ya
  // tiene ventas, recepciones y traspasos.
  const L = await nuevoLocal(banco, 'Con datos');
  const p = await L.producto({ stock: 20 });
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_transfer_stock', { p_product_id: p, p_cantidad: 5 });
  await rpc(adm, 'fn_open_cash_session', { p_opening_amount: 1000 });
  await rpc(adm, 'fn_register_sale', venta(p, 2, 1000));
  const foto = async () => (await banco.su.query(`
    select (select json_agg(t order by product_id) from (select product_id, quantity from stock_levels) t) as total,
           (select json_agg(u order by product_id, ubicacion) from (select product_id, ubicacion, quantity from stock_ubicaciones) u) as ubic,
           (select count(*) from sales) as ventas, (select count(*) from inventory_movements) as kardex`)).rows[0];
  const antes = await foto();
  await adm.end();
  await banco.su.query(instalador());
  assert.deepEqual(await foto(), antes);
});
