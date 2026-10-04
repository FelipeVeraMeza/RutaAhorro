/**
 * docs/28, N° 170 (0037) · Anular una venta en efectivo de una caja que ya
 * se cerró: la plata que se le devuelve al cliente sale de la caja abierta de
 * quien anula, y queda como egreso. Antes el cierre de hoy quedaba con
 * faltante sin explicación.
 *
 * Una venta pagada solo en efectivo lleva boleta y no se anula: se devuelve
 * (0019), y la devolución ya dejaba el egreso. Lo que sí se anula es lo que
 * no lleva boleta nuestra: con tarjeta (voucher) o pago mixto. Por eso las
 * pruebas usan efectivo + débito.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function ventaEnCajaCerrada(L, metodo = 'efectivo') {
  const p = await L.producto({ stock: 10 });
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  const v0 = venta(p, 2, 1000);
  v0.p_payments = metodo === 'efectivo'
    ? [{ method: 'efectivo', amount: 1000 }, { method: 'debito', amount: 1000 }]
    : [{ method: metodo, amount: 2000 }];
  const v = await rpc(caj, 'fn_register_sale', v0);
  const { rows: [s] } = await banco.su.query(
    `select id from cash_sessions where user_id = $1 and status = 'abierta'`, [L.cajero1.id]);
  await rpc(caj, 'fn_close_cash_session', { p_session_id: s.id, p_counted_amount: metodo === 'efectivo' ? 1000 : 0 });
  return v.sale_id;
}

test('N° 170 · sin caja abierta, el admin no anula una venta en efectivo de una caja cerrada', async () => {
  const L = await nuevoLocal(banco, 'Anula sin caja');
  const id = await ventaEnCajaCerrada(L);
  const adm = await banco.como(L.admin);
  const r = await intentar(rpc(adm, 'fn_void_sale', { p_sale_id: id, p_reason: 'cobro equivocado' }));
  assert.match(r.error ?? '', /CAJA_NO_ABIERTA_ANULACION/);
  const { rows: [s] } = await banco.su.query('select status from sales where id = $1', [id]);
  assert.equal(s.status, 'completada', 'la venta quedó anulada sin registrar la salida de la plata');
});

test('N° 170 · con su caja abierta, anularla deja el egreso en esa caja', async () => {
  const L = await nuevoLocal(banco, 'Anula con caja');
  const id = await ventaEnCajaCerrada(L);
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_open_cash_session', { p_opening_amount: 10000 });
  const r = await rpc(adm, 'fn_void_sale', { p_sale_id: id, p_reason: 'cobro equivocado' });
  assert.equal(r.efectivo_devuelto, 1000, 'sale lo que se pagó en efectivo, no lo de la tarjeta');
  const { rows: [s] } = await banco.su.query(
    `select id from cash_sessions where user_id = $1 and status = 'abierta'`, [L.admin.id]);
  const res = await rpc(adm, 'fn_cash_session_summary', { p_session_id: s.id });
  assert.equal(res.cash_out, 1000);
  assert.equal(res.expected_amount, 9000, 'la plata devuelta tiene que salir del esperado de hoy');
});

test('N° 170 · pagada con débito no deja egreso (la reversa es en la máquina)', async () => {
  const L = await nuevoLocal(banco, 'Anula tarjeta');
  const id = await ventaEnCajaCerrada(L, 'debito');
  const adm = await banco.como(L.admin);
  const r = await rpc(adm, 'fn_void_sale', { p_sale_id: id, p_reason: 'cobro equivocado' });
  assert.equal(r.efectivo_devuelto, 0);
});
