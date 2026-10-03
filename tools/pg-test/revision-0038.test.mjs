/**
 * 0038 · Lo que la 0037 no alcanzó (docs/29). Cada prueba se vio fallar sin
 * 0038 antes de darla por buena (regla 16).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const filas = async (c, sql, params = []) => (await c.query(sql, params)).rows;

test('una cuenta desactivada no lee ni escribe las tablas, pero sí ve su propio perfil', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ nombre: 'Bebida', precio: 1000 });
  await banco.su.query('update profiles set is_active = false where id = $1', [L.bodega.id]);
  const c = await banco.como(L.bodega);

  assert.equal((await filas(c, 'select id from products')).length, 0, 'seguía leyendo el catálogo');
  await intentar(c.query(`update products set sale_price = 1 where id = $1`, [p]));
  const { rows: [x] } = await banco.su.query('select sale_price from products where id = $1', [p]);
  assert.equal(Number(x.sale_price), 1000, 'cambió el precio con la cuenta desactivada');

  const yo = await filas(c, 'select id, is_active from profiles');
  assert.deepEqual(yo.map((r) => [r.id, r.is_active]), [[L.bodega.id, false]], 'no ve su propio perfil (o ve otros)');
});

test('devolver media unidad se rechaza', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ precio: 1000, stock: 10 });
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_open_cash_session', { p_opening_amount: 0 });
  const r = await rpc(adm, 'fn_register_sale', venta(p, 2, 1000));
  const [it] = await filas(banco.su, 'select id from sale_items where sale_id = $1', [r.sale_id]);
  const d = await intentar(rpc(adm, 'fn_devolver_venta', {
    p_sale_id: r.sale_id, p_items: [{ sale_item_id: it.id, cantidad: 0.5 }], p_motivo: 'x', p_reembolso: 'efectivo' }));
  assert.equal(d.ok, false);
  assert.match(d.error, /CANTIDAD_ENTERA/);
});

test('producto: categoría de otro local y mínimo con decimales se rechazan', async () => {
  const A = await nuevoLocal(banco, 'A');
  const B = await nuevoLocal(banco, 'B');
  const [cat] = await filas(banco.su, `insert into categories (tenant_id, name) values ($1, 'Ajena') returning id`, [B.tenant]);
  const adm = await banco.como(A.admin);
  const base = {
    p_name: 'Pan', p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
    p_sale_price: 1000, p_avg_cost: 500, p_min_stock: 2, p_tracks_expiry: false, p_expiry_alert_days: 30,
    p_barcodes: null, p_initial_stock: 0,
  };
  const r1 = await intentar(rpc(adm, 'fn_create_product', { ...base, p_category_id: cat.id }));
  assert.match(r1.error ?? '', /CATEGORIA_NO_ENCONTRADA/);
  const r2 = await intentar(rpc(adm, 'fn_create_product', { ...base, p_min_stock: 2.5 }));
  assert.match(r2.error ?? '', /CANTIDAD_ENTERA/);

  const p = await A.producto();
  const r3 = await intentar(rpc(adm, 'fn_update_product', {
    p_product_id: p, p_name: 'X', p_sku: null, p_description: null, p_category_id: cat.id, p_unit: 'unidad',
    p_sale_price: 1000, p_avg_cost: null, p_min_stock: 1, p_tracks_expiry: false, p_expiry_alert_days: 30, p_barcodes: null }));
  assert.match(r3.error ?? '', /CATEGORIA_NO_ENCONTRADA/);
});

test('factura manual: un cliente elegido con otro RUT no queda ligado a la factura', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const [otro] = await filas(banco.su,
    `insert into clientes (tenant_id, rut, nombre) values ($1, '11.111.111-1', 'Otro cliente') returning id`, [L.tenant]);
  const receptor = {
    rut: '76.086.428-5', razon_social: 'Comercial Los Aromos SpA', giro: 'Abarrotes',
    direccion: 'Av. Siempre Viva 742', comuna: 'Maipú', ciudad: 'Santiago', correo: '',
  };
  const f = await rpc(adm, 'fn_emitir_factura_manual', { p_datos: {
    client_uuid: crypto.randomUUID(), cliente_id: otro.id, receptor, forma_pago: 'contado',
    lineas: [{ nombre: 'Flete', cantidad: 1, precio: 1190 }] } });
  const [fila] = await filas(banco.su, 'select cliente_id from facturas where id = $1', [f.id]);
  assert.notEqual(fila.cliente_id, otro.id, 'la factura quedó a nombre del cliente equivocado');
  const [o] = await filas(banco.su, 'select giro from clientes where id = $1', [otro.id]);
  assert.equal(o.giro, null, 'al otro cliente se le completó el giro del receptor');
});

test('no se descarta una factura que el SII ya emitió', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const receptor = {
    rut: '76.086.428-5', razon_social: 'Comercial Los Aromos SpA', giro: 'Abarrotes',
    direccion: 'Av. Siempre Viva 742', comuna: 'Maipú', ciudad: 'Santiago', correo: '',
  };
  const f = await rpc(adm, 'fn_emitir_factura_manual', { p_datos: {
    client_uuid: crypto.randomUUID(), receptor, forma_pago: 'contado',
    lineas: [{ nombre: 'Flete', cantidad: 1, precio: 1190 }] } });
  await banco.su.query(`update facturas set estado = 'error',
    ultimo_error = 'El SII emitió el folio 55, pero no se pudo registrar: timeout' where id = $1`, [f.id]);
  const r = await intentar(rpc(adm, 'fn_descartar_factura', { p_factura: f.id, p_motivo: 'no salió' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /FACTURA_EMITIDA_EN_SII/);
});

test('un vendedor no crea categorías, códigos, proveedores ni locales; bodega sí lo que usa', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  const ven = await banco.como(L.cajero1);
  const intentos = {
    categoria: await intentar(ven.query(`insert into categories (tenant_id, name) values ($1, 'X')`, [L.tenant])),
    codigo: await intentar(ven.query(`insert into product_barcodes (tenant_id, product_id, barcode) values ($1, $2, '7800000000999')`, [L.tenant, p])),
    proveedor: await intentar(ven.query(`insert into suppliers (tenant_id, name) values ($1, 'Falso')`, [L.tenant])),
    local: await intentar(ven.query(`insert into stores (tenant_id, name) values ($1, 'Otro')`, [L.tenant])),
  };
  for (const [que, r] of Object.entries(intentos)) assert.equal(r.ok, false, `el vendedor creó: ${que}`);

  // Lo que la app sí hace: bodega crea la categoría nueva y el proveedor de
  // la recepción, pero no los cambia.
  const bod = await banco.como(L.bodega);
  const [cat] = await filas(bod, `insert into categories (tenant_id, name) values ($1, 'Congelados') returning id`, [L.tenant]);
  assert.ok(cat?.id, 'bodega no pudo crear la categoría');
  const [sup] = await filas(bod, `insert into suppliers (tenant_id, name) values ($1, 'Distribuidora') returning id`, [L.tenant]);
  assert.ok(sup?.id, 'bodega no pudo crear el proveedor');
  await bod.query(`update categories set name = 'Otra' where id = $1`, [cat.id]);
  const [x] = await filas(banco.su, 'select name from categories where id = $1', [cat.id]);
  assert.equal(x?.name, 'Congelados', 'bodega cambió la categoría');
});

test('un aviso se marca como visto, pero no se reescribe', async () => {
  const L = await nuevoLocal(banco);
  const [a] = await filas(banco.su, `insert into alerts (tenant_id, type, severity, payload)
    values ($1, 'lot_mismatch', 'critical', '{"product_name":"Leche"}') returning id`, [L.tenant]);
  const sup = await banco.como(L.supervisor);

  const r = await intentar(sup.query(`update alerts set severity = 'info', payload = '{}' where id = $1`, [a.id]));
  assert.equal(r.ok, false, 'el supervisor reescribió el aviso');
  const r2 = await intentar(sup.query(`update alerts set is_read = true, read_by = $2 where id = $1`, [a.id, L.admin.id]));
  assert.equal(r2.ok, false, 'anotó que lo vio otra persona');

  await sup.query(`update alerts set is_read = true, read_at = now(), read_by = $2 where id = $1`, [a.id, L.supervisor.id]);
  const [x] = await filas(banco.su, 'select is_read, severity from alerts where id = $1', [a.id]);
  assert.deepEqual([x.is_read, x.severity], [true, 'critical']);
});
