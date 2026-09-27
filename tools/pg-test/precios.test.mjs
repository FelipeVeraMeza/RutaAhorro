/**
 * 0018 · Ofertas por cantidad, precio validado en la base (T-14) e impuestos
 * adicionales editables.
 *
 * El caso del cliente, textual: «1 por $2.000 y si llevas 3 te llevas los 3 a
 * $1.400 cada uno». Y T-14: hasta 0018 un vendedor con tope de descuento 0 %
 * podía cobrar $1 por cualquier cosa, porque la base aceptaba el precio que
 * mandaba el POS sin compararlo con nada.
 *
 * Al final, la base y el POS (`packages/core`) calculan el desglose de
 * impuestos de las mismas ventas al azar y tienen que dar lo mismo al peso:
 * el papel que ve el cliente lo arma el POS, el documento lo arma la base.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';
import { desglosarImpuestos, precioPorCantidad } from '../../packages/core/dist/index.js';

/** Un uuid[] como lo espera PostgreSQL. PostgREST lo convierte solo; `rpc` no. */
const uuids = (...ids) => `{${ids.join(',')}}`;

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

/** Un local con un producto de $2.000 con stock y las cajas abiertas. */
async function mostrador({ precio = 2000 } = {}) {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ nombre: 'Jugo', precio, stock: 500 });
  const adm = await banco.como(L.admin);
  const sup = await banco.como(L.supervisor);
  const caj = await banco.como(L.cajero1);
  for (const c of [adm, sup, caj]) await rpc(c, 'fn_open_cash_session', { p_opening_amount: 0 });
  return { L, p, adm, sup, caj };
}

/** Venta de una línea. `precio` undefined = que la base ponga el que corresponde. */
function linea(producto, cantidad, precio, extra = {}) {
  const item = { product_id: producto, quantity: cantidad, discount_amount: 0 };
  if (precio !== undefined) item.unit_price = precio;
  const total = extra.total ?? Math.round(cantidad * (precio ?? 0));
  return {
    p_client_uuid: crypto.randomUUID(),
    p_items: [item],
    p_payments: [{ method: 'efectivo', amount: total }],
    ...(extra.soldAt ? { p_sold_at: extra.soldAt } : {}),
  };
}

const item = async (saleId) =>
  (await banco.su.query(`select * from sale_items where sale_id = $1`, [saleId])).rows[0];
const venta = async (saleId) =>
  (await banco.su.query(`select * from sales where id = $1`, [saleId])).rows[0];

// ---------------------------------------------------------------------------
// Ofertas por cantidad
// ---------------------------------------------------------------------------
test('el ejemplo del cliente: 1 a $2.000, y desde 3 los 3 a $1.400 cada uno', async () => {
  const { p, adm, caj } = await mostrador();
  await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: p, p_tramos: [{ desde: 3, precio: 1400 }] });

  const una = await rpc(caj, 'fn_register_sale', linea(p, 1, 2000));
  assert.equal(una.total, 2000);
  const tres = await rpc(caj, 'fn_register_sale', linea(p, 3, 1400));
  assert.equal(tres.total, 4200);
  assert.equal((await item(tres.sale_id)).precio_lista, 1400);
});

test('sin unit_price, la base pone el precio del tramo (no el de lista)', async () => {
  const { p, adm, caj } = await mostrador();
  await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: p, p_tramos: [{ desde: 3, precio: 1400 }] });
  const r = await rpc(caj, 'fn_register_sale', linea(p, 4, undefined, { total: 5600 }));
  assert.equal(r.total, 5600);
  assert.equal(Number((await item(r.sale_id)).unit_price), 1400);
});

