/**
 * tools/limpiar-movimientos.mjs · borra lo de prueba de un local y deja la
 * mercadería (Felipe, 2026-10-07).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';
import { limpiarMovimientos, TABLAS_A_BORRAR } from '../limpiar-movimientos.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const contar = async (tabla, tenant) =>
  (await banco.su.query(`select count(*)::int as n from ${tabla} where tenant_id = $1`, [tenant])).rows[0].n;

async function localConMovimientos(nombre) {
  const L = await nuevoLocal(banco, nombre);
  const camaron = await L.producto({ nombre: 'Camarón 36/40', precio: 6990, costo: 4500, stock: 10 });
  await banco.su.query(`insert into product_barcodes (tenant_id, product_id, barcode) values ($1, $2, $3)`,
    [L.tenant, camaron, `780${nombre.length}0000000`]);
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 20000 });
  await rpc(caj, 'fn_register_sale', venta(camaron, 6, 6990, { metodo: 'debito' }));
  await rpc(caj, 'fn_register_sale', venta(camaron, 1, 6990));
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_adjust_stock', { p_product_id: camaron, p_new_quantity: 2000, p_movement_type: 'ajuste_positivo', p_reason: 'Diferencia de conteo' });
  await banco.su.query(`update products set sale_price = 7490 where id = $1`, [camaron]);
  return { L, camaron };
}

test('borra ventas, cajas, kardex y bitácora del local; deja productos, códigos y usuarios', async () => {
  const { L, camaron } = await localConMovimientos('Almacén');
  const antes = await limpiarMovimientos(banco.su, L.tenant);
  assert.equal(antes.sales, 2, 'el modo de prueba cuenta');
  assert.equal(await contar('sales', L.tenant), 2, 'y no borra nada');

  await limpiarMovimientos(banco.su, L.tenant, { aplicar: true });
  for (const t of TABLAS_A_BORRAR) assert.equal(await contar(t, L.tenant), 0, t);
  assert.equal(await L.stock(camaron), 0, 'el stock queda en 0, como dice el kardex vacío');
  const { rows: [p] } = await banco.su.query('select name, sale_price from products where id = $1', [camaron]);
  assert.deepEqual(p, { name: 'Camarón 36/40', sale_price: 7490 }, 'el producto queda con su precio');
  assert.equal(await contar('product_barcodes', L.tenant), 1);
  assert.equal(await contar('profiles', L.tenant), 5);
  const { rows: [f] } = await banco.su.query('select last_folio from folio_counters where tenant_id = $1', [L.tenant]);
  assert.equal(Number(f?.last_folio ?? 0), 0, 'el folio vuelve a partir');
});

test('no toca otro local, y el kardex y la bitácora siguen siendo inmutables después', async () => {
  const a = await localConMovimientos('Uno');
  const b = await localConMovimientos('Otro local');
  const ventasDeB = await contar('sales', b.L.tenant);
  await limpiarMovimientos(banco.su, a.L.tenant, { aplicar: true });
  assert.equal(await contar('sales', b.L.tenant), ventasDeB);
  assert.equal(await b.L.stock(b.camaron), 2000);

  const kardex = await intentar(banco.su.query('delete from inventory_movements where tenant_id = $1', [b.L.tenant]));
  assert.equal(kardex.ok, false, 'los disparadores quedaron encendidos');
  const bitacora = await intentar(banco.su.query('delete from audit_log where tenant_id = $1', [b.L.tenant]));
  assert.equal(bitacora.ok, false);
});

test('después de limpiar se puede abrir caja y vender de nuevo, con folio 1', async () => {
  const { L, camaron } = await localConMovimientos('De nuevo');
  await limpiarMovimientos(banco.su, L.tenant, { aplicar: true });
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_adjust_stock', { p_product_id: camaron, p_new_quantity: 5, p_movement_type: 'ajuste_positivo', p_reason: 'Conteo inicial' });
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  const r = await rpc(caj, 'fn_register_sale', venta(camaron, 1, 7490));
  assert.equal(Number(r.folio), 1);
  assert.equal(await L.stock(camaron), 4);
});
