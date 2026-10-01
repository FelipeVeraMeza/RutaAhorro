/**
 * 0029 · Redondeo del efectivo (RF-M5-28), venta fiada (RF-M5-30) y pie del
 * comprobante (RF-M9-13).
 *
 * Lo que tiene que quedar demostrado contra un PostgreSQL de verdad:
 *  · Pagado todo en efectivo, la base acepta el total redondeado, guarda el
 *    ajuste y deja el total (y el IVA) exactos. La caja espera lo que entró.
 *  · Con tarjeta, o mezclado, no se redondea.
 *  · Lo fiado no entra al efectivo esperado; un abono en efectivo sí.
 *  · No se fía sin cliente, ni por sobre el tope, ni dos cajas a la vez.
 *  · Anular o devolver una venta fiada rebaja la deuda.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';
import { redondeoEfectivo } from '../../packages/core/dist/index.js';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function mostrador() {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1234, stock: 500 });
  const adm = await banco.como(L.admin);
  const caj = await banco.como(L.cajero1);
  const caj2 = await banco.como(L.cajero2);
  for (const c of [adm, caj, caj2]) await rpc(c, 'fn_open_cash_session', { p_opening_amount: 10000 });
  const cliente = await rpc(adm, 'fn_guardar_cliente', { p_id: null, p_datos: { nombre: 'Doña Rosa' } });
  return { L, pan, adm, caj, caj2, cliente };
}

function venta(pan, cantidad, pagos, documento) {
  return {
    p_client_uuid: crypto.randomUUID(),
    p_items: [{ product_id: pan, quantity: cantidad, unit_price: 1234, discount_amount: 0 }],
    p_payments: pagos,
    ...(documento ? { p_document: documento } : {}),
  };
}

async function resumenCaja(c) {
  const { rows: [s] } = await c.query(`select id from cash_sessions where user_id = auth.uid() and status = 'abierta'`);
  return rpc(c, 'fn_cash_session_summary', { p_session_id: s.id });
}

test('RF-M5-28 · la regla de la base es la misma de core', async () => {
  for (let n = 0; n <= 120; n++) {
    const { rows: [r] } = await banco.su.query('select fn_redondeo_efectivo($1) as v', [n]);
    assert.equal(r.v, redondeoEfectivo(n), `total ${n}`);
  }
});

test('RF-M5-28 · todo en efectivo: se cobra redondeado, el total queda exacto y la caja cuadra', async () => {
  const { pan, caj } = await mostrador();
  // 1.234 termina en 4: baja a 1.230.
  const r = await rpc(caj, 'fn_register_sale', venta(pan, 1, [{ method: 'efectivo', amount: 1230, received_amount: 2000 }]));
  assert.equal(r.total, 1234, 'el total de la venta (y de la boleta) no cambia');
  assert.equal(r.ajuste_redondeo, -4);
  assert.equal(r.cobrado, 1230);
  assert.equal(r.change_amount, 770, 'el vuelto es sobre lo cobrado');
  const { rows: [s] } = await banco.su.query('select total, ajuste_redondeo, tax_amount, neto from sales where id = $1', [r.sale_id]);
  assert.equal(s.ajuste_redondeo, -4);
  assert.equal(s.neto + s.tax_amount, 1234, 'el IVA se calcula sobre el total exacto');

  // 3 × 1.234 = 3.702 → 3.700; 6 × 1.234 = 7.404 → 7.400; 7 × 1.234 = 8.638 → 8.640
  await rpc(caj, 'fn_register_sale', venta(pan, 7, [{ method: 'efectivo', amount: 8640 }]));
  const res = await resumenCaja(caj);
  assert.equal(res.ajuste_redondeo, -4 + 2);
  assert.equal(res.cash_sales, 1230 + 8640, 'el efectivo de la caja es lo que entró al cajón');
  assert.equal(res.expected_amount, 10000 + 1230 + 8640);
  assert.equal(res.sales_total, 1234 + 8638, 'las ventas suman los totales exactos');
});

test('RF-M5-28 · el monto exacto se sigue aceptando (cola sin conexión de antes)', async () => {
  const { pan, caj } = await mostrador();
  const r = await rpc(caj, 'fn_register_sale', venta(pan, 1, [{ method: 'efectivo', amount: 1234 }]));
  assert.equal(r.ajuste_redondeo, 0);
});

test('RF-M5-28 · con tarjeta o con pago mezclado no se redondea', async () => {
  const { pan, caj } = await mostrador();
  const tarjeta = await intentar(rpc(caj, 'fn_register_sale', venta(pan, 1, [{ method: 'debito', amount: 1230 }])));
  assert.equal(tarjeta.ok, false);
  assert.match(tarjeta.error, /PAGO_NO_CUADRA/);
  const mezcla = await intentar(rpc(caj, 'fn_register_sale',
    venta(pan, 1, [{ method: 'efectivo', amount: 230 }, { method: 'debito', amount: 1000 }])));
  assert.equal(mezcla.ok, false);
  assert.match(mezcla.error, /PAGO_NO_CUADRA/);
  // Redondear "para el otro lado" tampoco: 1.234 nunca se cobra 1.240.
  const mal = await intentar(rpc(caj, 'fn_register_sale', venta(pan, 1, [{ method: 'efectivo', amount: 1240 }])));
  assert.equal(mal.ok, false);
});

test('RF-M5-30 · sin tope no se fía, y sin cliente tampoco', async () => {
  const { pan, caj, cliente } = await mostrador();
  const sinCliente = await intentar(rpc(caj, 'fn_register_sale', venta(pan, 1, [{ method: 'fiado', amount: 1234 }])));
  assert.match(sinCliente.error, /FIADO_SIN_CLIENTE/);
  const sinTope = await intentar(rpc(caj, 'fn_register_sale',
    venta(pan, 1, [{ method: 'fiado', amount: 1234 }], { cliente_id: cliente })));
  assert.match(sinTope.error, /FIADO_EXCEDE_TOPE/);
});

test('RF-M5-30 · el vendedor no pone el tope; el admin sí', async () => {
  const { adm, caj, cliente } = await mostrador();
  const vendedor = await intentar(rpc(caj, 'fn_tope_credito', { p_cliente: cliente, p_tope: 50000 }));
  assert.equal(vendedor.ok, false);
  assert.equal(await rpc(adm, 'fn_tope_credito', { p_cliente: cliente, p_tope: 50000 }), 50000);
  const negativo = await intentar(rpc(adm, 'fn_tope_credito', { p_cliente: cliente, p_tope: -1 }));
  assert.match(negativo.error, /TOPE_CREDITO_INVALIDO/);
});

test('RF-M5-30 · fiado hasta el tope, no entra a la caja; el abono en efectivo sí', async () => {
  const { pan, adm, caj, cliente } = await mostrador();
  await rpc(adm, 'fn_tope_credito', { p_cliente: cliente, p_tope: 5000 });

  await rpc(caj, 'fn_register_sale', venta(pan, 3, [{ method: 'fiado', amount: 3702 }], { cliente_id: cliente }));
  const pasa = await intentar(rpc(caj, 'fn_register_sale',
    venta(pan, 2, [{ method: 'fiado', amount: 2468 }], { cliente_id: cliente })));
  assert.match(pasa.error, /FIADO_EXCEDE_TOPE/, '3.702 + 2.468 pasa los 5.000');

  let res = await resumenCaja(caj);
  assert.equal(res.fiado, 3702);
  assert.equal(res.cash_sales, 0);
  assert.equal(res.expected_amount, 10000, 'lo fiado no está en el cajón');

  const { rows: [c1] } = await banco.su.query('select saldo from v_cuenta_clientes where cliente_id = $1', [cliente]);
  assert.equal(c1.saldo, 3702);

  const demas = await intentar(rpc(caj, 'fn_abonar_cuenta', { p_cliente: cliente, p_monto: 4000, p_metodo: 'efectivo' }));
  assert.match(demas.error, /ABONO_EXCEDE_SALDO/);
  const ab = await rpc(caj, 'fn_abonar_cuenta', { p_cliente: cliente, p_monto: 2000, p_metodo: 'efectivo', p_nota: 'Paga el sábado' });
  assert.equal(ab.saldo, 1702);
  await rpc(caj, 'fn_abonar_cuenta', { p_cliente: cliente, p_monto: 500, p_metodo: 'transferencia' });

  res = await resumenCaja(caj);
  assert.equal(res.abonos_efectivo, 2000);
  assert.equal(res.expected_amount, 12000, 'el abono en efectivo entró al cajón; la transferencia no');

  // Inmutable: nada se edita ni se borra, ni siquiera el dueño de la base.
  const borrar = await intentar(banco.su.query('delete from cuenta_cliente_movimientos where cliente_id = $1', [cliente]));
  assert.match(borrar.error, /MOVIMIENTO_INMUTABLE/);
  // Y el vendedor no escribe la tabla directo (regla 14).
  const directo = await intentar(caj.query(
    `insert into cuenta_cliente_movimientos (tenant_id, cliente_id, tipo, monto) select tenant_id, id, 'abono', 1 from clientes where id = $1`, [cliente]));
  assert.equal(directo.ok, false);
});

test('RF-M5-30 · dos cajas fiándole a la vez no pasan juntas el tope', async () => {
  const { pan, adm, caj, caj2, cliente } = await mostrador();
  await rpc(adm, 'fn_tope_credito', { p_cliente: cliente, p_tope: 4000 });
  const [a, b] = await Promise.all([
    intentar(rpc(caj, 'fn_register_sale', venta(pan, 3, [{ method: 'fiado', amount: 3702 }], { cliente_id: cliente }))),
    intentar(rpc(caj2, 'fn_register_sale', venta(pan, 3, [{ method: 'fiado', amount: 3702 }], { cliente_id: cliente }))),
  ]);
  assert.equal([a, b].filter((x) => x.ok).length, 1, 'una pasa, la otra choca con el tope');
});

test('RF-M5-30 · anular una venta fiada rebaja la deuda; devolverla también', async () => {
  const { pan, adm, cliente } = await mostrador();
  await rpc(adm, 'fn_tope_credito', { p_cliente: cliente, p_tope: 20000 });
  const v1 = await rpc(adm, 'fn_register_sale', venta(pan, 2, [{ method: 'fiado', amount: 2468 }], { cliente_id: cliente }));
  const v2 = await rpc(adm, 'fn_register_sale', venta(pan, 3, [{ method: 'fiado', amount: 3702 }], { cliente_id: cliente }));
  const saldo = async () => (await banco.su.query('select saldo from v_cuenta_clientes where cliente_id = $1', [cliente])).rows[0].saldo;
  assert.equal(await saldo(), 2468 + 3702);

  // Una venta con boleta no se anula (0019): se devuelve. Lo que se prueba
  // acá es el disparador, que actúa con cualquier camino que anule (en una
  // base sin boleta electrónica, fn_void_sale).
  await banco.su.query(`update sales set status = 'anulada' where id = $1`, [v1.sale_id]);
  assert.equal(await saldo(), 3702);

  const enPlata = await intentar(rpc(adm, 'fn_devolver_venta', {
    p_sale_id: v2.sale_id, p_items: null, p_motivo: 'Pan duro', p_reembolso: 'efectivo' }));
  assert.match(enPlata.error, /VENTA_FIADA_REEMBOLSO_A_CUENTA/, 'lo fiado no se devuelve en plata');
  await rpc(adm, 'fn_devolver_venta', { p_sale_id: v2.sale_id, p_items: null, p_motivo: 'Pan duro', p_reembolso: 'fiado' });
  assert.equal(await saldo(), 0);
});

test('RF-M9-13 · el pie del comprobante se guarda con límite', async () => {
  const { adm, caj } = await mostrador();
  const s = await rpc(adm, 'fn_guardar_configuracion', { p_cambios: { comprobante_pie: '  Cambios dentro de 7 días con boleta  ' } });
  assert.equal(s.comprobante_pie, 'Cambios dentro de 7 días con boleta');
  const largo = await intentar(rpc(adm, 'fn_guardar_configuracion', { p_cambios: { comprobante_pie: 'x'.repeat(161) } }));
  assert.match(largo.error, /CONFIGURACION_INVALIDA/);
  const vendedor = await intentar(rpc(caj, 'fn_guardar_configuracion', { p_cambios: { comprobante_pie: 'hola' } }));
  assert.equal(vendedor.ok, false);
});

test('RF-M5-28 · un local nuevo nace con el redondeo encendido (la pantalla lo lee para redondear)', async () => {
  const L = await nuevoLocal(banco);
  const { rows: [t] } = await banco.su.query('select settings from tenants where id = $1', [L.tenant]);
  assert.equal(t.settings.redondeo_efectivo, true);
  // No se apaga desde Configuración: es ley.
  const adm = await banco.como(L.admin);
  const r = await intentar(rpc(adm, 'fn_guardar_configuracion', { p_cambios: { redondeo_efectivo: false } }));
  assert.match(r.error, /CONFIGURACION_INVALIDA/);
});

test('RF-M5-28 · devolver en efectivo una venta redondeada devuelve lo que se pagó', async () => {
  const { pan, adm } = await mostrador();
  // 1.234 cobrado 1.230 (ajuste −4).
  const v = await rpc(adm, 'fn_register_sale', venta(pan, 1, [{ method: 'efectivo', amount: 1230 }]));
  const r = await rpc(adm, 'fn_devolver_venta', { p_sale_id: v.sale_id, p_items: null, p_motivo: 'No lo quiso', p_reembolso: 'efectivo' });
  assert.equal(r.monto, 1234, 'la nota de crédito va por el total exacto');
  assert.equal(r.efectivo_devuelto, 1230, 'pero en plata se devuelve lo que pagó');
  const res = await resumenCaja(adm);
  assert.equal(res.cash_out, 1230);
  assert.equal(res.expected_amount, 10000, 'la caja vuelve a lo que tenía');

  // Una devolución parcial en efectivo también va a la decena: no hay monedas de $1.
  const v2 = await rpc(adm, 'fn_register_sale', venta(pan, 3, [{ method: 'efectivo', amount: 3700 }]));
  const { rows: [linea] } = await banco.su.query('select id from sale_items where sale_id = $1', [v2.sale_id]);
  const r2 = await rpc(adm, 'fn_devolver_venta', { p_sale_id: v2.sale_id, p_items: [{ sale_item_id: linea.id, cantidad: 1 }], p_motivo: 'Una mala', p_reembolso: 'efectivo' });
  assert.equal(r2.efectivo_devuelto % 10, 0);
  assert.equal(r2.efectivo_devuelto, redondeoEfectivo(r2.monto));
});