test('una promoción con fechas rige solo esos días del local', async () => {
  const { L, p, adm, caj } = await mostrador();
  const { rows: [{ hoy }] } = await banco.su.query(
    `select (now() at time zone fn_tenant_timezone($1))::date::text as hoy`, [L.tenant]);
  await rpc(adm, 'fn_guardar_precios_producto', {
    p_product_id: p, p_tramos: [{ desde: 1, precio: 1800, vigente_desde: hoy, vigente_hasta: hoy }],
  });
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', linea(p, 1, 1800)))).ok, 'hoy rige la promoción');

  await rpc(adm, 'fn_guardar_precios_producto', {
    p_product_id: p, p_tramos: [{ desde: 1, precio: 1800, vigente_desde: '2020-01-01', vigente_hasta: '2020-01-31' }],
  });
  const vencida = await intentar(rpc(caj, 'fn_register_sale', linea(p, 1, 1800)));
  assert.equal(vencida.ok, false, 'una promoción vencida no puede seguir cobrándose');
  assert.match(vencida.error, /DESCUENTO_EXCEDE_LIMITE/);
});

test('fn_guardar_precios_producto rechaza ofertas que no son ofertas', async () => {
  const { p, adm } = await mostrador();
  const casos = [
    [[{ desde: 3, precio: 2000 }], /OFERTA_NO_ES_MAS_BARATA/],
    [[{ desde: 0, precio: 1000 }], /TRAMO_INVALIDO/],
    [[{ desde: 1, precio: 1500 }], /OFERTA_SIN_FECHAS_DESDE_1/],
    [[{ desde: 3, precio: 1400, vigente_desde: '2026-10-02', vigente_hasta: '2026-10-01' }], /FECHAS_INVERTIDAS/],
    [[{ desde: 3, precio: 1400 }, { desde: 3, precio: 1300 }], /TRAMO_REPETIDO/],
  ];
  for (const [tramos, error] of casos) {
    const r = await intentar(rpc(adm, 'fn_guardar_precios_producto', { p_product_id: p, p_tramos: tramos }));
    assert.equal(r.ok, false, JSON.stringify(tramos));
    assert.match(r.error, error);
  }
  // Y un arreglo vacío quita las ofertas.
  await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: p, p_tramos: [{ desde: 3, precio: 1400 }] });
  await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: p, p_tramos: [] });
  const { rows } = await banco.su.query(`select 1 from product_price_tiers where product_id = $1`, [p]);
  assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------------------
// T-14 · el precio que manda el POS
// ---------------------------------------------------------------------------
test('T-14 · un vendedor (tope 0 %) no puede cobrar menos de lo que corresponde', async () => {
  const { L, p, caj } = await mostrador();
  const a1 = await intentar(rpc(caj, 'fn_register_sale', linea(p, 1, 1)));
  assert.equal(a1.ok, false, 'vendió a $1 algo de $2.000');
  assert.match(a1.error, /DESCUENTO_EXCEDE_LIMITE/);
  // Tampoco a precio de oferta sin llegar a la cantidad de la oferta.
  const a2 = await intentar(rpc(caj, 'fn_register_sale', linea(p, 2, 1900)));
  assert.equal(a2.ok, false);
  assert.equal(await L.stock(p), 500, 'una venta rechazada movió el stock');
});

test('T-14 · el supervisor (tope 10 %) baja hasta su tope y no más; el administrador, lo que quiera', async () => {
  const { p, sup, adm } = await mostrador();
  assert.ok((await intentar(rpc(sup, 'fn_register_sale', linea(p, 1, 1800)))).ok, '10 % es su tope');
  const mas = await intentar(rpc(sup, 'fn_register_sale', linea(p, 1, 1700)));
  assert.equal(mas.ok, false);
  assert.match(mas.error, /DESCUENTO_EXCEDE_LIMITE/);
  assert.ok((await intentar(rpc(adm, 'fn_register_sale', linea(p, 1, 500)))).ok);
});

test('T-14 · cobrar de más no se bloquea', async () => {
  const { p, caj } = await mostrador();
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', linea(p, 1, 2100)))).ok);
});

