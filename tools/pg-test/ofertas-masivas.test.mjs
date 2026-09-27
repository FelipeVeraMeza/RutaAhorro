/**
 * 0021 · Ofertas por porcentaje, aplicadas a muchos productos a la vez, y el
 * interruptor del local que las apaga.
 *
 * Pedido de Felipe (2026-09-27): «aplicar una oferta a varios productos de
 * una vez» y «apagar las ofertas para todo el local con un interruptor».
 *
 * Lo delicado es el interruptor: apagado, un vendedor ya no puede cobrar el
 * precio de oferta (sería un descuento sin permiso), pero una venta hecha sin
 * conexión ANTES de apagarlo tiene que poder sincronizarse con el precio que
 * tenía.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';
import { precioPorCantidad } from '../../packages/core/dist/index.js';

const uuids = (...ids) => `{${ids.join(',')}}`;

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function mostrador() {
  const L = await nuevoLocal(banco);
  const cerveza = await L.producto({ nombre: 'Cerveza lata', precio: 1990, stock: 500 });
  const pack = await L.producto({ nombre: 'Cerveza pack', precio: 6990, stock: 500 });
  const chicle = await L.producto({ nombre: 'Chicle', precio: 300, stock: 500 });
  const adm = await banco.como(L.admin);
  const sup = await banco.como(L.supervisor);
  const caj = await banco.como(L.cajero1);
  for (const c of [adm, sup, caj]) await rpc(c, 'fn_open_cash_session', { p_opening_amount: 0 });
  return { L, cerveza, pack, chicle, adm, sup, caj };
}

function linea(producto, cantidad, precio, extra = {}) {
  return {
    p_client_uuid: crypto.randomUUID(),
    p_items: [{ product_id: producto, quantity: cantidad, unit_price: precio, discount_amount: 0 }],
    p_payments: [{ method: 'efectivo', amount: Math.round(cantidad * precio) }],
    ...(extra.soldAt ? { p_sold_at: extra.soldAt } : {}),
  };
}

const tramos = async (producto) =>
  (await banco.su.query(
    `select desde::float as desde, precio, descuento_pct::float as pct from product_price_tiers
      where product_id = $1 order by desde`, [producto])).rows;

// ---------------------------------------------------------------------------
// Porcentaje
// ---------------------------------------------------------------------------
test('un tramo por porcentaje: desde 6, 10 % menos, y sigue al precio cuando sube', async () => {
  const { L, cerveza, adm, caj } = await mostrador();
  await rpc(adm, 'fn_guardar_precios_producto', {
    p_product_id: cerveza, p_tramos: [{ desde: 6, descuento_pct: 10 }],
  });
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', linea(cerveza, 6, 1791)))).ok, '6 × $1.791');
  const menos = await intentar(rpc(caj, 'fn_register_sale', linea(cerveza, 6, 1790)));
  assert.equal(menos.ok, false, 'un peso bajo la oferta es un descuento sin permiso');
  assert.match(menos.error, /DESCUENTO_EXCEDE_LIMITE/);

  await banco.su.query(`update products set sale_price = 2500 where id = $1`, [cerveza]);
  const r = await rpc(caj, 'fn_register_sale', {
    ...linea(cerveza, 6, 2250),
    p_items: [{ product_id: cerveza, quantity: 6, discount_amount: 0 }],
  });
  assert.equal(r.total, 13500, 'sin unit_price, la base pone el 10 % sobre el precio nuevo');
  void L;
});

test('el porcentaje redondea igual en la base y en core, con precios y tasas al azar', async () => {
  const { adm, L } = await mostrador();
  const p = await L.producto({ nombre: 'Azar', precio: 1000, stock: 0 });
  for (let i = 0; i < 60; i++) {
    const base = 1 + Math.floor(Math.random() * 50_000);
    const pct = (1 + Math.floor(Math.random() * 9_898)) / 100; // 0,01 a 98,99
    const qty = 3 + Math.floor(Math.random() * 5);
    const { rows: [{ precio }] } = await banco.su.query(
      `select fn_precio_tramo($1, null, $2) as precio`, [base, pct]);
    const esperado = precioPorCantidad(base, [{ desde: 3, descuentoPct: pct }], qty).precio;
    assert.equal(Math.min(precio, base), esperado, `base ${base}, ${pct} %`);
  }
  void adm; void p;
});

test('un tramo lleva monto o porcentaje, no los dos ni ninguno, y el porcentaje entre 0 y 100', async () => {
  const { cerveza, adm } = await mostrador();
  const casos = [
    [{ desde: 6, precio: 1500, descuento_pct: 10 }, /TRAMO_INVALIDO/],
    [{ desde: 6 }, /TRAMO_INVALIDO/],
    [{ desde: 6, descuento_pct: 0 }, /PORCENTAJE_INVALIDO/],
    [{ desde: 6, descuento_pct: 100 }, /PORCENTAJE_INVALIDO/],
    [{ desde: 6, descuento_pct: 10.125 }, /PORCENTAJE_INVALIDO/],
    [{ desde: 1, descuento_pct: 10 }, /OFERTA_SIN_FECHAS_DESDE_1/],
  ];
  for (const [t, error] of casos) {
    const r = await intentar(rpc(adm, 'fn_guardar_precios_producto', { p_product_id: cerveza, p_tramos: [t] }));
    assert.equal(r.ok, false, JSON.stringify(t));
    assert.match(r.error, error);
  }
  // Y la tabla no acepta el truco escrito directo, aunque alguien lo intente como dueño.
  const directo = await intentar(banco.su.query(
    `insert into product_price_tiers (tenant_id, product_id, desde, precio, descuento_pct)
     select tenant_id, id, 6, 1500, 10 from products where id = $1`, [cerveza]));
  assert.equal(directo.ok, false);
});

// ---------------------------------------------------------------------------
// Aplicación masiva
// ---------------------------------------------------------------------------
test('la misma oferta a varios productos; el que no le sirve se salta y se dice por qué', async () => {
  const { cerveza, pack, chicle, adm } = await mostrador();
  const r = await rpc(adm, 'fn_aplicar_oferta_masiva', {
    p_productos: uuids(cerveza, pack, chicle), p_tramo: { desde: 6, precio: 1500 },
  });
  // El chicle vale $300: "desde 6 a $1.500" no es una oferta para él.
  assert.equal(r.aplicados, 2);
  assert.equal(r.omitidos.length, 1);
  assert.equal(r.omitidos[0].nombre, 'Chicle');
  assert.equal(r.omitidos[0].motivo, 'OFERTA_NO_ES_MAS_BARATA');
  assert.deepEqual(await tramos(cerveza), [{ desde: 6, precio: 1500, pct: null }]);
  assert.deepEqual(await tramos(chicle), []);

  // Por porcentaje sirve para todos, cada uno con su precio.
  const r2 = await rpc(adm, 'fn_aplicar_oferta_masiva', {
    p_productos: uuids(cerveza, pack, chicle), p_tramo: { desde: 12, descuento_pct: 15 },
  });
  assert.equal(r2.aplicados, 3);
  assert.equal((await tramos(chicle)).length, 1);
  assert.equal((await tramos(cerveza)).length, 2, 'el tramo desde 6 sigue ahí');
});

test('aplicarla de nuevo con la misma cantidad y fechas la reemplaza, no la duplica', async () => {
  const { cerveza, adm } = await mostrador();
  const aplicar = (t) => rpc(adm, 'fn_aplicar_oferta_masiva', { p_productos: uuids(cerveza), p_tramo: t });
  await aplicar({ desde: 6, precio: 1500 });
  await aplicar({ desde: 6, descuento_pct: 20 });
  assert.deepEqual(await tramos(cerveza), [{ desde: 6, precio: null, pct: 20 }]);
  // Con fechas es otra oferta (una promoción encima del precio por mayor).
  await aplicar({ desde: 6, precio: 1400, vigente_desde: '2026-10-01', vigente_hasta: '2026-10-07' });
  assert.equal((await tramos(cerveza)).length, 2);
});

test('masiva: un vendedor no puede, y los productos de otro local ni se tocan ni se nombran', async () => {
  const { cerveza, caj, adm } = await mostrador();
  const otro = await nuevoLocal(banco, 'Otro');
  const ajeno = await otro.producto({ nombre: 'Secreto del vecino', precio: 5000 });

  const v = await intentar(rpc(caj, 'fn_aplicar_oferta_masiva', {
    p_productos: uuids(cerveza), p_tramo: { desde: 6, precio: 1500 },
  }));
  assert.equal(v.ok, false);
  assert.match(v.error, /SIN_PERMISO/);

  const r = await rpc(adm, 'fn_aplicar_oferta_masiva', {
    p_productos: uuids(cerveza, ajeno), p_tramo: { desde: 6, precio: 1500 },
  });
  assert.equal(r.aplicados, 1);
  assert.equal(JSON.stringify(r).includes('Secreto'), false, 'le contó el nombre de un producto ajeno');
  assert.deepEqual(await tramos(ajeno), []);
  const q = await intentar(rpc(caj, 'fn_quitar_ofertas', { p_productos: uuids(cerveza) }));
  assert.equal(q.ok, false, 'un vendedor tampoco quita ofertas');
});

test('quitar las ofertas de varios productos, y queda en la bitácora', async () => {
  const { L, cerveza, pack, sup } = await mostrador();
  await rpc(sup, 'fn_aplicar_oferta_masiva', {
    p_productos: uuids(cerveza, pack), p_tramo: { desde: 6, descuento_pct: 10 },
  });
  const n = await rpc(sup, 'fn_quitar_ofertas', { p_productos: uuids(cerveza, pack) });
  assert.equal(n, 2);
  assert.deepEqual(await tramos(cerveza), []);
  const { rows } = await banco.su.query(
    `select count(*)::int as n from audit_log where tenant_id = $1 and action = 'ofertas'`, [L.tenant]);
  assert.equal(rows[0].n, 4, 'dos al aplicar y dos al quitar, una por producto');
});

// ---------------------------------------------------------------------------
// Interruptor
// ---------------------------------------------------------------------------
test('apagadas: el vendedor ya no cobra la oferta; encendidas, sí de nuevo', async () => {
  const { cerveza, adm, caj } = await mostrador();
  await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: cerveza, p_tramos: [{ desde: 6, precio: 1500 }] });

  const cfg = await rpc(adm, 'fn_guardar_configuracion', { p_cambios: { ofertas_activas: false } });
  assert.equal(cfg.ofertas_activas, false);
  assert.ok(cfg.ofertas_pausadas_desde, 'al apagar se anota desde cuándo');
  // Pasados los 15 minutos de gracia para los celulares con el catálogo viejo.
  await banco.su.query(
    `update tenants set settings = settings || jsonb_build_object('ofertas_pausadas_desde', now() - interval '1 hour')
      where id = (select tenant_id from products where id = $1)`, [cerveza]);

  const conOferta = await intentar(rpc(caj, 'fn_register_sale', linea(cerveza, 6, 1500)));
  assert.equal(conOferta.ok, false, 'cobró la oferta con las ofertas apagadas');
  assert.match(conOferta.error, /DESCUENTO_EXCEDE_LIMITE/);
  const sinPrecio = await rpc(caj, 'fn_register_sale', {
    ...linea(cerveza, 6, 1990), p_items: [{ product_id: cerveza, quantity: 6, discount_amount: 0 }],
  });
  assert.equal(sinPrecio.total, 11940, 'sin unit_price, la base pone el precio normal');

  const on = await rpc(adm, 'fn_guardar_configuracion', { p_cambios: { ofertas_activas: true } });
  assert.equal(on.ofertas_pausadas_desde, undefined, 'al encender se borra la hora');
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', linea(cerveza, 6, 1500)))).ok);
});

test('apagadas: una venta sin conexión de ANTES de apagarlas se sincroniza con su precio de oferta', async () => {
  const { cerveza, adm, caj } = await mostrador();
  await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: cerveza, p_tramos: [{ desde: 6, precio: 1500 }] });
  await rpc(adm, 'fn_guardar_configuracion', { p_cambios: { ofertas_activas: false } });
  await banco.su.query(
    `update tenants set settings = settings || jsonb_build_object('ofertas_pausadas_desde', now() - interval '1 hour')
      where id = (select tenant_id from products where id = $1)`, [cerveza]);

  const antes = new Date(Date.now() - 2 * 3600_000).toISOString();
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', linea(cerveza, 6, 1500, { soldAt: antes })))).ok,
    'rechazó una venta que se hizo cuando la oferta regía');
  const despues = new Date(Date.now() - 10 * 60_000).toISOString();
  const tarde = await intentar(rpc(caj, 'fn_register_sale', linea(cerveza, 6, 1500, { soldAt: despues })));
  assert.equal(tarde.ok, false, 'una venta de después de apagarlas no lleva oferta');
});

test('apagar dos veces no mueve la hora, y la hora no se puede escribir desde la pantalla', async () => {
  const { adm } = await mostrador();
  const a = await rpc(adm, 'fn_guardar_configuracion', { p_cambios: { ofertas_activas: false } });
  const b = await rpc(adm, 'fn_guardar_configuracion', { p_cambios: { ofertas_activas: false } });
  assert.equal(b.ofertas_pausadas_desde, a.ofertas_pausadas_desde);
  const trampa = await intentar(rpc(adm, 'fn_guardar_configuracion', {
    p_cambios: { ofertas_pausadas_desde: '2099-01-01T00:00:00Z' },
  }));
  assert.equal(trampa.ok, false);
  assert.match(trampa.error, /CONFIGURACION_INVALIDA/);
});

test('recién apagadas hay 15 minutos de gracia para los celulares con el catálogo viejo', async () => {
  const { cerveza, adm, caj } = await mostrador();
  await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: cerveza, p_tramos: [{ desde: 6, precio: 1500 }] });
  await rpc(adm, 'fn_guardar_configuracion', { p_cambios: { ofertas_activas: false } });
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', linea(cerveza, 6, 1500)))).ok);
});
