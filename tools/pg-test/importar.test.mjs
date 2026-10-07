/**
 * 0038 · fn_importar_productos: la carga masiva en lotes, en la base.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const fila = (extra) => ({
  nombre: 'Producto', descripcion: null, sku: null, codigo_barras: null, categoria: null,
  precio_venta: 1000, costo: 0, unidad: 'unidad', stock_inicial: 0, stock_minimo: 0, perecible: false, dias_alerta: 30,
  ...extra,
});

async function galletaCargadaAMano(L) {
  const cat = (await banco.su.query(`insert into categories (tenant_id, name) values ($1, 'Galletas') returning id`, [L.tenant])).rows[0].id;
  const id = await L.producto({ nombre: 'Galleta bon o bon blanco 95g', precio: 1450, costo: 908, perecible: true });
  await banco.su.query(`update products set category_id = $2, min_stock = 6 where id = $1`, [id, cat]);
  await banco.su.query(`insert into product_barcodes (tenant_id, product_id, barcode, is_primary) values ($1, $2, '7802225640848', true)`, [L.tenant, id]);
  return { id, cat };
}

test('un producto que ya existía: se actualiza sin pisar lo que la planilla no trae', async () => {
  const L = await nuevoLocal(banco);
  const { id, cat } = await galletaCargadaAMano(L);
  const adm = await banco.como(L.admin);
  const r = await rpc(adm, 'fn_importar_productos', { p_filas: [
    fila({ nombre: 'BON O BON BLANCO COOKIES', sku: '3642197', codigo_barras: '7802225640848', precio_venta: 1450 }),
  ] });
  assert.deepEqual([r.creados, r.actualizados, r.errores.length], [0, 1, 0]);
  const { rows: [p] } = await banco.su.query(
    'select name, sku, avg_cost, category_id, tracks_expiry, min_stock from products where id = $1', [id]);
  assert.equal(p.avg_cost, 908, 'el costo no queda en 0');
  assert.equal(p.category_id, cat, 'la categoría no se borra');
  assert.equal(p.tracks_expiry, true, 'sigue siendo perecible');
  assert.equal(Number(p.min_stock), 6);
  assert.equal(p.sku, '3642197', 'queda con el SKU de la planilla: la próxima vez se reconoce por él');
});

test('lo nuevo se crea con su código; reimportar el mismo archivo no duplica', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const filas = [
    fila({ nombre: 'NUTELLA 350 GRS', sku: '3553732', codigo_barras: '80177173', precio_venta: 5990 }),
    fila({ nombre: 'GYOZA POLLO BOLSA', sku: '3835530', precio_venta: 7030 }),
  ];
  const r1 = await rpc(adm, 'fn_importar_productos', { p_filas: filas });
  assert.deepEqual([r1.creados, r1.actualizados], [2, 0]);
  const r2 = await rpc(adm, 'fn_importar_productos', { p_filas: filas });
  assert.deepEqual([r2.creados, r2.actualizados], [0, 2], 'la segunda vez, por SKU, actualiza');
  const { rows: [{ n }] } = await banco.su.query('select count(*)::int as n from products where tenant_id = $1', [L.tenant]);
  assert.equal(n, 2);
  const { rows: [{ c }] } = await banco.su.query(
    `select count(*)::int as c from product_barcodes where tenant_id = $1 and barcode = '80177173'`, [L.tenant]);
  assert.equal(c, 1);
});

test('una fila mala se informa y las demás entran', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const r = await rpc(adm, 'fn_importar_productos', { p_filas: [
    fila({ nombre: 'Bueno 1', sku: 'A1' }),
    fila({ nombre: '   ', sku: 'A2' }),
    fila({ nombre: 'Bueno 2', sku: 'A3' }),
  ] });
  assert.equal(r.creados, 2);
  assert.equal(r.errores.length, 1);
  assert.equal(r.errores[0].indice, 2);
  assert.match(r.errores[0].codigo, /NOMBRE_REQUERIDO/);
});

test('el vendedor no importa, y un lote demasiado grande se rechaza', async () => {
  const L = await nuevoLocal(banco);
  const caj = await banco.como(L.cajero1);
  assert.match((await intentar(rpc(caj, 'fn_importar_productos', { p_filas: [fila({})] }))).error, /SIN_PERMISO/);
  const adm = await banco.como(L.admin);
  const muchas = Array.from({ length: 501 }, (_, i) => fila({ nombre: `P${i}` }));
  assert.match((await intentar(rpc(adm, 'fn_importar_productos', { p_filas: muchas }))).error, /LOTE_INVALIDO/);
});