test('T-14 · una venta sin conexión llega con el precio que tenía cuando se hizo', async () => {
  const { L, p, adm, caj } = await mostrador();
  // Hace 3 horas costaba $2.000. Ahora el dueño lo sube a $2.200.
  // (price_history es inmutable: el cambio queda con la hora de ahora, y la
  // venta es de antes.)
  await banco.su.query(`update products set sale_price = 2200 where id = $1`, [p]);
  const hace3h = new Date(Date.now() - 3 * 3600_000).toISOString();

  const offline = await intentar(rpc(caj, 'fn_register_sale', linea(p, 1, 2000, { soldAt: hace3h })));
  assert.ok(offline.ok, 'la venta sin conexión con el precio de ese momento se rechazó: ' + offline.error);

  const ahora = await intentar(rpc(caj, 'fn_register_sale', linea(p, 1, 2000)));
  assert.equal(ahora.ok, false, 'una venta de ahora no puede usar el precio viejo');

  // Y fecharla el año pasado no sirve para usar un precio de entonces.
  await banco.su.query(`update products set sale_price = 2500 where id = $1`, [p]);
  const vieja = await intentar(rpc(caj, 'fn_register_sale', linea(p, 1, 2000, { soldAt: '2025-01-01T12:00:00Z' })));
  assert.equal(vieja.ok, false);
  void L; void adm;
});

// ---------------------------------------------------------------------------
// Impuestos adicionales
// ---------------------------------------------------------------------------
test('una bebida con IABA 18 %: neto, IVA y adicional se guardan y cuadran', async () => {
  const { p, adm, caj } = await mostrador({ precio: 1990 });
  const iaba = await rpc(adm, 'fn_guardar_impuesto', {
    p_id: null, p_nombre: 'IABA alto azúcar', p_codigo_sii: 271, p_tasa: 18, p_activo: true });
  assert.equal(await rpc(adm, 'fn_asignar_impuesto', { p_productos: uuids(p), p_impuesto: iaba }), 1);

  const r = await rpc(caj, 'fn_register_sale', linea(p, 1, 1990));
  const v = await venta(r.sale_id);
  assert.equal(v.neto, 1453);
  assert.equal(v.impuestos_adicionales, 262);
  assert.equal(v.tax_amount, 1990 - 1453 - 262);
  assert.equal(v.neto + v.tax_amount + v.impuestos_adicionales, v.total);
  assert.deepEqual(v.impuestos_detalle.map((d) => [Number(d.tasa), d.codigo_sii, d.monto]), [[18, 271, 262]]);
  const it = await item(r.sale_id);
  assert.equal(Number(it.impuesto_adicional_tasa), 18);
  assert.equal(it.impuesto_adicional_codigo, 271);
});

test('cambiar la tasa no cambia las ventas ya hechas; las nuevas usan la nueva', async () => {
  const { p, adm, caj } = await mostrador({ precio: 1990 });
  const iaba = await rpc(adm, 'fn_guardar_impuesto', {
    p_id: null, p_nombre: 'IABA', p_codigo_sii: 27, p_tasa: 18, p_activo: true });
  await rpc(adm, 'fn_asignar_impuesto', { p_productos: uuids(p), p_impuesto: iaba });
  const antes = await rpc(caj, 'fn_register_sale', linea(p, 1, 1990));

  await rpc(adm, 'fn_guardar_impuesto', {
    p_id: iaba, p_nombre: 'IABA', p_codigo_sii: 27, p_tasa: 10, p_activo: true });
  const despues = await rpc(caj, 'fn_register_sale', linea(p, 1, 1990));

  assert.equal((await venta(antes.sale_id)).impuestos_adicionales, 262, 'cambió una venta ya hecha');
  const d = await venta(despues.sale_id);
  assert.equal(d.neto, Math.round(1990 / 1.29));
  assert.equal(d.neto + d.tax_amount + d.impuestos_adicionales, 1990);

  // Y queda en la bitácora quién la cambió.
  const { rows } = await banco.su.query(
    `select old_values->>'tasa' as antes, new_values->>'tasa' as despues
       from audit_log where entity_type = 'impuesto_adicional' and entity_id = $1 and action = 'editar'`, [iaba]);
  assert.deepEqual(rows.map((x) => [Number(x.antes), Number(x.despues)]), [[18, 10]]);
});

