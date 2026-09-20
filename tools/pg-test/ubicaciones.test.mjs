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

// ---------------------------------------------------------------------------
// 0016 · a dónde entra lo que se ingresa al crear un producto
// ---------------------------------------------------------------------------
/** Alta de producto como la hace la pantalla, con lo mínimo. */
const crear = (extra = {}) => ({
  p_name: `Producto ${Math.random().toString(16).slice(2, 8)}`,
  p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
  p_sale_price: 1000, p_avg_cost: 600, p_min_stock: 0,
  p_tracks_expiry: false, p_expiry_alert_days: 30, p_barcodes: null,
  p_initial_stock: 0, ...extra,
});

test('Al crear un producto se dice cuánto queda a la vista y cuánto en bodega', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const r = await rpc(adm, 'fn_create_product', crear({ p_initial_stock: 7, p_initial_stock_sala: 5 }));
  assert.equal(Number(r.stock), 12);
  assert.equal(Number(r.stock_sala), 5);
  assert.equal(Number(r.stock_bodega), 7);
  assert.deepEqual(await invariante(L, r.product_id), { sala: 5, bodega: 7 });
});

test('Se puede crear un producto que queda entero a la vista', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const r = await rpc(adm, 'fn_create_product', crear({ p_initial_stock: 0, p_initial_stock_sala: 9 }));
  assert.deepEqual(await invariante(L, r.product_id), { sala: 9, bodega: 0 });
});

test('Quien no manda el parámetro nuevo obtiene lo de antes: todo a bodega', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const r = await rpc(adm, 'fn_create_product', crear({ p_initial_stock: 4 }));
  assert.deepEqual(await invariante(L, r.product_id), { sala: 0, bodega: 4 });
});

test('Cada carga inicial deja su propio movimiento, y dice a qué lugar entró', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const r = await rpc(adm, 'fn_create_product', crear({ p_initial_stock: 7, p_initial_stock_sala: 5 }));
  const { rows } = await banco.su.query(
    `select ubicacion::text as u, quantity, reason from inventory_movements
      where product_id = $1 and movement_type = 'inventario_inicial' order by quantity`, [r.product_id]);
  assert.deepEqual(rows.map((x) => `${x.u}:${Number(x.quantity)}`), ['sala:5', 'bodega:7']);
  assert.ok(rows.every((x) => /Carga inicial/.test(x.reason)), 'el motivo no dice de qué se trata');
});

test('Una cantidad negativa en cualquiera de los dos lugares no crea nada', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const antes = (await banco.su.query('select count(*)::int as n from products where tenant_id = $1', [L.tenant])).rows[0].n;
  for (const extra of [{ p_initial_stock: -1 }, { p_initial_stock_sala: -1 }]) {
    const r = await intentar(rpc(adm, 'fn_create_product', crear(extra)));
    assert.match(r.error ?? '', /CANTIDAD_NEGATIVA/, JSON.stringify(extra));
  }
  const despues = (await banco.su.query('select count(*)::int as n from products where tenant_id = $1', [L.tenant])).rows[0].n;
  assert.equal(despues, antes, 'quedó un producto a medio crear');
});

test('La ubicación forzada no se le pega al movimiento siguiente', async () => {
  // fn_en_ubicacion es local a la transacción. Si fn_create_product la dejara
  // puesta, la venta que viniera después en la misma transacción entraría en
  // el lugar equivocado.
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  await adm.query('begin');
  const r = await rpc(adm, 'fn_create_product', crear({ p_initial_stock: 0, p_initial_stock_sala: 6 }));
  await rpc(adm, 'fn_adjust_stock', {
    p_product_id: r.product_id, p_new_quantity: 3,
    p_movement_type: 'ajuste_negativo', p_reason: 'conteo' });   // sin ubicación: la sala
  await adm.query('commit');
  assert.deepEqual(await invariante(L, r.product_id), { sala: 3, bodega: 0 });
});
