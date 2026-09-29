/**
 * 0025 · Un producto recién creado dice quién lo creó (RF-M10-11).
 *
 * Encontrado por `tools/ui/flujo-completo.mjs`: al abrir un producto recién
 * creado, el formulario decía "Última modificación: sin registro". 0020 anota
 * `updated_by` en el disparador de UPDATE, y el alta es un INSERT: hasta que
 * alguien lo editaba, el producto no tenía autor.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const alta = (nombre) => ({
  p_name: nombre, p_sku: null, p_description: null, p_category_id: null, p_unit: 'unidad',
  p_sale_price: 1000, p_avg_cost: 500, p_min_stock: 0, p_tracks_expiry: false,
  p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0,
});
const autor = async (id) => (await banco.su.query(`select updated_by from products where id = $1`, [id])).rows[0].updated_by;

test('el producto recién creado queda a nombre de quien lo creó', async () => {
  const L = await nuevoLocal(banco);
  const r = await rpc(await banco.como(L.admin), 'fn_create_product', alta('Arroz'));
  assert.equal(await autor(r.product_id), L.admin.id);
});

test('también si lo crea bodega, no solo el administrador', async () => {
  const L = await nuevoLocal(banco);
  const r = await rpc(await banco.como(L.bodega), 'fn_create_product', alta('Azúcar'));
  assert.equal(await autor(r.product_id), L.bodega.id);
});

test('después, quien lo edita pasa a ser el último en modificarlo (0020 sigue igual)', async () => {
  const L = await nuevoLocal(banco);
  const r = await rpc(await banco.como(L.admin), 'fn_create_product', alta('Fideos'));
  const { rows: [x] } = await banco.su.query(`select * from products where id = $1`, [r.product_id]);
  await rpc(await banco.como(L.supervisor), 'fn_update_product', {
    p_product_id: x.id, p_name: x.name, p_sku: x.sku, p_description: x.description, p_category_id: x.category_id,
    p_unit: x.unit, p_sale_price: 1100, p_avg_cost: x.avg_cost, p_min_stock: x.min_stock,
    p_tracks_expiry: x.tracks_expiry, p_expiry_alert_days: x.expiry_alert_days, p_barcodes: null,
  });
  assert.equal(await autor(r.product_id), L.supervisor.id);
});

test('sin sesión (una carga desde el servidor) no inventa un autor', async () => {
  const L = await nuevoLocal(banco);
  const { rows: [p] } = await banco.su.query(
    `insert into products (tenant_id, name, sale_price) values ($1, 'Sal', 500) returning id`, [L.tenant]);
  assert.equal(await autor(p.id), null);
});

// La lista de Productos de quien no ve costos (vendedor, bodega) lee la vista
// `products_public`, y desde b62fd32 pide el autor por la relación
// products_updated_by_fkey. Sin la columna en la vista, la API responde 400 y
// la lista no carga: lo destaparon ofertas.mjs, ofertas-masivas.mjs y
// clientes.mjs, que eligen productos sin costos.
test('la vista sin costos expone quién lo modificó, y nada de costos', async () => {
  const L = await nuevoLocal(banco);
  const r = await rpc(await banco.como(L.admin), 'fn_create_product', alta('Té'));
  const vend = await banco.como(L.cajero1);
  const { rows: [fila] } = await vend.query(`select * from products_public where id = $1`, [r.product_id]);
  assert.equal(fila.updated_by, L.admin.id);
  assert.ok(!('avg_cost' in fila) && !('last_cost' in fila), 'la vista no puede traer costos');
});