test('desactivar un impuesto deja de cobrarlo; asignar null lo quita de los productos', async () => {
  const { p, adm, caj } = await mostrador({ precio: 1990 });
  const imp = await rpc(adm, 'fn_guardar_impuesto', {
    p_id: null, p_nombre: 'ILA vinos', p_codigo_sii: 25, p_tasa: 20.5, p_activo: true });
  await rpc(adm, 'fn_asignar_impuesto', { p_productos: uuids(p), p_impuesto: imp });
  await rpc(adm, 'fn_guardar_impuesto', {
    p_id: imp, p_nombre: 'ILA vinos', p_codigo_sii: 25, p_tasa: 20.5, p_activo: false });
  const r = await rpc(caj, 'fn_register_sale', linea(p, 1, 1990));
  assert.equal((await venta(r.sale_id)).impuestos_adicionales, 0);

  await rpc(adm, 'fn_asignar_impuesto', { p_productos: uuids(p), p_impuesto: null });
  const { rows: [x] } = await banco.su.query(`select impuesto_adicional_id from products where id = $1`, [p]);
  assert.equal(x.impuesto_adicional_id, null);
});

// ---------------------------------------------------------------------------
// Seguridad
// ---------------------------------------------------------------------------
test('solo el administrador cambia tasas; ofertas e impuestos, admin y supervisor', async () => {
  const { L, p, adm } = await mostrador();
  const imp = await rpc(adm, 'fn_guardar_impuesto', {
    p_id: null, p_nombre: 'IABA', p_codigo_sii: 27, p_tasa: 10, p_activo: true });

  const sup = await banco.como(L.supervisor);
  const caj = await banco.como(L.cajero2);
  const bod = await banco.como(L.bodega);
  for (const c of [sup, caj, bod]) {
    const r = await intentar(rpc(c, 'fn_guardar_impuesto', {
      p_id: imp, p_nombre: 'IABA', p_codigo_sii: 27, p_tasa: 1, p_activo: true }));
    assert.equal(r.ok, false, 'cambió una tasa sin ser administrador');
  }
  for (const c of [caj, bod]) {
    assert.equal((await intentar(rpc(c, 'fn_asignar_impuesto', { p_productos: uuids(p), p_impuesto: null }))).ok, false);
    assert.equal((await intentar(rpc(c, 'fn_guardar_precios_producto', {
      p_product_id: p, p_tramos: [{ desde: 3, precio: 1 }] }))).ok, false);
  }
  assert.ok((await intentar(rpc(sup, 'fn_guardar_precios_producto', {
    p_product_id: p, p_tramos: [{ desde: 3, precio: 1400 }] }))).ok);
});

