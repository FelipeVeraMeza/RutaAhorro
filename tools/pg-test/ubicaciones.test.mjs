/**
 * Bodega y sala de ventas (0014). La regla que no se puede romper:
 * sala + bodega = total del local = suma del kardex, siempre.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, esperarBloqueo, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function ubicaciones(local, producto) {
  const { rows } = await banco.su.query(
    `select ubicacion::text, quantity from stock_ubicaciones where store_id = $1 and product_id = $2`,
    [local.store, producto]);
  const r = { sala: 0, bodega: 0 };
  for (const x of rows) r[x.ubicacion] = Number(x.quantity);
  return r;
}

async function invariante(local, producto) {
  const u = await ubicaciones(local, producto);
  const total = await local.stock(producto);
  const { rows: [k] } = await banco.su.query(
    `select coalesce(sum(quantity),0) as q from inventory_movements where store_id = $1 and product_id = $2`,
    [local.store, producto]);
  assert.equal(u.sala + u.bodega, total, 'sala + bodega no suma el total');
  assert.equal(total, Number(k.q), 'el total no coincide con el kardex');
  return u;
}

async function proveedor(local) {
  return (await banco.su.query(
    `insert into suppliers (tenant_id, name) values ($1, 'Prov') returning id`, [local.tenant])).rows[0].id;
}

async function recibir(local, usuario, producto, cantidad) {
  await rpc(await banco.como(usuario), 'fn_confirm_receipt', {
    p_supplier_id: await proveedor(local), p_items: [{ product_id: producto, quantity: cantidad, unit_cost: 500 }] });
}

test('Lo que llega del proveedor entra a la bodega', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  await recibir(L, L.bodega, p, 10);
  assert.deepEqual(await invariante(L, p), { sala: 0, bodega: 10 });
});

test('Reponer la sala mueve de bodega a sala sin cambiar el total', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  await recibir(L, L.admin, p, 10);
  // Lo puede hacer un vendedor: en un almacén chico repone el que vende.
  const r = await rpc(await banco.como(L.cajero1), 'fn_transfer_stock', { p_product_id: p, p_cantidad: 4 });
  assert.equal(Number(r.sala), 4);
  assert.deepEqual(await invariante(L, p), { sala: 4, bodega: 6 });
  assert.equal(await L.stock(p), 10);
  const { rows } = await banco.su.query(
    `select ubicacion::text as u, quantity from inventory_movements
      where product_id = $1 and movement_type = 'traslado' order by quantity`, [p]);
  assert.deepEqual(rows.map((x) => `${x.u}${Number(x.quantity)}`), ['bodega-4', 'sala4']);
});

test('No se puede sacar de la bodega más de lo que hay', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  await recibir(L, L.admin, p, 3);
  const r = await intentar(rpc(await banco.como(L.cajero1), 'fn_transfer_stock', { p_product_id: p, p_cantidad: 5 }));
  assert.match(r.error ?? '', /STOCK_INSUFICIENTE_EN_UBICACION/);
  assert.deepEqual(await invariante(L, p), { sala: 0, bodega: 3 });
});

test('La venta descuenta de la sala; si la sala no alcanza, vende igual', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  const adm = await banco.como(L.admin);
  await recibir(L, L.admin, p, 10);
  await rpc(adm, 'fn_transfer_stock', { p_product_id: p, p_cantidad: 2 });
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  // 2 en sala y 8 en bodega: un vendedor puede vender 3, porque el total alcanza.
  const { sale_id } = await rpc(caj, 'fn_register_sale', venta(p, 3, 1000));
  assert.deepEqual(await invariante(L, p), { sala: -1, bodega: 8 });
  // Y la anulación devuelve a la sala.
  await rpc(adm, 'fn_void_sale', { p_sale_id: sale_id, p_reason: 'prueba' });
  assert.deepEqual(await invariante(L, p), { sala: 2, bodega: 8 });
});

test('Ajuste y toma en una ubicación elegida', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  const sup = await banco.como(L.supervisor);
  await recibir(L, L.supervisor, p, 10);
  await rpc(sup, 'fn_adjust_stock', {
    p_product_id: p, p_new_quantity: 7, p_movement_type: 'ajuste_negativo', p_reason: 'conteo', p_ubicacion: 'bodega' });
  assert.deepEqual(await invariante(L, p), { sala: 0, bodega: 7 });
  // Sin decir ubicación, el ajuste es de la sala.
  await rpc(sup, 'fn_adjust_stock', {
    p_product_id: p, p_new_quantity: 2, p_movement_type: 'ajuste_positivo', p_reason: 'encontrado' });
  assert.deepEqual(await invariante(L, p), { sala: 2, bodega: 7 });

  const toma = (await banco.su.query(
    `insert into stock_counts (tenant_id, store_id) values ($1, $2) returning id`, [L.tenant, L.store])).rows[0].id;
  await rpc(sup, 'fn_apply_stock_count', {
    p_count_id: toma, p_items: [{ product_id: p, counted_qty: 5 }], p_ubicacion: 'bodega' });
  assert.deepEqual(await invariante(L, p), { sala: 2, bodega: 5 });
});

test('Dos reposiciones a la vez no sacan de la bodega lo que no hay', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  await recibir(L, L.admin, p, 5);
  const s1 = await banco.como(L.cajero1);
  const s2 = await banco.como(L.cajero2);
  await s1.query('begin');
  await rpc(s1, 'fn_transfer_stock', { p_product_id: p, p_cantidad: 4 });
  const segunda = intentar(rpc(s2, 'fn_transfer_stock', { p_product_id: p, p_cantidad: 4 }));
  await esperarBloqueo(banco, s2.pid);
  await s1.query('commit');
  assert.match((await segunda).error ?? '', /STOCK_INSUFICIENTE_EN_UBICACION/);
  assert.deepEqual(await invariante(L, p), { sala: 4, bodega: 1 });
});

test('El stock inicial queda en bodega y la reconstrucción cuadra', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 12 });
  assert.deepEqual(await invariante(L, p), { sala: 0, bodega: 12 });
  const r = await banco.su.query(`select fn_rebuild_stock_levels($1) as r`, [L.tenant]);
  assert.equal(r.rows[0].r.corrected_locations, 0, 'la reconstrucción encontró diferencias');
});

test('Nadie escribe las ubicaciones a mano', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 3 });
  const r = await intentar((await banco.como(L.admin)).query(
    `update stock_ubicaciones set quantity = 999 where product_id = $1`, [p]));
  assert.equal(r.ok, false);
  assert.deepEqual(await ubicaciones(L, p), { sala: 0, bodega: 3 });
});
