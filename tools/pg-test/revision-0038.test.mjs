/**
 * 0038 · Ronda 8 (docs/29): lo que la base todavía dejaba hacer.
 *
 * Se vieron fallar sin 0038 (regla 16) y pasar con ella.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const RECEPTOR = {
  rut: '76.086.428-5', razon_social: 'Comercial Los Aromos SpA', giro: 'Venta de abarrotes',
  direccion: 'Av. Siempre Viva 742', comuna: 'Maipú', ciudad: 'Santiago', correo: 'compras@aromos.cl',
};

const crear = (extra = {}) => ({
  p_name: `Pan ${Math.random().toString(16).slice(2, 8)}`,
  p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
  p_sale_price: 250, p_avg_cost: 120, p_min_stock: 0,
  p_tracks_expiry: false, p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0,
  ...extra,
});

test('una cuenta desactivada no lee datos del local, pero sí su propio perfil', async () => {
  const L = await nuevoLocal(banco);
  await L.producto({ nombre: 'Arroz' });
  const caj = await banco.como(L.cajero1);
  assert.equal((await caj.query('select id from products')).rows.length, 1, 'activa sí ve el catálogo');
  await banco.su.query('update profiles set is_active = false where id = $1', [L.cajero1.id]);
  assert.equal((await caj.query('select id from products')).rows.length, 0, 'desactivada seguía leyendo el catálogo');
  assert.equal((await caj.query('select id from profiles')).rows.length, 1, 'tiene que ver su perfil (para el aviso)');
});

test('una cuenta desactivada no escribe proveedores ni categorías', async () => {
  const L = await nuevoLocal(banco);
  await banco.su.query('update profiles set is_active = false where id = $1', [L.supervisor.id]);
  const sup = await banco.como(L.supervisor);
  const r = await intentar(sup.query(`insert into categories (tenant_id, name) values ($1, 'X')`, [L.tenant]));
  assert.equal(r.ok, false);
});

test('bodega no cambia el costo ni el precio de un producto por la API; activar/desactivar sigue', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ costo: 600 });
  const bod = await banco.como(L.bodega);
  const r = await intentar(bod.query('update products set avg_cost = 1 where id = $1', [p]));
  assert.equal(r.ok, false, 'bodega dejó el costo en $1 saltándose fn_update_product');
  const ins = await intentar(bod.query(`insert into products (tenant_id, name) values ($1, 'X')`, [L.tenant]));
  assert.equal(ins.ok, false);
  const adm = await banco.como(L.admin);
  const { rowCount } = await adm.query('update products set is_active = false where id = $1', [p]);
  assert.equal(rowCount, 1);
});

test('códigos de barra: sin escritura directa', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  const bod = await banco.como(L.bodega);
  const r = await intentar(bod.query(
    `insert into product_barcodes (tenant_id, product_id, barcode) values ($1, $2, '123')`, [L.tenant, p]));
  assert.equal(r.ok, false);
});

test('nadie se cambia el correo del perfil; el admin sigue cambiando roles', async () => {
  const L = await nuevoLocal(banco);
  const caj = await banco.como(L.cajero1);
  const r = await intentar(caj.query(`update profiles set email = 'jefe@local.cl' where id = $1`, [L.cajero1.id]));
  assert.equal(r.ok, false, 'el cajero se puso el correo de otro');
  const adm = await banco.como(L.admin);
  const { rowCount } = await adm.query(`update profiles set role = 'supervisor' where id = $1`, [L.cajero2.id]);
  assert.equal(rowCount, 1);
});

test('un vendedor no crea proveedores, categorías ni tiendas; bodega crea proveedor y categoría, pero no edita', async () => {
  const L = await nuevoLocal(banco);
  const caj = await banco.como(L.cajero1);
  for (const sql of [`insert into suppliers (tenant_id, name) values ($1, 'X')`,
    `insert into categories (tenant_id, name) values ($1, 'X')`, `insert into stores (tenant_id, name) values ($1, 'X')`]) {
    const r = await intentar(caj.query(sql, [L.tenant]));
    assert.equal(r.ok, false, sql);
  }
  const bod = await banco.como(L.bodega);
  const { rows: [s] } = await bod.query(`insert into suppliers (tenant_id, name) values ($1, 'Distribuidora') returning id`, [L.tenant]);
  await bod.query(`insert into categories (tenant_id, name) values ($1, 'Lácteos')`, [L.tenant]);
  const { rowCount } = await bod.query(`update suppliers set name = 'Otro' where id = $1`, [s.id]);
  assert.equal(rowCount, 0);
});

test('devolver una venta: por unidad', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ stock: 10 });
  const sup = await banco.como(L.supervisor);
  await rpc(sup, 'fn_open_cash_session', { p_opening_amount: 0 });
  const v = await rpc(sup, 'fn_register_sale', venta(p, 2, 1000));
  const { rows: [it] } = await banco.su.query('select id from sale_items where sale_id = $1', [v.sale_id]);
  const r = await intentar(rpc(sup, 'fn_devolver_venta', {
    p_sale_id: v.sale_id, p_items: [{ sale_item_id: it.id, cantidad: 1.5 }], p_motivo: 'x', p_reembolso: 'efectivo' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /CANTIDAD_ENTERA/);
});

test('nota de crédito: un producto vuelve por unidad; una línea libre admite decimales', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', stock: 10 });
  const adm = await banco.como(L.admin);
  const f = await rpc(adm, 'fn_emitir_factura_manual', { p_datos: {
    client_uuid: crypto.randomUUID(), receptor: RECEPTOR, forma_pago: 'credito',
    lineas: [{ product_id: pan, cantidad: 3, precio: 1000 }, { nombre: 'Flete', cantidad: 2, precio: 5000 }] } });
  const { rows } = await banco.su.query('select id, product_id from factura_lineas where factura_id = $1 order by linea', [f.id]);
  const r = await intentar(rpc(adm, 'fn_nota_credito_factura', {
    p_factura: f.id, p_items: [{ linea_id: rows[0].id, cantidad: 0.5 }], p_motivo: 'x' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /CANTIDAD_ENTERA/);
  const ok = await rpc(adm, 'fn_nota_credito_factura', {
    p_factura: f.id, p_items: [{ linea_id: rows[1].id, cantidad: 0.5 }], p_motivo: 'x' });
  assert.ok(ok.monto > 0);
});

test('crear y editar producto: cuenta activa, categoría del local, enteros y códigos repetidos', async () => {
  const L = await nuevoLocal(banco);
  const otro = await nuevoLocal(banco, 'Otro');
  const { rows: [cat] } = await banco.su.query(`insert into categories (tenant_id, name) values ($1, 'Ajena') returning id`, [otro.tenant]);
  const adm = await banco.como(L.admin);

  let r = await intentar(rpc(adm, 'fn_create_product', crear({ p_category_id: cat.id })));
  assert.match(r.error ?? '', /CATEGORIA_NO_ENCONTRADA/);
  r = await intentar(rpc(adm, 'fn_create_product', crear({ p_initial_stock: 1.5 })));
  assert.match(r.error ?? '', /CANTIDAD_ENTERA/);
  r = await intentar(rpc(adm, 'fn_create_product', crear({ p_min_stock: 2.5 })));
  assert.match(r.error ?? '', /CANTIDAD_ENTERA/);
  r = await intentar(rpc(adm, 'fn_create_product', crear({ p_barcodes: '{7801,7801}' })));
  assert.match(r.error ?? '', /CODIGO_EN_USO/);

  const p = await rpc(adm, 'fn_create_product', crear());
  const editar = (extra) => ({
    p_product_id: p.product_id, p_name: 'Pan', p_sku: null, p_description: null, p_category_id: null,
    p_unit: 'unidad', p_sale_price: 300, p_avg_cost: null, p_min_stock: 0, p_tracks_expiry: false,
    p_expiry_alert_days: 30, p_barcodes: null, ...extra,
  });
  r = await intentar(rpc(adm, 'fn_update_product', editar({ p_category_id: cat.id })));
  assert.match(r.error ?? '', /CATEGORIA_NO_ENCONTRADA/);

  await banco.su.query('update profiles set is_active = false where id = $1', [L.bodega.id]);
  const bod = await banco.como(L.bodega);
  r = await intentar(rpc(bod, 'fn_create_product', crear()));
  assert.match(r.error ?? '', /SIN_PERMISO_CREAR_PRODUCTO/);
  r = await intentar(rpc(bod, 'fn_update_product', editar({})));
  assert.match(r.error ?? '', /SIN_PERMISO_CREAR_PRODUCTO/);
});

test('un combo va por unidad', async () => {
  const L = await nuevoLocal(banco);
  const a = await L.producto({ nombre: 'Bebida', precio: 1200 });
  const b = await L.producto({ nombre: 'Pan', precio: 1000 });
  const adm = await banco.como(L.admin);
  const r = await intentar(rpc(adm, 'fn_guardar_combo', { p_id: null, p_datos: {
    nombre: 'Once', precio: 2000, items: [{ product_id: a, cantidad: 1 }, { product_id: b, cantidad: 1.5 }] } }));
  assert.equal(r.ok, false);
  assert.match(r.error, /CANTIDAD_ENTERA/);
});

test('una oferta por cantidad va por unidad', async () => {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ precio: 1000 });
  const adm = await banco.como(L.admin);
  const r = await intentar(rpc(adm, 'fn_guardar_precios_producto', { p_product_id: p, p_tramos: [{ desde: 2.5, precio: 900 }] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /CANTIDAD_ENTERA/);
  assert.equal(await rpc(adm, 'fn_guardar_precios_producto', { p_product_id: p, p_tramos: [{ desde: 3, precio: 900 }] }), 1);
});

test('una factura que el SII ya emitió no se reintenta ni se descarta', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', stock: 10 });
  const adm = await banco.como(L.admin);
  const f = await rpc(adm, 'fn_emitir_factura_manual', { p_datos: {
    client_uuid: crypto.randomUUID(), receptor: RECEPTOR, forma_pago: 'credito',
    lineas: [{ product_id: pan, cantidad: 2, precio: 1000 }] } });
  await banco.su.query(`update facturas set estado = 'error',
    ultimo_error = 'El SII emitió el folio 123, pero no se pudo registrar: timeout' where id = $1`, [f.id]);
  const r1 = await intentar(rpc(adm, 'fn_reintentar_factura', { p_factura: f.id }));
  assert.match(r1.error ?? '', /FACTURA_YA_EMITIDA_EN_SII/);
  const r2 = await intentar(rpc(adm, 'fn_descartar_factura', { p_factura: f.id, p_motivo: 'x' }));
  assert.match(r2.error ?? '', /FACTURA_YA_EMITIDA_EN_SII/);
  assert.equal(await L.stock(pan), 8, 'el stock volvió aunque la mercadería salió');
});

test('impuesto adicional: dos decimales y código SII positivo', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const g = (tasa, codigo) => intentar(rpc(adm, 'fn_guardar_impuesto', { p_id: null, p_nombre: `IABA ${tasa} ${codigo}`, p_codigo_sii: codigo, p_tasa: tasa }));
  assert.match((await g(18.555, 27)).error ?? '', /TASA_INVALIDA/);
  assert.match((await g(18, -5)).error ?? '', /CODIGO_SII_INVALIDO/);
  assert.equal((await g(20.5, 271)).ok, true);
});
