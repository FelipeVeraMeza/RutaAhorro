/**
 * 0031 · Anular una recepción deshace el lote, el costo promedio y la factura
 * por pagar (docs/26, N° 64 a 66).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

test('anular devuelve el costo promedio, vacía el lote y anula la factura pendiente', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const leche = (await banco.su.query(
    `insert into products (tenant_id, name, sale_price, avg_cost, last_cost, tracks_expiry, expiry_alert_days)
     values ($1, 'Leche', 1190, 800, 800, true, 5) returning id`, [L.tenant])).rows[0].id;
  const prov = (await banco.su.query(`insert into suppliers (tenant_id, name) values ($1, 'Lácteos') returning id`, [L.tenant])).rows[0].id;
  const recibir = (cant, costo, num) => rpc(adm, 'fn_confirm_receipt', {
    p_supplier_id: prov, p_document_type: 'factura', p_document_number: num, p_received_at: new Date().toISOString(),
    p_items: [{ product_id: leche, quantity: cant, unit_cost: costo, lot_code: 'L1', expiry_date: '2099-01-31' }],
  });
  await recibir(10, 800, 'F-1');
  // Mal tecleado: 8000 en vez de 800. El promedio se dispara.
  const mala = await recibir(10, 8000, 'F-2');
  await rpc(adm, 'fn_registrar_factura_proveedor', { p_datos: { receipt_id: mala.receipt_id, vence: '2099-02-28' } });
  let { rows: [p] } = await banco.su.query('select avg_cost from products where id = $1', [leche]);
  assert.equal(p.avg_cost, 4400);

  const r = await rpc(adm, 'fn_void_receipt', { p_receipt_id: mala.receipt_id, p_reason: 'Costo mal escrito' });
  ({ rows: [p] } = await banco.su.query('select avg_cost from products where id = $1', [leche]));
  assert.equal(p.avg_cost, 800, 'el promedio vuelve al de antes de la recepción anulada');
  const { rows: [lote] } = await banco.su.query('select quantity from product_lots where product_id = $1', [leche]);
  assert.equal(Number(lote.quantity), 10, 'el lote queda con lo de la primera recepción, no con 20');
  const { rows: [f] } = await banco.su.query('select anulada_en, anulada_motivo from facturas_proveedor where receipt_id = $1', [mala.receipt_id]);
  assert.ok(f.anulada_en, 'la factura por pagar se anula con la recepción');
  assert.match(f.anulada_motivo, /Recepción anulada/);
  assert.equal(r.factura_ya_pagada, false);
  assert.equal(await L.stock(leche), 10);
});

test('el kardex sigue inmutable: solo se acepta anotar el lote una vez', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const pan = (await banco.su.query(
    `insert into products (tenant_id, name, sale_price, avg_cost, last_cost, tracks_expiry, expiry_alert_days)
     values ($1, 'Pan', 990, 500, 500, true, 2) returning id`, [L.tenant])).rows[0].id;
  const prov = (await banco.su.query(`insert into suppliers (tenant_id, name) values ($1, 'Panadería') returning id`, [L.tenant])).rows[0].id;
  const r = await rpc(adm, 'fn_confirm_receipt', {
    p_supplier_id: prov, p_document_type: 'factura', p_document_number: 'P-1', p_received_at: new Date().toISOString(),
    p_items: [{ product_id: pan, quantity: 5, unit_cost: 500, lot_code: null, expiry_date: '2099-01-02' }],
  });
  const { rows: [m] } = await banco.su.query(
    `select id, lot_id from inventory_movements where reference_id = $1 and product_id = $2`, [r.receipt_id, pan]);
  assert.ok(m.lot_id, 'recibir un perecible deja el movimiento con su lote');
  await assert.rejects(banco.su.query('update inventory_movements set quantity = 50 where id = $1', [m.id]), /REGISTRO_INMUTABLE/);
  await assert.rejects(banco.su.query('update inventory_movements set lot_id = null where id = $1', [m.id]), /REGISTRO_INMUTABLE/);
  await assert.rejects(banco.su.query('update inventory_movements set lot_id = gen_random_uuid() where id = $1', [m.id]), /REGISTRO_INMUTABLE/);
  await assert.rejects(banco.su.query('delete from inventory_movements where id = $1', [m.id]), /REGISTRO_INMUTABLE/);
});
