/**
 * 0023 · Combos entre productos distintos: «2 bebidas + 1 pan por $3.000».
 *
 * Lo delicado: el POS reparte el ahorro del combo como descuento de las
 * líneas, y un cajero con tope 0 % tiene que poder cobrarlo. Pero solo lo
 * que el combo ahorra de verdad, calculado por la base: ni un peso más, ni
 * con el combo incompleto, ni con las ofertas apagadas, ni sumado al precio
 * de cliente.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';
import { calcularCombos } from '../../packages/core/dist/index.js';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function mostrador() {
  const L = await nuevoLocal(banco);
  const beb = await L.producto({ nombre: 'Bebida', precio: 1200, stock: 500 });
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 500 });
  const adm = await banco.como(L.admin);
  const caj = await banco.como(L.cajero1);
  for (const c of [adm, caj]) await rpc(c, 'fn_open_cash_session', { p_opening_amount: 0 });
  const combo = await rpc(adm, 'fn_guardar_combo', {
    p_id: null,
    p_datos: { nombre: 'Once', precio: 3000, items: [{ product_id: beb, cantidad: 2 }, { product_id: pan, cantidad: 1 }] },
  });
  return { L, beb, pan, adm, caj, combo };
}

/** Líneas [producto, cantidad, precio, descuento]. */
function venta(lineas, extra = {}) {
  const total = lineas.reduce((s, [, q, p, d = 0]) => s + Math.round(q * p) - d, 0);
  return {
    p_client_uuid: crypto.randomUUID(),
    p_items: lineas.map(([product_id, quantity, unit_price, discount_amount = 0]) =>
      ({ product_id, quantity, unit_price, discount_amount })),
    p_payments: [{ method: 'efectivo', amount: total }],
    ...(extra.soldAt ? { p_sold_at: extra.soldAt } : {}),
    ...(extra.document ? { p_document: extra.document } : {}),
  };
}

test('el ejemplo: el cajero cobra 2 bebidas + 1 pan a $3.000, y la venta guarda el combo', async () => {
  const { beb, pan, caj } = await mostrador();
  const r = await rpc(caj, 'fn_register_sale', venta([[beb, 2, 1200, 218], [pan, 1, 1000, 182]]));
  assert.equal(r.total, 3000);
  const { rows: [s] } = await banco.su.query(`select descuento_combos, combos_aplicados, neto, tax_amount, total from sales where id = $1`, [r.sale_id]);
  assert.equal(s.descuento_combos, 400);
  assert.equal(s.combos_aplicados[0].nombre, 'Once');
  assert.equal(s.neto + s.tax_amount, s.total, 'neto + IVA = total con el descuento del combo');
});

test('se aplica las veces que cabe: 5 bebidas y 3 panes son 2 combos', async () => {
  const { beb, pan, caj } = await mostrador();
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', venta([[beb, 5, 1200, 800], [pan, 3, 1000]])))).ok);
  const r = await intentar(rpc(caj, 'fn_register_sale', venta([[beb, 5, 1200, 1200], [pan, 3, 1000]])));
  assert.equal(r.ok, false, 'cobró 3 combos con productos para 2');
});

test('un peso más que el combo, o el combo incompleto, es un descuento sin permiso', async () => {
  const { beb, pan, caj } = await mostrador();
  const mas = await intentar(rpc(caj, 'fn_register_sale', venta([[beb, 2, 1200, 219], [pan, 1, 1000, 182]])));
  assert.equal(mas.ok, false);
  assert.match(mas.error, /DESCUENTO_EXCEDE_LIMITE/);
  const incompleto = await intentar(rpc(caj, 'fn_register_sale', venta([[beb, 2, 1200, 400]])));
  assert.equal(incompleto.ok, false, 'rebajó el combo sin el pan');
});

test('con las ofertas apagadas no hay combo; lo vendido sin conexión antes de apagarlas, sí', async () => {
  const { L, beb, pan, adm, caj } = await mostrador();
  await rpc(adm, 'fn_guardar_configuracion', { p_cambios: { ofertas_activas: false } });
  await banco.su.query(`update tenants set settings = settings || jsonb_build_object('ofertas_pausadas_desde', now() - interval '1 hour') where id = $1`, [L.tenant]);
  const hoy = await intentar(rpc(caj, 'fn_register_sale', venta([[beb, 2, 1200, 218], [pan, 1, 1000, 182]])));
  assert.equal(hoy.ok, false, 'cobró el combo con las ofertas apagadas');
  const antes = new Date(Date.now() - 2 * 3600_000).toISOString();
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', venta([[beb, 2, 1200, 218], [pan, 1, 1000, 182]], { soldAt: antes })))).ok);
});

