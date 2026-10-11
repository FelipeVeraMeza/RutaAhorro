/**
 * 0041 · Pedidos de la tienda online (docs/33).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';

let banco;
let servicio;
before(async () => {
  banco = await levantarBanco();
  // El servidor de la tienda llama con la llave de servicio.
  servicio = new pg.Client(banco.conn);
  await servicio.connect();
  await servicio.query('set role service_role');
});
after(async () => { await servicio?.end().catch(() => {}); await banco?.bajar(); });

const uuid = () => crypto.randomUUID();
const cliente = (celular = '+56912345678') => ({ nombre: 'Ana Pérez', celular, correo: '' });

async function tiendaAbierta(L, extra = {}) {
  await banco.su.query(
    `update tenants set settings = coalesce(settings, '{}'::jsonb) || $2::jsonb where id = $1`,
    [L.tenant, JSON.stringify({ tienda_pedidos: true, ...extra })]);
}
const pedir = (L, lineas, extra = {}) => rpc(servicio, 'fn_crear_pedido_web', {
  p_tenant: L.tenant, p_pedido: { client_uuid: uuid(), cliente: cliente(), lineas, ...extra },
});

test('con los pedidos apagados (por omisión) no se recibe ninguno', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', stock: 10 });
  assert.match((await intentar(pedir(L, [{ product_id: pan, cantidad: 1 }]))).error, /PEDIDOS_WEB_APAGADOS/);
});

test('crea el pedido con número, código y los precios de la base, con su oferta', async () => {
  const L = await nuevoLocal(banco);
  await tiendaAbierta(L);
  const bebida = await L.producto({ nombre: 'Bebida', precio: 1000, stock: 20 });
  await banco.su.query(`insert into product_price_tiers (tenant_id, product_id, desde, precio) values ($1, $2, 3, 800)`, [L.tenant, bebida]);
  const r = await pedir(L, [{ product_id: bebida, cantidad: 3 }], { nota: 'Sin bolsa' });
  assert.equal(r.numero, 1);
  assert.match(r.codigo, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(r.total, 2400, 'el navegador no decide el precio: 3 × $800 de la oferta');
  assert.equal(r.ahorro, 600);
  const r2 = await pedir(L, [{ product_id: bebida, cantidad: 1 }]);
  assert.equal(r2.numero, 2);
  assert.notEqual(r2.codigo, r.codigo);
  const { rows: [h] } = await banco.su.query(`select count(*)::int n from pedido_web_historial where pedido_id = $1`, [r.id]);
  assert.equal(h.n, 1);
});

test('el mismo pedido mandado dos veces queda uno solo', async () => {
  const L = await nuevoLocal(banco);
  await tiendaAbierta(L);
  const pan = await L.producto({ nombre: 'Pan', stock: 10 });
  const pedido = { client_uuid: uuid(), cliente: cliente(), lineas: [{ product_id: pan, cantidad: 2 }] };
  const a = await rpc(servicio, 'fn_crear_pedido_web', { p_tenant: L.tenant, p_pedido: pedido });
  const b = await rpc(servicio, 'fn_crear_pedido_web', { p_tenant: L.tenant, p_pedido: pedido });
  assert.equal(b.repetido, true);
  assert.equal(b.numero, a.numero);
  const { rows: [c] } = await banco.su.query(`select count(*)::int n from pedidos_web where tenant_id = $1`, [L.tenant]);
  assert.equal(c.n, 1);
});

test('rechaza lo que no se puede pedir', async () => {
  const L = await nuevoLocal(banco);
  const otro = await nuevoLocal(banco, 'Otro');
  // Los locales nacen vendiendo sin stock (0017); este no.
  await tiendaAbierta(L, { vender_sin_stock: false });
  const pan = await L.producto({ nombre: 'Pan', stock: 10 });
  const agotado = await L.producto({ nombre: 'Agotado', stock: 0 });
  const sinPrecio = await L.producto({ nombre: 'Sin precio', precio: 0, stock: 5 });
  const oculto = await L.producto({ nombre: 'Oculto', stock: 5 });
  await banco.su.query(`update products set publicado_tienda = false where id = $1`, [oculto]);
  const inactivo = await L.producto({ nombre: 'Inactivo', stock: 5 });
  await banco.su.query(`update products set is_active = false where id = $1`, [inactivo]);
  const ajeno = await otro.producto({ nombre: 'Ajeno', stock: 5 });

  const error = async (lineas, extra) => (await intentar(pedir(L, lineas, extra))).error ?? 'ACEPTADO';
  assert.match(await error([{ product_id: agotado, cantidad: 1 }]), /PRODUCTO_AGOTADO: Agotado/);
  assert.match(await error([{ product_id: sinPrecio, cantidad: 1 }]), /PRODUCTO_SIN_PRECIO/);
  assert.match(await error([{ product_id: oculto, cantidad: 1 }]), /PRODUCTO_NO_DISPONIBLE/);
  assert.match(await error([{ product_id: inactivo, cantidad: 1 }]), /PRODUCTO_NO_DISPONIBLE/);
  assert.match(await error([{ product_id: ajeno, cantidad: 1 }]), /PRODUCTO_NO_DISPONIBLE/);
  assert.match(await error([{ product_id: pan, cantidad: 100 }]), /CANTIDAD_INVALIDA/);
  assert.match(await error([{ product_id: pan, cantidad: 1.5 }]), /PEDIDO_INVALIDO/);
  assert.match(await error([{ product_id: pan, cantidad: 1 }, { product_id: pan, cantidad: 1 }]), /PRODUCTO_REPETIDO/);
  assert.match(await error([]), /PEDIDO_SIN_PRODUCTOS/);
  assert.match(await error([{ product_id: pan, cantidad: 1 }], { cliente: cliente('22345678') }), /CELULAR_INVALIDO/);
  assert.match(await error([{ product_id: pan, cantidad: 1 }], { nota: 'x'.repeat(301) }), /NOTA_LARGA/);
  const { rows: [c] } = await banco.su.query(`select count(*)::int n from pedidos_web where tenant_id = $1`, [L.tenant]);
  assert.equal(c.n, 0, 'un pedido rechazado no deja nada a medias');

  // Con "vender sin stock" el agotado se puede pedir, igual que en la caja.
  await tiendaAbierta(L, { vender_sin_stock: true });
  assert.equal((await pedir(L, [{ product_id: agotado, cantidad: 1 }])).numero, 1);
});

test('pedido mínimo y tope de pedidos abiertos por celular', async () => {
  const L = await nuevoLocal(banco);
  await tiendaAbierta(L, { tienda_pedido_minimo: 3000 });
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 50 });
  assert.match((await intentar(pedir(L, [{ product_id: pan, cantidad: 2 }]))).error, /PEDIDO_BAJO_MINIMO: 3000/);
  for (let i = 0; i < 3; i++) await pedir(L, [{ product_id: pan, cantidad: 3 }]);
  assert.match((await intentar(pedir(L, [{ product_id: pan, cantidad: 3 }]))).error, /DEMASIADOS_PEDIDOS_ABIERTOS/);
});

test('nadie sin la llave de servicio crea pedidos ni lee seguimientos', async () => {
  const L = await nuevoLocal(banco);
  await tiendaAbierta(L);
  const pan = await L.producto({ nombre: 'Pan', stock: 10 });
  const args = { p_tenant: L.tenant, p_pedido: { client_uuid: uuid(), cliente: cliente(), lineas: [{ product_id: pan, cantidad: 1 }] } };
  for (const quien of [null, L.admin]) {
    const c = await banco.como(quien);
    assert.match((await intentar(rpc(c, 'fn_crear_pedido_web', args))).error, /permission denied/);
    assert.match((await intentar(rpc(c, 'fn_seguimiento_pedido_web', { p_tenant: L.tenant, p_codigo: 'ABCDEFGH' }))).error, /permission denied/);
    assert.match((await intentar(rpc(c, 'fn_anonimizar_pedidos_web', { p_meses: 1 }))).error, /permission denied/);
  }
  const anon = await banco.como(null);
  assert.match((await intentar(anon.query('insert into pedidos_web (tenant_id) values ($1)', [L.tenant]))).error, /permission denied/);
});

test('el personal mueve el pedido por sus estados; bodega y otros locales no', async () => {
  const L = await nuevoLocal(banco);
  const otro = await nuevoLocal(banco, 'Otro');
  await tiendaAbierta(L);
  const pan = await L.producto({ nombre: 'Pan', stock: 10 });
  const p = await pedir(L, [{ product_id: pan, cantidad: 1 }]);
  const caj = await banco.como(L.cajero1);
  const cambiar = (c, estado, motivo) => intentar(rpc(c, 'fn_cambiar_estado_pedido_web', { p_id: p.id, p_estado: estado, p_motivo: motivo ?? null }));

  assert.match((await cambiar(await banco.como(L.bodega), 'preparando')).error, /SIN_PERMISO/);
  assert.match((await cambiar(await banco.como(otro.admin), 'preparando')).error, /PEDIDO_NO_ENCONTRADO/);
  assert.match((await cambiar(caj, 'entregado')).error, /CAMBIO_DE_ESTADO_INVALIDO/, 'no se entrega sin estar listo');
  assert.match((await cambiar(caj, 'volando')).error, /ESTADO_INVALIDO/);
  assert.equal((await cambiar(caj, 'preparando')).ok, true);
  assert.equal((await cambiar(caj, 'listo')).ok, true);
  assert.match((await cambiar(caj, 'cancelado')).error, /MOTIVO_REQUERIDO/);
  assert.equal((await cambiar(caj, 'entregado')).ok, true);
  assert.match((await cambiar(caj, 'cancelado', 'tarde')).error, /CAMBIO_DE_ESTADO_INVALIDO/, 'entregado es final');

  const { rows } = await banco.su.query(`select estado::text from pedido_web_historial where pedido_id = $1 order by id`, [p.id]);
  assert.deepEqual(rows.map((r) => r.estado), ['recibido', 'preparando', 'listo', 'entregado']);
  const { rows: [a] } = await banco.su.query(`select count(*)::int n from audit_log where entity_id = $1 and action = 'pedido_web_estado'`, [p.id]);
  assert.equal(a.n, 3);

  // RLS: el vendedor lee los del local; bodega y el otro local, ninguno.
  assert.equal((await caj.query('select id from pedidos_web')).rows.length, 1);
  assert.equal((await (await banco.como(L.bodega)).query('select id from pedidos_web')).rows.length, 0);
  assert.equal((await (await banco.como(otro.admin)).query('select id from pedidos_web')).rows.length, 0);
  assert.match((await intentar(caj.query(`update pedidos_web set total = 1 where id = $1`, [p.id]))).error, /permission denied/);
});

test('el seguimiento muestra el pedido sin el celular, y solo del local de la tienda', async () => {
  const L = await nuevoLocal(banco);
  const otro = await nuevoLocal(banco, 'Otro');
  await tiendaAbierta(L);
  const pan = await L.producto({ nombre: 'Pan', precio: 500, stock: 10 });
  const p = await pedir(L, [{ product_id: pan, cantidad: 4 }]);
  const s = await rpc(servicio, 'fn_seguimiento_pedido_web', { p_tenant: L.tenant, p_codigo: p.codigo.toLowerCase() });
  assert.equal(s.numero, p.numero);
  assert.equal(s.estado, 'recibido');
  assert.equal(s.nombre, 'Ana');
  assert.equal(s.items[0].subtotal, 2000);
  assert.equal(JSON.stringify(s).includes('912345678'), false, 'el enlace no expone el celular');
  assert.equal(await rpc(servicio, 'fn_seguimiento_pedido_web', { p_tenant: otro.tenant, p_codigo: p.codigo }), null);
  const estados = await rpc(servicio, 'fn_estado_pedidos_web', { p_tenant: L.tenant, p_codigos: `{${p.codigo},ZZZZZZZZ}` });
  assert.deepEqual(estados.map((e) => e.codigo), [p.codigo]);
});

test('ocultar un producto de la tienda; la configuración de la tienda; anonimizar lo viejo', async () => {
  const L = await nuevoLocal(banco);
  await tiendaAbierta(L);
  const pan = await L.producto({ nombre: 'Pan', stock: 10 });
  assert.match((await intentar(rpc(await banco.como(L.cajero1), 'fn_publicar_en_tienda', { p_ids: `{${pan}}`, p_publicado: false }))).error, /SIN_PERMISO/);
  assert.equal(await rpc(await banco.como(L.bodega), 'fn_publicar_en_tienda', { p_ids: `{${pan}}`, p_publicado: false }), 1);
  assert.match((await intentar(pedir(L, [{ product_id: pan, cantidad: 1 }]))).error, /PRODUCTO_NO_DISPONIBLE/);

  const adm = await banco.como(L.admin);
  const s = await rpc(adm, 'fn_guardar_configuracion', { p_cambios: {
    tienda_pedidos: true, tienda_pedido_minimo: 0, tienda_mensaje: '  Cerrado el 18  ', tienda_whatsapp: '+56 9 1234 5678',
    tienda_horario: { lun: '09:00-21:00', dom: '' },
  } });
  assert.equal(s.tienda_mensaje, 'Cerrado el 18');
  assert.equal(s.tienda_horario.lun, '09:00-21:00');
  for (const malo of [{ tienda_horario: { feriado: '9-14' } }, { tienda_whatsapp: 'llámame' }, { tienda_pedido_minimo: -1 }, { tienda_pedidos: 'si' }]) {
    assert.match((await intentar(rpc(adm, 'fn_guardar_configuracion', { p_cambios: malo }))).error, /CONFIGURACION_INVALIDA/);
  }

  await rpc(await banco.como(L.bodega), 'fn_publicar_en_tienda', { p_ids: `{${pan}}`, p_publicado: true });
  const p = await pedir(L, [{ product_id: pan, cantidad: 1 }]);
  await banco.su.query(`update pedidos_web set estado = 'entregado', updated_at = now() - interval '13 months' where id = $1`, [p.id]);
  assert.equal(await rpc(servicio, 'fn_anonimizar_pedidos_web', { p_meses: 12 }), 1);
  const { rows: [a] } = await banco.su.query(`select cliente_celular, cliente_nombre, total from pedidos_web where id = $1`, [p.id]);
  assert.deepEqual(a, { cliente_celular: 'anonimizado', cliente_nombre: 'Cliente', total: p.total });
  assert.match((await intentar(rpc(servicio, 'fn_anonimizar_pedidos_web', { p_meses: 0 }))).error, /PLAZO_INVALIDO/);
});
