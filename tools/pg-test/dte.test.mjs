/**
 * 0019 · Boletas, facturas y notas de crédito (simulador) y devoluciones.
 *
 * Las reglas de docs/18 §4.3, ejecutadas: el documento nace en la misma
 * transacción que la venta, el folio es correlativo por tipo y no se repite
 * bajo concurrencia, el documento no se edita ni se borra, y una devolución
 * emite la nota de crédito que lo corrige. Al final, el XML que arma core
 * desde lo que quedó en la base tiene que cuadrar.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, esperarBloqueo } from './banco.mjs';
import { desdeRegistro, validarDte, construirXmlDte, montosDevolucion } from '../../packages/core/dist/index.js';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const RUT_OK = '76.086.428-5';

async function mostrador() {
  const L = await nuevoLocal(banco);
  const jugo = await L.producto({ nombre: 'Jugo', precio: 1400, stock: 100 });
  const bebida = await L.producto({ nombre: 'Bebida', precio: 1990, stock: 100 });
  const adm = await banco.como(L.admin);
  const sup = await banco.como(L.supervisor);
  const caj = await banco.como(L.cajero1);
  for (const c of [adm, sup, caj]) await rpc(c, 'fn_open_cash_session', { p_opening_amount: 20000 });
  return { L, jugo, bebida, adm, sup, caj };
}

function venta(lineas, { metodo = 'efectivo', documento, descuento = 0 } = {}) {
  const total = lineas.reduce((s, [, q, p]) => s + q * p, 0) - descuento;
  return {
    p_client_uuid: crypto.randomUUID(),
    p_items: lineas.map(([id, q, p]) => ({ product_id: id, quantity: q, unit_price: p, discount_amount: 0 })),
    p_payments: [{ method: metodo, amount: total }],
    p_discount_total: descuento,
    ...(documento ? { p_document: documento } : {}),
  };
}

const docs = async (saleId) =>
  (await banco.su.query(`select * from dte_documentos where sale_id = $1 order by emitido_en, tipo`, [saleId])).rows;
const sala = async (L, p) => Number((await banco.su.query(
  `select quantity from stock_ubicaciones where product_id = $1 and ubicacion = 'sala'`, [p])).rows[0]?.quantity ?? 0);

// ---------------------------------------------------------------------------
// Emisión con la venta
// ---------------------------------------------------------------------------
test('efectivo → boleta 39 con folio correlativo; tarjeta → sin documento (lo emite la máquina)', async () => {
  const { jugo, caj } = await mostrador();
  const v1 = await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1400]]));
  const v2 = await rpc(caj, 'fn_register_sale', venta([[jugo, 2, 1400]]));
  const v3 = await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1400]], { metodo: 'debito' }));
  assert.equal(v1.dte.tipo, 39);
  assert.equal(Number(v1.dte.folio), 1);
  assert.equal(Number(v2.dte.folio), 2);
  assert.equal(v3.dte, null);
  assert.equal((await docs(v3.sale_id)).length, 0);
  assert.equal(v1.dte.ambiente, 'simulacion');
});

test('factura → 33 con el receptor validado y su propio correlativo', async () => {
  const { jugo, caj } = await mostrador();
  await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1400]]));
  const f = await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1400]], {
    documento: { tipo: 'factura', rut: '760864285', razon_social: 'Cliente Ltda', giro: 'Comercio' } }));
  assert.equal(f.dte.tipo, 33);
  assert.equal(Number(f.dte.folio), 1, 'la factura tiene su propio correlativo');
  assert.equal(f.dte.receptor.rut, RUT_OK);
  assert.equal(f.dte.receptor.razon_social, 'Cliente Ltda');
});

test('el documento guarda los mismos montos que la venta y el detalle suma el total (con descuento e IABA)', async () => {
  const { L, jugo, bebida, adm } = await mostrador();
  const iaba = await rpc(adm, 'fn_guardar_impuesto', { p_id: null, p_nombre: 'IABA', p_codigo_sii: 271, p_tasa: 18, p_activo: true });
  await rpc(adm, 'fn_asignar_impuesto', { p_productos: `{${bebida}}`, p_impuesto: iaba });
  const r = await rpc(adm, 'fn_register_sale', venta([[jugo, 3, 1400], [bebida, 1, 1990]], { descuento: 190 }));
  const [d] = await docs(r.sale_id);
  const { rows: [s] } = await banco.su.query(`select * from sales where id = $1`, [r.sale_id]);
  assert.deepEqual([d.neto, d.iva, d.impuestos_adicionales, d.total], [s.neto, s.tax_amount, s.impuestos_adicionales, s.total]);
  assert.equal(d.detalle.reduce((x, l) => x + Number(l.monto), 0), d.total, 'el detalle no suma el total');
  assert.ok(d.detalle.some((l) => l.nombre === 'Descuento' && Number(l.monto) === -190));
  // Y el documento que arma core desde ese registro cuadra.
  const doc = desdeRegistro(r.dte);
  assert.deepEqual(validarDte(doc), []);
  const xml = construirXmlDte(doc);
  assert.match(xml, /<TipoDTE>39<\/TipoDTE><Folio>1<\/Folio>/);
  assert.match(xml, /<ImptoReten><TipoImp>271<\/TipoImp>/);
  void L;
});

test('reenviar la misma venta devuelve el mismo documento, sin gastar otro folio', async () => {
  const { jugo, caj } = await mostrador();
  const v = venta([[jugo, 1, 1400]]);
  const a = await rpc(caj, 'fn_register_sale', v);
  const b = await rpc(caj, 'fn_register_sale', v);
  assert.equal(b.already_existed, true);
  assert.equal(Number(b.dte.folio), Number(a.dte.folio));
  const c = await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1400]]));
  assert.equal(Number(c.dte.folio), Number(a.dte.folio) + 1);
});

test('dos cajas venden a la vez: folios distintos y seguidos, sin repetir', async () => {
  const { L, jugo, caj } = await mostrador();
  const caj2 = await banco.como(L.cajero2);
  await rpc(caj2, 'fn_open_cash_session', { p_opening_amount: 0 });
  await caj.query('begin');
  const a = await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1400]]));
  const segunda = intentar(rpc(caj2, 'fn_register_sale', venta([[jugo, 1, 1400]])));
  await esperarBloqueo(banco, caj2.pid);
  await caj.query('commit');
  const b = await segunda;
  assert.ok(b.ok, b.error);
  assert.deepEqual([Number(a.dte.folio), Number(b.valor.dte.folio)].sort(), [1, 2]);
});

test('un documento emitido no se edita ni se borra, ni siquiera como dueño de la base', async () => {
  const { jugo, caj } = await mostrador();
  const r = await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1400]]));
  const up = await intentar(banco.su.query(`update dte_documentos set total = 1 where sale_id = $1`, [r.sale_id]));
  assert.equal(up.ok, false);
  assert.match(up.error, /REGISTRO_INMUTABLE/);
  const del = await intentar(banco.su.query(`delete from dte_documentos where sale_id = $1`, [r.sale_id]));
  assert.equal(del.ok, false);
  // Lo que sí cambia: el estado del envío (lo llenará el emisor real).
  const ok = await intentar(banco.su.query(`update dte_documentos set estado = 'enviado', track_id = '123' where sale_id = $1`, [r.sale_id]));
  assert.ok(ok.ok, ok.error);
});

test('una venta con boleta no se anula: se devuelve con nota de crédito', async () => {
  const { jugo, adm } = await mostrador();
  const r = await rpc(adm, 'fn_register_sale', venta([[jugo, 1, 1400]]));
  const x = await intentar(rpc(adm, 'fn_void_sale', { p_sale_id: r.sale_id, p_reason: 'error' }));
  assert.equal(x.ok, false);
  assert.match(x.error, /VENTA_CON_DOCUMENTO_USAR_DEVOLUCION/);
  // La de tarjeta (sin documento nuestro) sí se sigue anulando.
  const t = await rpc(adm, 'fn_register_sale', venta([[jugo, 1, 1400]], { metodo: 'debito' }));
  assert.ok((await intentar(rpc(adm, 'fn_void_sale', { p_sale_id: t.sale_id, p_reason: 'error' }))).ok);
});

// ---------------------------------------------------------------------------
// Devoluciones y notas de crédito
// ---------------------------------------------------------------------------
test('devolución parcial en efectivo: stock a la sala, plata de la caja y nota de crédito que corrige montos', async () => {
  const { L, jugo, bebida, sup, caj } = await mostrador();
  const r = await rpc(caj, 'fn_register_sale', venta([[jugo, 3, 1400], [bebida, 1, 1990]]));
  const antesSala = await sala(L, jugo);
  const items = (await banco.su.query(`select id, product_id from sale_items where sale_id = $1`, [r.sale_id])).rows;
  const itJugo = items.find((i) => i.product_id === jugo).id;

  const d = await rpc(sup, 'fn_devolver_venta', {
    p_sale_id: r.sale_id, p_items: [{ sale_item_id: itJugo, cantidad: 1 }], p_motivo: 'Vencido', p_reembolso: 'efectivo' });
  assert.equal(d.monto, 1400);
  assert.equal(d.es_total, false);
  assert.equal(await sala(L, jugo), antesSala + 1, 'el stock no volvió a la sala');
  assert.equal(d.nota_credito.tipo, 61);
  assert.equal(Number(d.nota_credito.folio), 1);
  assert.deepEqual([d.nota_credito.referencia.tipo, Number(d.nota_credito.referencia.folio), d.nota_credito.referencia.codigo],
                   [39, Number(r.dte.folio), 3]);
  assert.deepEqual(validarDte(desdeRegistro(d.nota_credito)), []);

  // La plata salió de la caja del supervisor, no de la del cajero.
  const { rows: mov } = await banco.su.query(
    `select cm.amount, cs.user_id from cash_movements cm join cash_sessions cs on cs.id = cm.cash_session_id
      where cm.reason like 'Devolución N° ' || $1 || ' %'`, [d.numero]);
  assert.deepEqual(mov.map((m) => [m.amount, m.user_id]), [[1400, L.supervisor.id]]);
});

test('devolver el resto completa exactamente el total cobrado, y después no queda nada que devolver', async () => {
  const { jugo, bebida, adm } = await mostrador();
  const r = await rpc(adm, 'fn_register_sale', venta([[jugo, 3, 1400], [bebida, 1, 1990]], { descuento: 619 }));
  const items = (await banco.su.query(`select id, product_id from sale_items where sale_id = $1 order by id`, [r.sale_id])).rows;
  const itJugo = items.find((i) => i.product_id === jugo).id;
  const d1 = await rpc(adm, 'fn_devolver_venta', {
    p_sale_id: r.sale_id, p_items: [{ sale_item_id: itJugo, cantidad: 1 }], p_motivo: 'Cambio', p_reembolso: 'transferencia' });
  const d2 = await rpc(adm, 'fn_devolver_venta', { p_sale_id: r.sale_id, p_items: null, p_motivo: 'No lo quiso', p_reembolso: 'transferencia' });
  assert.equal(d2.es_total, true);
  assert.equal(d1.monto + d2.monto, r.total, 'las devoluciones no suman lo cobrado');
  assert.equal(d2.nota_credito.referencia.codigo, 3, 'la segunda NC corrige, no anula: ya había una');
  const x = await intentar(rpc(adm, 'fn_devolver_venta', { p_sale_id: r.sale_id, p_items: null, p_motivo: 'otra', p_reembolso: 'transferencia' }));
  assert.equal(x.ok, false);
  assert.match(x.error, /NADA_QUE_DEVOLVER/);
});

test('devolver todo de una vez emite una NC que anula (código 1)', async () => {
  const { jugo, adm } = await mostrador();
  const r = await rpc(adm, 'fn_register_sale', venta([[jugo, 2, 1400]]));
  const d = await rpc(adm, 'fn_devolver_venta', { p_sale_id: r.sale_id, p_items: null, p_motivo: 'Error de cobro', p_reembolso: 'efectivo' });
  assert.equal(d.nota_credito.referencia.codigo, 1);
  assert.equal(d.monto, 2800);
});

test('los montos de la base y los de core coinciden en 100 devoluciones al azar', async () => {
  const { jugo, bebida, adm } = await mostrador();
  let s = 5;
  const azar = (n) => { s = (s * 48271) % 2147483647; return s % n; };
  for (let k = 0; k < 100; k++) {
    const qj = 1 + azar(5), qb = 1 + azar(3);
    const bruto = qj * 1400 + qb * 1990;
    const desc = azar(2) ? azar(Math.floor(bruto / 3)) : 0;
    const r = await rpc(adm, 'fn_register_sale', venta([[jugo, qj, 1400], [bebida, qb, 1990]], { descuento: desc }));
    const its = (await banco.su.query(`select id, quantity, subtotal from sale_items where sale_id = $1 order by id`, [r.sale_id])).rows;
    const pide = [{ id: its[0].id, cantidad: 1 + azar(Number(its[0].quantity)) }];
    const esperado = montosDevolucion(its.map((i) => ({ id: i.id, cantidad: Number(i.quantity), subtotal: i.subtotal, devuelto: 0 })),
      r.total, 0, pide);
    const d = await rpc(adm, 'fn_devolver_venta', {
      p_sale_id: r.sale_id, p_items: pide.map((p) => ({ sale_item_id: p.id, cantidad: p.cantidad })),
      p_motivo: 'azar', p_reembolso: 'transferencia' });
    assert.equal(d.monto, esperado[0].monto, `venta ${k}`);
  }
});

test('un perecible devuelto vuelve al lote del que salió', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_open_cash_session', { p_opening_amount: 0 });
  const yog = await L.producto({ nombre: 'Yogur', precio: 800, perecible: true, stock: 5 });
  await banco.su.query(`update stock_ubicaciones set quantity = 5 where product_id = $1 and ubicacion = 'sala'`, [yog]);
  const lote = await L.lote(yog, 5, '2030-01-01');
  const r = await rpc(adm, 'fn_register_sale', venta([[yog, 3, 800]]));
  const lot = async () => Number((await banco.su.query(`select quantity from product_lots where id = $1`, [lote])).rows[0].quantity);
  assert.equal(await lot(), 2);
  await rpc(adm, 'fn_devolver_venta', { p_sale_id: r.sale_id, p_items: null, p_motivo: 'x', p_reembolso: 'transferencia' });
  assert.equal(await lot(), 5);
});

test('los reportes restan la devolución el día que se hace', async () => {
  const { L, jugo, adm } = await mostrador();
  const r = await rpc(adm, 'fn_register_sale', venta([[jugo, 5, 1400]]));
  await rpc(adm, 'fn_devolver_venta', {
    p_sale_id: r.sale_id, p_items: null, p_motivo: 'x', p_reembolso: 'transferencia' });
  const { rows: [dia] } = await banco.su.query(`select sales_count, total_amount from v_sales_daily where tenant_id = $1`, [L.tenant]);
  assert.equal(Number(dia.total_amount), 0);
  assert.equal(Number(dia.sales_count), 1);
  const { rows: prod } = await banco.su.query(`select units_sold, revenue from v_sales_by_product where tenant_id = $1`, [L.tenant]);
  assert.deepEqual(prod.map((p) => [Number(p.units_sold), Number(p.revenue)]), [[0, 0]]);
});

test('una devolución en efectivo sin caja abierta no se hace', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 10 });
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  const r = await rpc(caj, 'fn_register_sale', venta([[p, 1, 1000]]));
  const adm = await banco.como(L.admin);   // sin caja abierta
  const x = await intentar(rpc(adm, 'fn_devolver_venta', { p_sale_id: r.sale_id, p_items: null, p_motivo: 'x', p_reembolso: 'efectivo' }));
  assert.equal(x.ok, false);
  assert.match(x.error, /CAJA_NO_ABIERTA/);
  assert.equal(await L.stock(p), 9, 'una devolución rechazada movió el stock');
});

// ---------------------------------------------------------------------------
// Seguridad y emisor
// ---------------------------------------------------------------------------
test('un vendedor no devuelve; ve el documento de sus ventas y no el de otros', async () => {
  const { L, jugo, caj } = await mostrador();
  const r = await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1400]]));
  const x = await intentar(rpc(caj, 'fn_devolver_venta', { p_sale_id: r.sale_id, p_items: null, p_motivo: 'x', p_reembolso: 'transferencia' }));
  assert.equal(x.ok, false);
  assert.match(x.error, /SIN_PERMISO_DEVOLVER/);

  const caj2 = await banco.como(L.cajero2);
  assert.equal((await caj.query(`select 1 from dte_documentos where sale_id = $1`, [r.sale_id])).rows.length, 1);
  assert.equal((await caj2.query(`select 1 from dte_documentos where sale_id = $1`, [r.sale_id])).rows.length, 0);
  assert.equal((await caj.query(`select 1 from dte_folios`)).rows.length, 0, 'un vendedor ve los folios');
});

test('nadie inserta documentos, folios ni devoluciones a mano', async () => {
  const { L, jugo, adm } = await mostrador();
  const r = await rpc(adm, 'fn_register_sale', venta([[jugo, 1, 1400]]));
  const intentos = [
    [`insert into dte_documentos (tenant_id, tipo, folio, ambiente, fecha_emision, emisor, detalle, neto, iva, iva_pct, total)
      values ($1, 39, 999, 'simulacion', current_date, '{}', '[]', 0, 0, 19, 0)`, [L.tenant]],
    [`insert into dte_folios (tenant_id, tipo, desde, hasta, siguiente, simulado) values ($1, 39, 1, 10, 1, false)`, [L.tenant]],
    [`update dte_folios set siguiente = 1 where tenant_id = $1`, [L.tenant]],
    [`insert into sale_returns (tenant_id, store_id, sale_id, numero, motivo, reembolso, monto, neto, iva, es_total)
      values ($1, $2, $3, 99, 'x', 'efectivo', 1, 1, 0, false)`, [L.tenant, L.store, r.sale_id]],
    [`insert into dte_emisores (tenant_id, rut, razon_social, giro, direccion, comuna, ambiente)
      values ($1, '1-9', 'x', 'x', 'x', 'x', 'produccion')`, [L.tenant]],
  ];
  for (const [sql, args] of intentos) {
    const x = await intentar(adm.query(sql, args));
    const cambio = x.ok && (x.valor.rowCount ?? 0) > 0;
    assert.equal(cambio, false, `se pudo: ${sql.slice(0, 50)}`);
  }
});

test('el emisor: solo el administrador, RUT válido, y producción bloqueada hasta tener CAF', async () => {
  const { L, jugo, adm, sup } = await mostrador();
  const datos = { rut: '76086428-5', razon_social: 'Comercial RutaAhorro SpA', giro: 'Almacén', direccion: 'Calle 1', comuna: 'Santiago' };
  assert.equal((await intentar(rpc(sup, 'fn_guardar_emisor', { p_datos: datos }))).ok, false);
  const malo = await intentar(rpc(adm, 'fn_guardar_emisor', { p_datos: { ...datos, rut: '76086428-4' } }));
  assert.match(malo.error, /RUT_EMISOR_INVALIDO/);
  const prod = await intentar(rpc(adm, 'fn_guardar_emisor', { p_datos: { ...datos, ambiente: 'produccion' } }));
  assert.match(prod.error, /AMBIENTE_NO_DISPONIBLE/);
  const ok = await rpc(adm, 'fn_guardar_emisor', { p_datos: datos });
  assert.equal(ok.rut, '76.086.428-5');
  // Las boletas siguientes llevan al emisor configurado.
  const r = await rpc(adm, 'fn_register_sale', venta([[jugo, 1, 1400]]));
  assert.equal(r.dte.emisor.razon_social, 'Comercial RutaAhorro SpA');
  assert.equal(r.dte.emisor.configurado, true);
  void L;
});
