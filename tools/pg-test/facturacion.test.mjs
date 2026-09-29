/**
 * 0026 · Facturación: factura manual, notas de crédito, facturas recibidas,
 * resumen mensual y la cola del robot del portal del SII.
 *
 * Decisiones de Felipe (2026-09-28): una línea de catálogo descuenta stock y
 * una línea libre no; la emisión real va por el robot del portal (apagado).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const RECEPTOR = {
  rut: '76.086.428-5', razon_social: 'Comercial Los Aromos SpA', giro: 'Venta de abarrotes',
  direccion: 'Av. Siempre Viva 742', comuna: 'Maipú', ciudad: 'Santiago', correo: 'compras@aromos.cl',
};
const factura = (lineas, extra = {}) => ({
  p_datos: { client_uuid: crypto.randomUUID(), receptor: RECEPTOR, forma_pago: 'credito', lineas, ...extra },
});
const kardex = async (producto) => (await banco.su.query(
  `select movement_type::text as type, quantity::float as q, reference_type from inventory_movements
    where product_id = $1 order by created_at, id`, [producto])).rows;
async function servicio() {
  const c = new pg.Client(banco.conn);
  await c.connect();
  await c.query('set role service_role');
  return c;
}

test('factura simulada: la línea de catálogo descuenta stock, la libre no', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 10 });
  const adm = await banco.como(L.admin);
  const f = await rpc(adm, 'fn_emitir_factura_manual', factura([
    { product_id: pan, cantidad: 3, precio: 1000 },
    { nombre: 'Flete a domicilio', cantidad: 1, precio: 11900 },
  ]));
  assert.equal(f.estado, 'emitida');
  assert.equal(f.modo, 'simulacion');
  assert.equal(f.total, 14900);
  assert.equal(f.neto + f.iva, f.total);
  assert.equal(f.iva, 14900 - Math.round(14900 / 1.19));
  assert.equal(f.dte.tipo, 33);
  assert.ok(f.folio > 0);
  assert.equal(f.dte.receptor.rut, '76.086.428-5');
  assert.equal(await L.stock(pan), 7, 'el pan no bajó');
  const k = await kardex(pan);
  assert.deepEqual(k.at(-1), { type: 'venta', q: -3, reference_type: 'factura' });
  // Lo de catálogo toma el nombre del producto; lo libre, el escrito.
  assert.deepEqual(f.lineas.map((l) => [l.nombre, l.product_id !== null]), [['Pan', true], ['Flete a domicilio', false]]);
  // RQ-20: el receptor queda como cliente, con sus datos.
  const { rows: [cli] } = await banco.su.query(`select nombre, giro, comuna, email from clientes where tenant_id = $1 and rut = $2`, [L.tenant, RECEPTOR.rut]);
  assert.deepEqual(cli, { nombre: RECEPTOR.razon_social, giro: RECEPTOR.giro, comuna: 'Maipú', email: RECEPTOR.correo });
});

test('el doble toque no emite dos facturas ni descuenta dos veces', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 10 });
  const adm = await banco.como(L.admin);
  const datos = factura([{ product_id: pan, cantidad: 2, precio: 1000 }]);
  const a = await rpc(adm, 'fn_emitir_factura_manual', datos);
  const b = await rpc(adm, 'fn_emitir_factura_manual', datos);
  assert.equal(b.id, a.id);
  assert.equal(b.ya_existia, true);
  assert.equal(await L.stock(pan), 8);
});

test('solo admin y supervisor facturan', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 10 });
  for (const u of [L.cajero1, L.bodega]) {
    const r = await intentar(rpc(await banco.como(u), 'fn_emitir_factura_manual', factura([{ product_id: pan, cantidad: 1, precio: 1000 }])));
    assert.match(r.error, /SIN_PERMISO_FACTURAR/);
  }
  const sup = await rpc(await banco.como(L.supervisor), 'fn_emitir_factura_manual', factura([{ product_id: pan, cantidad: 1, precio: 1000 }]));
  assert.equal(sup.estado, 'emitida');
});

test('un receptor incompleto no deja nada a medias', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 10 });
  const adm = await banco.como(L.admin);
  for (const [cambio, error] of [[{ rut: '11.111.111-2' }, /RUT_INVALIDO/], [{ giro: ' ' }, /GIRO_RECEPTOR_REQUERIDO/],
    [{ comuna: '' }, /DIRECCION_RECEPTOR_REQUERIDA/], [{ razon_social: '' }, /RAZON_SOCIAL_REQUERIDA/]]) {
    const r = await intentar(rpc(adm, 'fn_emitir_factura_manual',
      factura([{ product_id: pan, cantidad: 1, precio: 1000 }], { receptor: { ...RECEPTOR, ...cambio } })));
    assert.match(r.error, error);
  }
  assert.equal(await L.stock(pan), 10);
  assert.equal((await banco.su.query(`select count(*)::int as n from facturas where tenant_id = $1`, [L.tenant])).rows[0].n, 0);
});

test('lo que se cuenta va entero; lo que se pesa admite decimales', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 10 });
  const queso = await L.producto({ nombre: 'Queso', precio: 9990, stock: 5 });
  await banco.su.query(`update products set unit = 'kg' where id = $1`, [queso]);
  const adm = await banco.como(L.admin);
  const r = await intentar(rpc(adm, 'fn_emitir_factura_manual', factura([{ product_id: pan, cantidad: 1.5, precio: 1000 }])));
  assert.match(r.error, /CANTIDAD_ENTERA: Pan/);
  const f = await rpc(adm, 'fn_emitir_factura_manual', factura([{ product_id: queso, cantidad: 0.35, precio: 9990 }]));
  assert.equal(f.total, 3497);
  assert.equal(await L.stock(queso), 4.65);
});

test('perecible: sale del lote que vence primero, y la nota de crédito lo devuelve ahí', async () => {
  const L = await nuevoLocal(banco);
  const leche = await L.producto({ nombre: 'Leche', precio: 1200, perecible: true, stock: 10 });
  const temprano = await L.lote(leche, 4, '2099-01-10');
  const tarde = await L.lote(leche, 6, '2099-03-10');
  const adm = await banco.como(L.admin);
  const f = await rpc(adm, 'fn_emitir_factura_manual', factura([{ product_id: leche, cantidad: 5, precio: 1200 }]));
  const lote = async (id) => Number((await banco.su.query(`select quantity from product_lots where id = $1`, [id])).rows[0].quantity);
  assert.deepEqual([await lote(temprano), await lote(tarde)], [0, 5], 'FEFO');

  // Devuelve 2: al lote que vence más tarde, pero solo lo que salió de él
  // (1); el otro vuelve al temprano. Un lote no recibe más de lo que dio.
  const n1 = await rpc(adm, 'fn_nota_credito_factura', {
    p_factura: f.id, p_items: [{ linea_id: f.lineas[0].id, cantidad: 2 }], p_motivo: 'Dos venían dañadas' });
  assert.equal(n1.es_total, false);
  assert.equal(n1.monto, 2400);
  assert.equal(n1.nota_credito.tipo, 61);
  assert.equal(n1.nota_credito.referencia.folio, f.folio);
  assert.equal(n1.nota_credito.referencia.codigo, 3, 'corrige montos');
  assert.deepEqual([await lote(temprano), await lote(tarde)], [1, 6]);
  assert.equal(await L.stock(leche), 7);

  // El resto: nota total, y entre las dos suman exactamente la factura.
  const n2 = await rpc(adm, 'fn_nota_credito_factura', { p_factura: f.id, p_items: null, p_motivo: 'Anula el resto' });
  assert.equal(n2.es_total, true);
  assert.equal(n1.monto + n2.monto, f.total);
  assert.deepEqual([await lote(temprano), await lote(tarde)], [4, 6]);
  assert.equal(await L.stock(leche), 10);
  const otra = await intentar(rpc(adm, 'fn_nota_credito_factura', { p_factura: f.id, p_items: null, p_motivo: 'otra vez' }));
  assert.match(otra.error, /NADA_QUE_DEVOLVER/);
});

test('una nota de crédito no devuelve más de lo facturado, y la línea libre no mueve stock', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 10 });
  const adm = await banco.como(L.admin);
  const f = await rpc(adm, 'fn_emitir_factura_manual', factura([
    { product_id: pan, cantidad: 2, precio: 1000 }, { nombre: 'Flete', cantidad: 1, precio: 5000 }]));
  const r = await intentar(rpc(adm, 'fn_nota_credito_factura', {
    p_factura: f.id, p_items: [{ linea_id: f.lineas[0].id, cantidad: 3 }], p_motivo: 'x' }));
  assert.match(r.error, /CANTIDAD_A_DEVOLVER_INVALIDA/);
  await rpc(adm, 'fn_nota_credito_factura', {
    p_factura: f.id, p_items: [{ linea_id: f.lineas[1].id, cantidad: 1 }], p_motivo: 'No se hizo el flete' });
  assert.equal(await L.stock(pan), 8, 'devolver el flete no toca el stock');
  const vend = await intentar(rpc(await banco.como(L.cajero1), 'fn_nota_credito_factura', { p_factura: f.id, p_items: null, p_motivo: 'x' }));
  assert.match(vend.error, /SIN_PERMISO_FACTURAR/);
});

test('una factura emitida no se edita ni se borra', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const f = await rpc(adm, 'fn_emitir_factura_manual', factura([{ nombre: 'Asesoría', cantidad: 1, precio: 50000 }]));
  for (const sql of [`update facturas set total = 1 where id = $1`, `update facturas set receptor = '{}' where id = $1`,
    `delete from facturas where id = $1`, `update factura_lineas set precio = 1 where factura_id = $1`]) {
    const r = await intentar(banco.su.query(sql, [f.id]));
    assert.match(r.error ?? '', /REGISTRO_INMUTABLE/, sql);
  }
  // Y nadie con sesión la escribe directo (regla 14).
  const r = await intentar(adm.query(`update facturas set estado = 'descartada' where id = $1`, [f.id]));
  assert.equal((await banco.su.query(`select estado from facturas where id = $1`, [f.id])).rows[0].estado, 'emitida', r.error);
});

test('un vendedor no ve las facturas', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_emitir_factura_manual', factura([{ nombre: 'Asesoría', cantidad: 1, precio: 50000 }]));
  const vend = await banco.como(L.cajero1);
  for (const t of ['facturas', 'factura_lineas', 'facturas_recibidas', 'factura_notas_credito']) {
    const { rows } = await vend.query(`select count(*)::int as n from ${t}`);
    assert.equal(rows[0].n, 0, t);
  }
});

test('las credenciales del SII no se leen con ninguna sesión, y la cola es solo del worker', async () => {
  const L = await nuevoLocal(banco);
  await banco.su.query(`insert into sii_credenciales (tenant_id, rut_usuario, clave_sii, clave_certificado, rut_empresa)
                        values ($1, '11.111.111-1', 'v1:cifrado', 'v1:cifrado', '76.086.428-5')`, [L.tenant]);
  const adm = await banco.como(L.admin);
  const leer = await intentar(adm.query(`select * from sii_credenciales`));
  assert.ok(!leer.ok || leer.valor.rows.length === 0, 'el administrador leyó las credenciales');
  for (const fn of ['fn_sii_tomar_factura()', `fn_sii_registrar_error('${crypto.randomUUID()}', 'x')`]) {
    const r = await intentar(adm.query(`select ${fn}`));
    assert.match(r.error ?? '', /permission denied/, fn);
  }
  // El estado sí, sin secretos.
  const e = await rpc(adm, 'fn_estado_emision_sii');
  assert.equal(e.credenciales, true);
  assert.equal(e.activa, false);
  assert.ok(!JSON.stringify(e).includes('cifrado'));
});

test('encender la emisión real exige credenciales y emisor, y solo el administrador', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  assert.match((await intentar(rpc(adm, 'fn_activar_emision_sii', { p_activa: true }))).error, /FALTAN_CREDENCIALES_SII/);
  await banco.su.query(`insert into sii_credenciales (tenant_id, rut_usuario, clave_sii, clave_certificado, rut_empresa)
                        values ($1, '11.111.111-1', 'x', 'x', '76.086.428-5')`, [L.tenant]);
  assert.match((await intentar(rpc(adm, 'fn_activar_emision_sii', { p_activa: true }))).error, /EMISOR_SIN_CONFIGURAR/);
  assert.match((await intentar(rpc(await banco.como(L.supervisor), 'fn_activar_emision_sii', { p_activa: true }))).error, /SIN_PERMISO/);
});

test('portal del SII: queda por emitir, el worker la emite con el folio del SII', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1000, stock: 10 });
  const adm = await banco.como(L.admin);
  // Una factura simulada antes: su folio 1 no choca con el folio 1 real.
  const simulada = await rpc(adm, 'fn_emitir_factura_manual', factura([{ nombre: 'Asesoría', cantidad: 1, precio: 1190 }]));
  await rpc(adm, 'fn_guardar_emisor', { p_datos: { rut: '76.086.428-5', razon_social: 'Almacén', giro: 'Almacén', direccion: 'Calle 1', comuna: 'Maipú' } });
  await banco.su.query(`insert into sii_credenciales (tenant_id, rut_usuario, clave_sii, clave_certificado, rut_empresa)
                        values ($1, '11.111.111-1', 'x', 'x', '76.086.428-5')`, [L.tenant]);
  await rpc(adm, 'fn_activar_emision_sii', { p_activa: true });

  const f = await rpc(adm, 'fn_emitir_factura_manual', factura([{ product_id: pan, cantidad: 2, precio: 1000 }]));
  assert.equal(f.modo, 'portal_sii');
  assert.equal(f.estado, 'por_emitir');
  assert.equal(f.folio, null);
  assert.equal(f.dte, null);
  assert.equal(await L.stock(pan), 8, 'el stock se mueve al facturar, no al emitir');
  assert.match((await intentar(rpc(adm, 'fn_nota_credito_factura', { p_factura: f.id, p_items: null, p_motivo: 'x' }))).error,
    /FACTURA_NO_EMITIDA/);

  const w = await servicio();
  const tomada = (await w.query('select fn_sii_tomar_factura() as r')).rows[0].r;
  assert.equal(tomada.id, f.id);
  assert.equal(tomada.estado, 'emitiendo');
  assert.equal(tomada.credenciales.rut_empresa, '76.086.428-5');
  assert.equal(tomada.lineas_sii[0].monto, 2000);
  assert.equal((await w.query('select fn_sii_tomar_factura() as r')).rows[0].r, null, 'no la toma dos veces');

  await w.query(`select fn_sii_registrar_emision($1, $2, 'facturas/1.pdf')`, [f.id, simulada.folio]);
  const { rows: [x] } = await banco.su.query(
    `select f.estado, f.folio, d.ambiente, d.folio as dfolio from facturas f join dte_documentos d on d.id = f.dte_id where f.id = $1`, [f.id]);
  assert.deepEqual(x, { estado: 'emitida', folio: String(simulada.folio), ambiente: 'produccion', dfolio: String(simulada.folio) });
  // Una nota simulada contra un documento real, no.
  assert.match((await intentar(rpc(adm, 'fn_nota_credito_factura', { p_factura: f.id, p_items: null, p_motivo: 'x' }))).error,
    /NOTA_CREDITO_REAL_NO_DISPONIBLE/);
  await w.end();
});

test('portal del SII: el error se reintenta o se descarta devolviendo el stock', async () => {
  const L = await nuevoLocal(banco);
  const leche = await L.producto({ nombre: 'Leche', precio: 1200, perecible: true, stock: 5 });
  const lote = await L.lote(leche, 5, '2099-01-10');
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_guardar_emisor', { p_datos: { rut: '76.086.428-5', razon_social: 'Almacén', giro: 'Almacén', direccion: 'Calle 1', comuna: 'Maipú' } });
  await banco.su.query(`insert into sii_credenciales (tenant_id, rut_usuario, clave_sii, clave_certificado, rut_empresa)
                        values ($1, '11.111.111-1', 'x', 'x', '76.086.428-5')`, [L.tenant]);
  await rpc(adm, 'fn_activar_emision_sii', { p_activa: true });
  const f = await rpc(adm, 'fn_emitir_factura_manual', factura([{ product_id: leche, cantidad: 3, precio: 1200 }]));
  const w = await servicio();
  await w.query('select fn_sii_tomar_factura()');
  await w.query(`select fn_sii_registrar_error($1, 'El SII no abrió el cuadro de la clave')`, [f.id]);
  let est = (await banco.su.query(`select estado, ultimo_error from facturas where id = $1`, [f.id])).rows[0];
  assert.deepEqual(est, { estado: 'error', ultimo_error: 'El SII no abrió el cuadro de la clave' });
  assert.equal((await rpc(adm, 'fn_reintentar_factura', { p_factura: f.id })).estado, 'por_emitir');

  // Colgada 20 minutos "emitiendo": no se reintenta sola.
  await w.query('select fn_sii_tomar_factura()');
  await banco.su.query(`alter table facturas disable trigger trg_facturas_inmutable`);
  await banco.su.query(`update facturas set tomada_en = now() - interval '20 minutes' where id = $1`, [f.id]);
  await banco.su.query(`alter table facturas enable trigger trg_facturas_inmutable`);
  assert.equal((await w.query('select fn_sii_tomar_factura() as r')).rows[0].r, null);
  est = (await banco.su.query(`select estado, ultimo_error from facturas where id = $1`, [f.id])).rows[0];
  assert.equal(est.estado, 'error');
  assert.match(est.ultimo_error, /revisa en el portal del SII/);

  await rpc(adm, 'fn_descartar_factura', { p_factura: f.id, p_motivo: 'Se emitió a mano en el portal' });
  assert.equal(await L.stock(leche), 5);
  assert.equal(Number((await banco.su.query(`select quantity from product_lots where id = $1`, [lote])).rows[0].quantity), 5);
  assert.match((await intentar(rpc(adm, 'fn_descartar_factura', { p_factura: f.id, p_motivo: 'otra' }))).error, /FACTURA_NO_DESCARTABLE/);
  await w.end();
});

test('facturas recibidas: crea el proveedor, autocompleta la vez siguiente y no se duplica', async () => {
  const L = await nuevoLocal(banco);
  const adm = await banco.como(L.admin);
  const datos = { rut_emisor: '76086428-5', razon_social: 'Distribuidora Sur', tipo: 33, folio: 1520,
                  fecha_emision: '2026-09-10', neto: 10000, iva: 1900 };
  const a = await rpc(adm, 'fn_registrar_factura_recibida', { p_datos: datos });
  assert.equal(a.total, 11900);
  assert.equal(a.rut_emisor, '76.086.428-5');
  const { rows: provs } = await banco.su.query(`select id, name, rut from suppliers where tenant_id = $1`, [L.tenant]);
  assert.equal(provs.length, 1);
  assert.equal(a.supplier_id, provs[0].id);
  const b = await rpc(adm, 'fn_registrar_factura_recibida', { p_datos: { ...datos, folio: 1521, rut_emisor: '76.086.428-5' } });
  assert.equal(b.supplier_id, provs[0].id, 'el mismo proveedor, sin crear otro');
  assert.match((await intentar(rpc(adm, 'fn_registrar_factura_recibida', { p_datos: datos }))).error, /FACTURA_RECIBIDA_DUPLICADA/);
  assert.match((await intentar(rpc(adm, 'fn_registrar_factura_recibida', { p_datos: { ...datos, folio: 9, tipo: 34 } }))).error, /EXENTA_CON_IVA/);
  assert.match((await intentar(rpc(adm, 'fn_registrar_factura_recibida', { p_datos: { ...datos, folio: 10, fecha_emision: '2999-01-01' } }))).error, /FECHA_INVALIDA/);
});

test('resumen mensual: ventas (factura, boleta, voucher, notas) y compras', async () => {
  const L = await nuevoLocal(banco);
  const pan = await L.producto({ nombre: 'Pan', precio: 1190, stock: 50 });
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_open_cash_session', { p_opening_amount: 0 });
  await rpc(adm, 'fn_register_sale', venta(pan, 1, 1190));                                  // boleta
  await rpc(adm, 'fn_register_sale', venta(pan, 2, 1190, { metodo: 'debito' }));             // voucher
  const f = await rpc(adm, 'fn_emitir_factura_manual', factura([{ product_id: pan, cantidad: 10, precio: 1190 }]));
  await rpc(adm, 'fn_nota_credito_factura', { p_factura: f.id, p_items: [{ linea_id: f.lineas[0].id, cantidad: 1 }], p_motivo: 'Una menos' });
  const { rows: [v] } = await adm.query(`select * from v_ventas_mensuales`);
  assert.equal(Number(v.boletas), 1);
  assert.equal(Number(v.facturas), 1);
  assert.equal(Number(v.notas_credito), 1);
  assert.equal(Number(v.ventas_voucher), 1);
  assert.equal(Number(v.total), 1190 + 2380 + 11900 - 1190);
  assert.equal(Number(v.neto) + Number(v.iva), Number(v.total));
  assert.equal(v.incluye_simulados, true);

  await rpc(adm, 'fn_registrar_factura_recibida', { p_datos: { rut_emisor: '76086428-5', razon_social: 'Sur', tipo: 33,
    folio: 1, fecha_emision: f.fecha_emision, neto: 10000, iva: 1900 } });
  const nc = await rpc(adm, 'fn_registrar_factura_recibida', { p_datos: { rut_emisor: '76086428-5', razon_social: 'Sur', tipo: 61,
    folio: 2, fecha_emision: f.fecha_emision, neto: 1000, iva: 190 } });
  let { rows: [c] } = await adm.query(`select * from v_compras_mensuales`);
  assert.deepEqual([Number(c.neto), Number(c.iva), Number(c.total)], [9000, 1710, 10710], 'la nota de crédito recibida resta');
  await rpc(adm, 'fn_anular_factura_recibida', { p_id: nc.id, p_motivo: 'Mal ingresada' });
  ({ rows: [c] } = await adm.query(`select * from v_compras_mensuales`));
  assert.equal(Number(c.total), 11900, 'la anulada no cuenta');
});