test('no se suma al precio de cliente: con 20 % el combo ya no ahorra nada', async () => {
  const { beb, pan, adm, caj } = await mostrador();
  const cli = await rpc(adm, 'fn_guardar_cliente', { p_id: null, p_datos: { nombre: 'Mayorista', descuento_pct: 20 } });
  // 2 × $960 + $800 = $2.720, menos que el combo de $3.000.
  const doc = { document: { cliente_id: cli } };
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', venta([[beb, 2, 960], [pan, 1, 800]], doc)))).ok);
  const encima = await intentar(rpc(caj, 'fn_register_sale', venta([[beb, 2, 960, 100], [pan, 1, 800]], doc)));
  assert.equal(encima.ok, false, 'sumó un descuento de combo al precio de cliente');
});

test('solo admin y supervisor arman combos, y un combo tiene que ser un combo', async () => {
  const { L, beb, pan, adm, caj } = await mostrador();
  const otro = await nuevoLocal(banco, 'Otro');
  const ajeno = await otro.producto({ nombre: 'Ajeno', precio: 5000 });
  const items = [{ product_id: beb, cantidad: 2 }, { product_id: pan, cantidad: 1 }];
  const v = await intentar(rpc(caj, 'fn_guardar_combo', { p_id: null, p_datos: { nombre: 'X', precio: 1, items } }));
  assert.equal(v.ok, false);
  assert.match(v.error, /SIN_PERMISO/);
  const casos = [
    [{ nombre: 'X', precio: 1000, items: [{ product_id: beb, cantidad: 3 }] }, /COMBO_UN_SOLO_PRODUCTO/],
    [{ nombre: 'X', precio: 3400, items }, /COMBO_NO_ES_MAS_BARATO/],
    [{ nombre: 'X', precio: 0, items }, /COMBO_INVALIDO/],
    [{ nombre: '', precio: 3000, items }, /NOMBRE_COMBO_REQUERIDO/],
    [{ nombre: 'X', precio: 3000, items: [...items, { product_id: pan, cantidad: 1 }] }, /COMBO_PRODUCTO_REPETIDO/],
    [{ nombre: 'X', precio: 3000, items: [items[0], { product_id: ajeno, cantidad: 1 }] }, /PRODUCTO_NO_ENCONTRADO/],
  ];
  for (const [datos, error] of casos) {
    const r = await intentar(rpc(adm, 'fn_guardar_combo', { p_id: null, p_datos: datos }));
    assert.equal(r.ok, false, JSON.stringify(datos).slice(0, 80));
    assert.match(r.error, error);
  }
  const directo = await intentar(caj.query(`update combos set precio = 1 where tenant_id = $1`, [L.tenant]));
  const { rows } = await banco.su.query(`select precio from combos where tenant_id = $1`, [L.tenant]);
  assert.ok(rows.every((x) => x.precio === 3000), `un vendedor cambió el precio del combo (${JSON.stringify(directo)})`);
});

test('la base y core aplican los mismos combos, con carritos y combos al azar', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const productos = [];
  for (let i = 0; i < 6; i++) {
    const precio = 300 + Math.floor(Math.random() * 3000);
    productos.push({ id: await L.producto({ nombre: `P${i}`, precio }), precio });
  }
  const combos = [];
  for (let i = 0; i < 5; i++) {
    const elegidos = [...productos].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
    const items = elegidos.map((p) => ({ product_id: p.id, cantidad: 1 + Math.floor(Math.random() * 3) }));
    const normal = elegidos.reduce((s, p, k) => s + p.precio * items[k].cantidad, 0);
    const precio = Math.max(1, Math.floor(normal * (0.6 + Math.random() * 0.35)));
    const id = await rpc(adm, 'fn_guardar_combo', { p_id: null, p_datos: { nombre: `C${i}`, precio, items } });
    combos.push({ id, nombre: `C${i}`, precio, items: items.map((x) => ({ productId: x.product_id, cantidad: x.cantidad })) });
  }
  for (let v = 0; v < 30; v++) {
    const lineas = productos.filter(() => Math.random() < 0.8)
      .map((p) => ({ product_id: p.id, cantidad: 1 + Math.floor(Math.random() * 6), precio: p.precio }));
    const { rows: [{ r }] } = await banco.su.query(`select fn_ahorro_combos($1, $2::jsonb, null) as r`, [L.tenant, JSON.stringify(lineas)]);
    const core = calcularCombos(lineas.map((l) => ({ productId: l.product_id, cantidad: l.cantidad, precio: l.precio })), combos);
    assert.equal(r.total, core.reduce((s, a) => s + a.ahorro, 0), `carrito ${v}`);
    assert.deepEqual(r.aplicados.map((a) => [a.combo_id, a.veces]), core.map((a) => [a.comboId, a.veces]));
  }
});
