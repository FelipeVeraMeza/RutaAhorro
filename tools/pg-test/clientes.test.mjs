/**
 * Clientes (0022) sin precio propio (0032).
 *
 * 0022 le daba a cada cliente un % de rebaja y precios especiales. Felipe lo
 * corrigió el 2026-10-01: el precio por mayor es del PRODUCTO («las papas por
 * mayor desde 3»), no de quién compra. Un cliente que lleva 2 pidió el precio
 * por mayor, no se lo dieron y se fue enojado: el sistema no tiene que dejar
 * a un cliente con precio mayorista.
 *
 * El cliente sigue sirviendo para la factura (RQ-20) y el fiado.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';

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
  // Un cliente como quedó de antes de 0032: con su % y un precio especial
  // guardados. Lo guardado no se borró; tiene que no servir.
  const mayorista = await rpc(adm, 'fn_guardar_cliente', {
    p_id: null, p_datos: { nombre: 'Almacén Don Pepe', rut: '76.086.428-5', descuento_pct: 8 },
  });
  await banco.su.query(
    `insert into cliente_precios (tenant_id, cliente_id, product_id, precio) values ($1, $2, $3, 3500)`,
    [L.tenant, mayorista, cafe]);
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

test('el cliente queda en la venta, a precio normal', async () => {
  const { jugo, cafe, caj, mayorista } = await mostrador();
  const r = await rpc(caj, 'fn_register_sale', venta([[jugo, 2, 2000], [cafe, 1, 4000]],
    { document: { cliente_id: mayorista } }));
  assert.equal(r.total, 8000);
  const { rows: [s] } = await banco.su.query(`select cliente_id from sales where id = $1`, [r.sale_id]);
  assert.equal(s.cliente_id, mayorista);
});

test('ni el % ni el precio especial guardados del cliente bajan el precio', async () => {
  const { jugo, cafe, caj, mayorista } = await mostrador();
  const doc = { document: { cliente_id: mayorista } };
  for (const [p, precio] of [[jugo, 1840], [cafe, 3500]]) {
    const r = await intentar(rpc(caj, 'fn_register_sale', venta([[p, 1, precio]], doc)));
    assert.equal(r.ok, false, `cobró ${precio} por ser el cliente`);
    assert.match(r.error, /DESCUENTO_EXCEDE_LIMITE/);
  }
  const { rows: [{ precio }] } = await banco.su.query(`select fn_precio_cliente($1, $2, 4000) as precio`, [mayorista, cafe]);
  assert.equal(precio, null);
});

test('ya no se le puede poner precio a un cliente', async () => {
  const { cafe, adm, mayorista } = await mostrador();
  const r = await intentar(rpc(adm, 'fn_guardar_precios_cliente', {
    p_cliente_id: mayorista, p_precios: [{ product_id: cafe, precio: 3000 }] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /PRECIO_POR_CLIENTE_DESACTIVADO/);
});

test('el precio por mayor es del producto: desde 3 sí, con 2 no, sea quien sea', async () => {
  const { jugo, adm, caj, mayorista } = await mostrador();
  await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: jugo, p_tramos: [{ desde: 3, precio: 1400 }] });
  assert.ok((await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 3, 1400]])))).ok, 'con 3 va por mayor');
  for (const doc of [{}, { document: { cliente_id: mayorista } }]) {
    const r = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 2, 1400]], doc)));
    assert.equal(r.ok, false, `vendió 2 a precio por mayor ${JSON.stringify(doc)}`);
  }
});

test('un cliente de otro local, o desactivado, no sirve para vender', async () => {
  const { jugo, adm, caj, mayorista } = await mostrador();
  const otro = await nuevoLocal(banco, 'Otro');
  const admOtro = await banco.como(otro.admin);
  const ajeno = await rpc(admOtro, 'fn_guardar_cliente', { p_id: null, p_datos: { nombre: 'Del vecino' } });
  const r1 = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 1, 2000]], { document: { cliente_id: ajeno } })));
  assert.equal(r1.ok, false);
  assert.match(r1.error, /CLIENTE_NO_ENCONTRADO/);

  await rpc(adm, 'fn_guardar_cliente', { p_id: mayorista, p_datos: { nombre: 'Almacén Don Pepe', rut: '76.086.428-5', activo: false } });
  const r2 = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 1, 2000]], { document: { cliente_id: mayorista } })));
  assert.equal(r2.ok, false);
  assert.match(r2.error, /CLIENTE_NO_ENCONTRADO/);
});

test('solo admin y supervisor crean clientes; se valida RUT y duplicados', async () => {
  const { sup, caj, mayorista } = await mostrador();
  const v = await intentar(rpc(caj, 'fn_guardar_cliente', { p_id: null, p_datos: { nombre: 'Yo mismo' } }));
  assert.equal(v.ok, false);
  assert.match(v.error, /SIN_PERMISO/);
  // Tampoco escribiendo la tabla directo (regla 14).
  const directo = await intentar(caj.query(`update clientes set nombre = 'Cambiado' where id = $1`, [mayorista]));
  const { rows: [c] } = await banco.su.query(`select nombre from clientes where id = $1`, [mayorista]);
  assert.equal(c.nombre, 'Almacén Don Pepe', `un vendedor cambió al cliente (${JSON.stringify(directo)})`);

  const casos = [
    [{ nombre: '' }, /NOMBRE_CLIENTE_REQUERIDO/],
    [{ nombre: 'X', rut: '11.111.111-2' }, /RUT_INVALIDO/],
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

test('RQ-20 · facturar a un RUT que ya es cliente cobra el precio normal', async () => {
  const { jugo, caj } = await mostrador();
  const document = { tipo: 'factura', rut: '76086428-5', razon_social: 'Almacén Don Pepe' };
  const rebajado = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 1, 1840]], { document })));
  assert.equal(rebajado.ok, false, 'facturó con el % del cliente');
  const normal = await intentar(rpc(caj, 'fn_register_sale', venta([[jugo, 1, 2000]], { document })));
  assert.ok(normal.ok, normal.error);
});
