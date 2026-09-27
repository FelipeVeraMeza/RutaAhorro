/**
 * 0022 · Clientes y precio por cliente (RQ-07, RQ-20, RQ-21).
 *
 * Decisión de Felipe (2026-09-27): un % de rebaja general por cliente y
 * precios especiales en productos puntuales; se cobra el más barato entre la
 * oferta, el % y el precio especial, sin sumarse.
 *
 * Lo delicado: un vendedor con tope 0 % tiene que poder cobrar el precio del
 * cliente (lo configuró el dueño), y NO tiene que poder cobrarlo sin elegir al
 * cliente, ni con un cliente de otro local.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';
import { precioParaCliente } from '../../packages/core/dist/index.js';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

async function mostrador() {
  const L = await nuevoLocal(banco);
  const jugo = await L.producto({ nombre: 'Jugo', precio: 2000, stock: 500 });
  const cafe = await L.producto({ nombre: 'Café', precio: 4000, stock: 500 });
  const adm = await banco.como(L.admin);
  const sup = await banco.como(L.supervisor);
  const caj = await banco.como(L.cajero1);
  for (const c of [adm, sup, caj]) await rpc(c, 'fn_open_cash_session', { p_opening_amount: 0 });
  const mayorista = await rpc(adm, 'fn_guardar_cliente', {
    p_id: null, p_datos: { nombre: 'Almacén Don Pepe', rut: '76.086.428-5', descuento_pct: 8 },
  });
  await rpc(adm, 'fn_guardar_precios_cliente', {
    p_cliente_id: mayorista, p_precios: [{ product_id: cafe, precio: 3500 }],
  });
  return { L, jugo, cafe, adm, sup, caj, mayorista };
}

function venta(lineas, extra = {}) {
  const total = lineas.reduce((s, [, q, p]) => s + Math.round(q * p), 0);
  return {
    p_client_uuid: crypto.randomUUID(),
    p_items: lineas.map(([product_id, quantity, unit_price]) => ({ product_id, quantity, unit_price, discount_amount: 0 })),
    p_payments: [{ method: 'efectivo', amount: total }],
    ...(extra.document ? { p_document: extra.document } : {}),
  };
}

test('el vendedor cobra el precio del cliente: su % en uno, su precio especial en otro', async () => {
  const { jugo, cafe, caj, mayorista } = await mostrador();
  const r = await rpc(caj, 'fn_register_sale', venta([[jugo, 2, 1840], [cafe, 1, 3500]],
    { document: { cliente_id: mayorista } }));
  assert.equal(r.total, 2 * 1840 + 3500);
  const { rows: [s] } = await banco.su.query(`select cliente_id from sales where id = $1`, [r.sale_id]);
  assert.equal(s.cliente_id, mayorista, 'la venta guarda a quién se le vendió a precio mayorista');
});

test('sin elegir al cliente, el mismo precio es un descuento sin permiso', async () => {
  const { jugo, caj } = await mostrador();
  const r = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 2, 1840]])));
  assert.equal(r.ok, false);
  assert.match(r.error, /DESCUENTO_EXCEDE_LIMITE/);
});

test('ni por debajo del precio del cliente', async () => {
  const { jugo, caj, mayorista } = await mostrador();
  const r = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1839]], { document: { cliente_id: mayorista } })));
  assert.equal(r.ok, false);
  assert.match(r.error, /DESCUENTO_EXCEDE_LIMITE/);
});

test('oferta y cliente no se suman: gana el más barato', async () => {
  const { jugo, adm, caj, mayorista } = await mostrador();
  await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: jugo, p_tramos: [{ desde: 3, precio: 1400 }] });
  // Con 3, la oferta ($1.400) es mejor que el 8 % ($1.840).
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 3, 1400]], { document: { cliente_id: mayorista } })))).ok);
  // Pero no el 8 % encima de la oferta.
  const r = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 3, 1288]], { document: { cliente_id: mayorista } })));
  assert.equal(r.ok, false, 'sumó la oferta y el % del cliente');
  // Con las ofertas apagadas, el precio del cliente sigue: es un acuerdo, no una promoción.
  await rpc(adm, 'fn_guardar_configuracion', { p_cambios: { ofertas_activas: false } });
  await banco.su.query(`update tenants set settings = settings || jsonb_build_object('ofertas_pausadas_desde', now() - interval '1 hour')
                         where id = (select tenant_id from clientes where id = $1)`, [mayorista]);
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 3, 1840]], { document: { cliente_id: mayorista } })))).ok);
});

test('un cliente de otro local, o desactivado, no sirve para vender a su precio', async () => {
  const { jugo, adm, caj, mayorista } = await mostrador();
  const otro = await nuevoLocal(banco, 'Otro');
  const admOtro = await banco.como(otro.admin);
  const ajeno = await rpc(admOtro, 'fn_guardar_cliente', { p_id: null, p_datos: { nombre: 'Del vecino', descuento_pct: 50 } });
  const r1 = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1000]], { document: { cliente_id: ajeno } })));
  assert.equal(r1.ok, false);
  assert.match(r1.error, /CLIENTE_NO_ENCONTRADO/);

  await rpc(adm, 'fn_guardar_cliente', { p_id: mayorista, p_datos: { nombre: 'Almacén Don Pepe', rut: '76.086.428-5', descuento_pct: 8, activo: false } });
  const r2 = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1840]], { document: { cliente_id: mayorista } })));
  assert.equal(r2.ok, false);
  assert.match(r2.error, /CLIENTE_NO_ENCONTRADO/);
});

test('solo admin y supervisor crean clientes y les ponen precio; se valida RUT, % y duplicados', async () => {
  const { cafe, sup, caj, mayorista } = await mostrador();
  const v = await intentar(rpc(caj, 'fn_guardar_cliente', { p_id: null, p_datos: { nombre: 'Yo mismo', descuento_pct: 99 } }));
  assert.equal(v.ok, false);
  assert.match(v.error, /SIN_PERMISO/);
  const v2 = await intentar(rpc(caj, 'fn_guardar_precios_cliente', { p_cliente_id: mayorista, p_precios: [{ product_id: cafe, precio: 1 }] }));
  assert.equal(v2.ok, false, 'un vendedor se puso un precio especial');
  // Tampoco escribiendo la tabla directo (regla 14).
  const directo = await intentar(caj.query(`update clientes set descuento_pct = 99 where id = $1`, [mayorista]));
  const { rows: [c] } = await banco.su.query(`select descuento_pct::float as d from clientes where id = $1`, [mayorista]);
  assert.equal(c.d, 8, `un vendedor cambió el % del cliente (${JSON.stringify(directo)})`);

  const casos = [
    [{ nombre: '' }, /NOMBRE_CLIENTE_REQUERIDO/],
    [{ nombre: 'X', rut: '11.111.111-2' }, /RUT_INVALIDO/],
    [{ nombre: 'X', descuento_pct: 100 }, /PORCENTAJE_INVALIDO/],
    [{ nombre: 'X', descuento_pct: -1 }, /PORCENTAJE_INVALIDO/],
    [{ nombre: 'Otro Don Pepe', rut: '76086428-5' }, /CLIENTE_RUT_DUPLICADO/],
  ];
  for (const [datos, error] of casos) {
    const r = await intentar(rpc(sup, 'fn_guardar_cliente', { p_id: null, p_datos: datos }));
    assert.equal(r.ok, false, JSON.stringify(datos));
    assert.match(r.error, error);
  }
});

test('RQ-20 · una factura a un RUT nuevo deja al cliente guardado; la siguiente lo reconoce', async () => {
  const { jugo, caj, L } = await mostrador();
  const doc = { tipo: 'factura', rut: '12.345.678-5', razon_social: 'Minimarket La Esquina', giro: 'Comercio', direccion: 'Calle 1' };
  const r1 = await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 2000]], { document: doc }));
  const { rows: cs } = await banco.su.query(`select id, nombre, giro, rut from clientes where tenant_id = $1 and rut = '12.345.678-5'`, [L.tenant]);
  assert.equal(cs.length, 1, 'no guardó al receptor');
  assert.equal(cs[0].nombre, 'Minimarket La Esquina');

  // La segunda factura, con otro giro escrito, no pisa el guardado ni duplica.
  const r2 = await rpc(caj, 'fn_register_sale', venta([[jugo, 1, 2000]], { document: { ...doc, giro: 'Otro giro' } }));
  const { rows: cs2 } = await banco.su.query(`select giro from clientes where tenant_id = $1 and rut = '12.345.678-5'`, [L.tenant]);
  assert.equal(cs2.length, 1);
  assert.equal(cs2[0].giro, 'Comercio', 'un vendedor le cambió los datos al cliente al facturar');
  const { rows: vs } = await banco.su.query(`select cliente_id from sales where id in ($1, $2)`, [r1.sale_id, r2.sale_id]);
  assert.ok(vs.every((v) => v.cliente_id === cs[0].id), 'las dos facturas quedan del mismo cliente');
});

test('RQ-20 · facturar a un RUT que ya es cliente aplica su precio aunque no lo hayan elegido', async () => {
  const { jugo, caj } = await mostrador();
  const r = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1840]], {
    document: { tipo: 'factura', rut: '76086428-5', razon_social: 'Almacén Don Pepe' },
  })));
  assert.ok(r.ok, r.error);
});

test('la base y core calculan igual el precio del cliente, con precios y % al azar', async () => {
  const { L, adm } = await mostrador();
  for (let i = 0; i < 25; i++) {
    const base = 100 + Math.floor(Math.random() * 30_000);
    const pct = Math.floor(Math.random() * 3000) / 100;
    const especial = Math.random() < 0.5 ? Math.max(1, Math.floor(base * (0.6 + Math.random() * 0.6))) : null;
    const p = await L.producto({ nombre: `Azar ${i}`, precio: base });
    const c = await rpc(adm, 'fn_guardar_cliente', { p_id: null, p_datos: { nombre: `Azar ${i}`, descuento_pct: pct } });
    if (especial) await rpc(adm, 'fn_guardar_precios_cliente', { p_cliente_id: c, p_precios: [{ product_id: p, precio: especial }] });
    const { rows: [{ precio }] } = await banco.su.query(`select fn_precio_cliente($1, $2, $3) as precio`, [c, p, base]);
    const bd = precio == null || precio >= base ? null : precio;
    const core = precioParaCliente(p, base, { id: c, nombre: '', descuentoPct: pct, precios: especial ? { [p]: especial } : {} });
    assert.equal(bd, core, `base ${base}, ${pct} %, especial ${especial}`);
  }
});
