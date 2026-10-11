/**
 * 0039 · Revisión del 2026-10-11 (docs/32): caja, ajustes, toma y lotes.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const lotes = async (producto) => (await banco.su.query(
  'select quantity::float as q, expiry_date::text as v from product_lots where product_id = $1 order by expiry_date', [producto])).rows;

test('E · un ajuste a la baja descuenta de los lotes, del que vence antes', async () => {
  const L = await nuevoLocal(banco);
  const yogur = await L.producto({ nombre: 'Yogur', stock: 10, perecible: true });
  await L.lote(yogur, 4, '2099-01-10');
  await L.lote(yogur, 6, '2099-02-10');
  const bod = await banco.como(L.bodega);
  await rpc(bod, 'fn_adjust_stock', { p_product_id: yogur, p_new_quantity: 5, p_movement_type: 'merma', p_reason: 'Vencido' });
  assert.equal(await L.stock(yogur), 5);
  assert.deepEqual((await lotes(yogur)).map((l) => l.q), [0, 5],
    'sale primero el lote que vence antes; antes los lotes quedaban en 4 y 6');
});

test('E · la toma de inventario a la baja también descuenta de los lotes', async () => {
  const L = await nuevoLocal(banco);
  const queso = await L.producto({ nombre: 'Queso', stock: 8, perecible: true });
  await L.lote(queso, 8, '2099-03-01');
  const adm = await banco.como(L.admin);
  const { rows: [c] } = await adm.query(
    `insert into stock_counts (tenant_id, store_id) values ($1, $2) returning id`, [L.tenant, L.store]);
  await rpc(adm, 'fn_apply_stock_count', { p_count_id: c.id, p_items: [{ product_id: queso, counted_qty: 3 }] });
  assert.equal(await L.stock(queso), 3);
  assert.deepEqual((await lotes(queso)).map((l) => l.q), [3]);
});

test('E · ajuste y toma rechazan cantidades negativas o con decimales, y productos de otro local', async () => {
  const L = await nuevoLocal(banco);
  const otro = await nuevoLocal(banco, 'Otro');
  const arroz = await L.producto({ nombre: 'Arroz', stock: 5 });
  const ajeno = await otro.producto({ nombre: 'Ajeno', stock: 5 });
  const adm = await banco.como(L.admin);
  const ajustar = (p, n) => intentar(rpc(adm, 'fn_adjust_stock', {
    p_product_id: p, p_new_quantity: n, p_movement_type: 'ajuste_negativo', p_reason: 'prueba' }));
  assert.match((await ajustar(arroz, -3)).error, /CANTIDAD_INVALIDA/);
  assert.match((await ajustar(arroz, 2.5)).error, /CANTIDAD_ENTERA/);
  assert.match((await ajustar(ajeno, 1)).error, /PRODUCTO_NO_ENCONTRADO/);
  assert.equal(await otro.stock(ajeno), 5, 'el stock del otro local no se toca');

  const { rows: [c] } = await adm.query(
    `insert into stock_counts (tenant_id, store_id) values ($1, $2) returning id`, [L.tenant, L.store]);
  const tomar = (items) => intentar(rpc(adm, 'fn_apply_stock_count', { p_count_id: c.id, p_items: items }));
  assert.match((await tomar([{ product_id: arroz, counted_qty: -1 }])).error, /CANTIDAD_INVALIDA/);
  assert.match((await tomar([{ product_id: arroz, counted_qty: 1.5 }])).error, /CANTIDAD_INVALIDA/);
  assert.match((await tomar([{ product_id: arroz, counted_qty: 4 }, { product_id: ajeno, counted_qty: 0 }])).error,
    /PRODUCTO_NO_ENCONTRADO/);
  assert.equal(await L.stock(arroz), 5, 'una línea mala no deja la toma a medias');
  const { rows: [sc] } = await banco.su.query(
    `select count(*)::int as n from stock_levels where product_id = $1 and store_id = $2`, [ajeno, L.store]);
  assert.equal(sc.n, 0, 'no se le crea stock en este local a un producto ajeno');
});

test('E · bodega no abre caja; contar no da negativo; una cuenta desactivada no mueve plata', async () => {
  const L = await nuevoLocal(banco);
  const bod = await banco.como(L.bodega);
  assert.match((await intentar(rpc(bod, 'fn_open_cash_session', { p_opening_amount: 0 }))).error, /SIN_PERMISO/);

  const caj = await banco.como(L.cajero1);
  assert.match((await intentar(rpc(caj, 'fn_open_cash_session', { p_opening_amount: -100 }))).error, /MONTO_INVALIDO/);
  const s = await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 20000 });
  assert.match((await intentar(rpc(caj, 'fn_close_cash_session', {
    p_session_id: s.session_id, p_counted_amount: -5000, p_notes: 'x' }))).error, /MONTO_INVALIDO/);

  await banco.su.query('update profiles set is_active = false where id = $1', [L.cajero1.id]);
  assert.match((await intentar(rpc(caj, 'fn_add_cash_movement', {
    p_type: 'egreso', p_amount: 1000, p_reason: 'retiro' }))).error, /NO_AUTENTICADO/);
  const { rows: [m] } = await banco.su.query(
    'select count(*)::int as n from cash_movements where cash_session_id = $1', [s.session_id]);
  assert.equal(m.n, 0);
});

test('E · una venta con la hora del celular adelantada queda con la del servidor', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 10 });
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  const manana = new Date(Date.now() + 26 * 3600_000).toISOString();
  const r = await rpc(caj, 'fn_register_sale', {
    p_client_uuid: crypto.randomUUID(),
    p_items: [{ product_id: pan, quantity: 1, unit_price: 1000, discount_amount: 0 }],
    p_payments: [{ method: 'efectivo', amount: 1000 }],
    p_sold_at: manana,
  });
  const { rows: [v] } = await banco.su.query(
    `select extract(epoch from (now() - sold_at))::int as atras from sales where id = $1`, [r.sale_id]);
  assert.ok(v.atras >= 0 && v.atras < 120, `quedó con la hora del servidor (atrás ${v.atras} s)`);
});