test('nadie escribe tramos ni impuestos a mano, y un local no toca los del otro', async () => {
  const { L, p, adm } = await mostrador();
  const imp = await rpc(adm, 'fn_guardar_impuesto', {
    p_id: null, p_nombre: 'IABA', p_codigo_sii: 27, p_tasa: 10, p_activo: true });

  const directo = await intentar(adm.query(
    `insert into product_price_tiers (tenant_id, product_id, desde, precio) values ($1, $2, 3, 1)`, [L.tenant, p]));
  assert.equal(directo.ok, false, 'se insertó un tramo sin pasar por la función');
  await intentar(adm.query(`update impuestos_adicionales set tasa = 1 where id = $1`, [imp]));
  const { rows: [t] } = await banco.su.query(`select tasa from impuestos_adicionales where id = $1`, [imp]);
  assert.equal(Number(t.tasa), 10, 'se cambió una tasa sin pasar por la función');

  const otro = await mostrador();
  const r1 = await intentar(rpc(otro.adm, 'fn_asignar_impuesto', { p_productos: uuids(otro.p), p_impuesto: imp }));
  assert.equal(r1.ok, false, 'asignó el impuesto de otro local');
  const r2 = await intentar(rpc(otro.adm, 'fn_guardar_precios_producto', {
    p_product_id: p, p_tramos: [{ desde: 3, precio: 1 }] }));
  assert.equal(r2.ok, false, 'puso ofertas en el producto de otro local');
  const r3 = await rpc(otro.adm, 'fn_asignar_impuesto', { p_productos: uuids(p), p_impuesto: null });
  assert.equal(r3, 0, 'le quitó el impuesto al producto de otro local');
});

// ---------------------------------------------------------------------------
// La base y el POS calculan lo mismo
// ---------------------------------------------------------------------------
test('150 ventas al azar: la base y el POS dan el mismo neto, IVA e impuestos al peso', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_open_cash_session', { p_opening_amount: 0 });
  const tasas = [null, 10, 18, 20.5, 31.5];
  const imps = {};
  for (const t of tasas.filter(Boolean)) {
    imps[t] = await rpc(adm, 'fn_guardar_impuesto', {
      p_id: null, p_nombre: `Imp ${t}`, p_codigo_sii: 27, p_tasa: t, p_activo: true });
  }
  const productos = [];
  for (let i = 0; i < 10; i++) {
    const precio = 300 + i * 777;
    const id = await L.producto({ nombre: `P${i}`, precio, stock: 100000 });
    const tasa = tasas[i % tasas.length];
    if (tasa) await rpc(adm, 'fn_asignar_impuesto', { p_productos: uuids(id), p_impuesto: imps[tasa] });
    // La mitad con oferta desde 3.
    const tramos = i % 2 ? [{ desde: 3, precio: Math.round(precio * 0.8) }] : [];
    if (tramos.length) await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: id, p_tramos: tramos });
    productos.push({ id, precio, tasa, tramos });
  }

  let semilla = 11;
  const azar = (n) => { semilla = (semilla * 48271) % 2147483647; return semilla % n; };
  for (let k = 0; k < 150; k++) {
    const lineas = Array.from({ length: 1 + azar(4) }, () => {
      const pr = productos[azar(productos.length)];
      const cantidad = 1 + azar(6);
      const precio = precioPorCantidad(pr.precio, pr.tramos, cantidad).precio;
      return { pr, cantidad, precio };
    });
    const bruto = lineas.reduce((s, l) => s + l.cantidad * l.precio, 0);
    const descuento = azar(3) === 0 ? azar(Math.floor(bruto / 2)) : 0;
    const r = await rpc(adm, 'fn_register_sale', {
      p_client_uuid: crypto.randomUUID(),
      p_items: lineas.map((l) => ({ product_id: l.pr.id, quantity: l.cantidad, unit_price: l.precio, discount_amount: 0 })),
      p_payments: [{ method: 'efectivo', amount: bruto - descuento }],
      p_discount_total: descuento,
    });
    const v = await venta(r.sale_id);
    const esperado = desglosarImpuestos(
      lineas.map((l) => ({ subtotal: l.cantidad * l.precio, tasaAdicional: l.pr.tasa ?? 0, nombreAdicional: l.pr.tasa ? `Imp ${l.pr.tasa}` : null })),
      19, descuento);
    assert.deepEqual(
      [v.total, v.neto, v.tax_amount, v.impuestos_adicionales],
      [esperado.total, esperado.neto, esperado.iva, esperado.totalAdicionales],
      `venta ${k}: ${JSON.stringify(lineas.map((l) => [l.cantidad, l.precio, l.pr.tasa]))} desc ${descuento}`);
  }
});
