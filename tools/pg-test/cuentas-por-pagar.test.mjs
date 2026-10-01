/**
 * 0030 · Cuentas por pagar a proveedores (RF-M3-13).
 *
 *  · Se registra desde la recepción (proveedor, número y monto salen de ella).
 *  · Una factura no se ingresa dos veces ni se paga dos veces.
 *  · Pagada con efectivo de la caja, sale como egreso de la caja de quien paga.
 *  · Bodega la puede registrar al recibir, pero no ve lo adeudado.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function local() {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ nombre: 'Bebida', precio: 1500, costo: 900 });
  const proveedor = (await banco.su.query(
    `insert into suppliers (tenant_id, name) values ($1, 'Distribuidora Sur') returning id`, [L.tenant])).rows[0].id;
  const adm = await banco.como(L.admin);
  const sup = await banco.como(L.supervisor);
  const bod = await banco.como(L.bodega);
  const caj = await banco.como(L.cajero1);
  return { L, p, proveedor, adm, sup, bod, caj };
}

test('RF-M3-13 · bodega la registra al recibir; los datos salen de la recepción', async () => {
  const { p, proveedor, bod, sup } = await local();
  const rec = await rpc(bod, 'fn_confirm_receipt', {
    p_supplier_id: proveedor, p_document_type: 'factura', p_document_number: 'F-1001',
    p_received_at: new Date().toISOString(), p_items: [{ product_id: p, quantity: 10, unit_cost: 900 }],
  });
  const id = await rpc(bod, 'fn_registrar_factura_proveedor', { p_datos: { receipt_id: rec.receipt_id, vence: '2026-10-30' } });
  // Bodega no lista lo adeudado (RLS); el supervisor sí.
  assert.equal((await bod.query('select id from facturas_proveedor')).rowCount, 0);
  const { rows: [f] } = await sup.query('select supplier_id, numero, monto, vence::text from facturas_proveedor where id = $1', [id]);
  assert.deepEqual(f, { supplier_id: proveedor, numero: 'F-1001', monto: 9000, vence: '2026-10-30' });

  const otra = await intentar(rpc(bod, 'fn_registrar_factura_proveedor', { p_datos: { receipt_id: rec.receipt_id, vence: '2026-10-30' } }));
  assert.match(otra.error, /FACTURA_PROVEEDOR_DUPLICADA/);
});

test('RF-M3-13 · validaciones: vencimiento, proveedor, monto; el vendedor no registra', async () => {
  const { proveedor, adm, caj } = await local();
  for (const [datos, error] of [
    [{ supplier_id: proveedor, numero: '1', monto: 1000 }, /VENCIMIENTO_FACTURA_REQUERIDO/],
    [{ numero: '1', monto: 1000, vence: '2026-10-10' }, /PROVEEDOR_REQUERIDO/],
    [{ supplier_id: proveedor, numero: '1', monto: 0, vence: '2026-10-10' }, /MONTO_INVALIDO/],
    [{ supplier_id: proveedor, numero: '1', monto: 10, emitida: '2026-10-10', vence: '2026-10-01' }, /VENCE_ANTES_DE_EMITIDA/],
  ]) {
    const r = await intentar(rpc(adm, 'fn_registrar_factura_proveedor', { p_datos: datos }));
    assert.match(r.error, error);
  }
  const vend = await intentar(rpc(caj, 'fn_registrar_factura_proveedor', { p_datos: { supplier_id: proveedor, numero: '9', monto: 10, vence: '2026-10-10' } }));
  assert.equal(vend.ok, false);
  // Y nadie escribe la tabla directo (regla 14).
  const directo = await intentar(adm.query(
    `insert into facturas_proveedor (tenant_id, supplier_id, numero, vence, monto) select tenant_id, id, 'X', current_date, 1 from suppliers where id = $1`, [proveedor]));
  assert.equal(directo.ok, false);
});

test('RF-M3-13 · se paga una vez; con efectivo de la caja sale como egreso', async () => {
  const { proveedor, adm, sup } = await local();
  const id = await rpc(adm, 'fn_registrar_factura_proveedor', { p_datos: { supplier_id: proveedor, numero: 'F-7', monto: 45000, vence: '2026-10-05' } });
  const sinCaja = await intentar(rpc(sup, 'fn_pagar_factura_proveedor', { p_id: id, p_metodo: 'efectivo_caja' }));
  assert.match(sinCaja.error, /CAJA_NO_ABIERTA/);
  await rpc(sup, 'fn_open_cash_session', { p_opening_amount: 100000 });
  await rpc(sup, 'fn_pagar_factura_proveedor', { p_id: id, p_metodo: 'efectivo_caja' });
  const dos = await intentar(rpc(adm, 'fn_pagar_factura_proveedor', { p_id: id, p_metodo: 'transferencia' }));
  assert.match(dos.error, /FACTURA_YA_PAGADA/);

  const { rows: [s] } = await sup.query(`select id from cash_sessions where user_id = auth.uid() and status = 'abierta'`);
  const res = await rpc(sup, 'fn_cash_session_summary', { p_session_id: s.id });
  assert.equal(res.cash_out, 45000);
  assert.equal(res.expected_amount, 55000);

  const anular = await intentar(rpc(adm, 'fn_anular_factura_proveedor', { p_id: id, p_motivo: 'error' }));
  assert.match(anular.error, /FACTURA_YA_PAGADA/, 'una pagada no se anula');
});

test('RF-M3-13 · anular libera el número; solo admin', async () => {
  const { proveedor, adm, sup } = await local();
  const id = await rpc(adm, 'fn_registrar_factura_proveedor', { p_datos: { supplier_id: proveedor, numero: 'f-8', monto: 1000, vence: '2026-10-05' } });
  const s = await intentar(rpc(sup, 'fn_anular_factura_proveedor', { p_id: id, p_motivo: 'mal ingresada' }));
  assert.equal(s.ok, false);
  await rpc(adm, 'fn_anular_factura_proveedor', { p_id: id, p_motivo: 'mal ingresada' });
  // El mismo número (aunque con otra mayúscula) se puede volver a ingresar.
  assert.ok(await rpc(adm, 'fn_registrar_factura_proveedor', { p_datos: { supplier_id: proveedor, numero: 'F-8', monto: 1100, vence: '2026-10-05' } }));
});

test('bodega no cambia el precio por ningún camino; sí edita el resto y recibe', async () => {
  const { p, proveedor, bod, sup } = await local();
  const editar = (c, precio, nombre = 'Bebida') => rpc(c, 'fn_update_product', {
    p_product_id: p, p_name: nombre, p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
    p_sale_price: precio, p_avg_cost: null, p_min_stock: 2, p_tracks_expiry: false, p_expiry_alert_days: null, p_barcodes: null,
  });
  const r = await intentar(editar(bod, 999));
  assert.match(r.error, /SIN_PERMISO_PRECIO/);
  assert.ok((await intentar(editar(bod, 1500, 'Bebida 1,5 L'))).ok, 'con el mismo precio, bodega edita el nombre');
  assert.ok((await intentar(editar(bod, null, 'Bebida cola'))).ok, 'y sin mandar precio, también');
  // La recepción de bodega recalcula el costo: eso no es cambiar el precio.
  assert.ok((await intentar(rpc(bod, 'fn_confirm_receipt', {
    p_supplier_id: proveedor, p_document_type: 'guia', p_document_number: 'G-1',
    p_received_at: new Date().toISOString(), p_items: [{ product_id: p, quantity: 5, unit_cost: 1000 }],
  }))).ok);
  assert.ok((await intentar(editar(sup, 1590))).ok, 'el supervisor sí');
  const { rows: [x] } = await banco.su.query('select sale_price, name from products where id = $1', [p]);
  assert.deepEqual(x, { sale_price: 1590, name: 'Bebida' });
});
