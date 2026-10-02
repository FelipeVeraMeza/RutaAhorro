/**
 * 0036 · Descuento autorizado en el mostrador (RQ-15, RQ-17).
 *
 * El vendedor tiene tope 0 %: un descuento solo pasa si John o María José lo
 * autorizan con su PIN, una vez, para ese vendedor y hasta su propio tope.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

/** Venta de una línea con un descuento en pesos. */
function venta(producto, cantidad, precio, descuento, autorizacion) {
  const total = cantidad * precio - descuento;
  return {
    p_client_uuid: crypto.randomUUID(),
    p_items: [{ product_id: producto, quantity: cantidad, unit_price: precio, discount_amount: descuento }],
    p_payments: [{ method: 'efectivo', amount: total }],
    ...(autorizacion ? { p_document: { autorizacion } } : {}),
  };
}

async function mostrador() {
  const L = await nuevoLocal(banco);
  const p = await L.producto({ nombre: 'Aceite', precio: 2000, stock: 100 });
  const adm = await banco.como(L.admin);
  const sup = await banco.como(L.supervisor);
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  await rpc(adm, 'fn_guardar_pin', { p_pin: '4821' });
  await rpc(sup, 'fn_guardar_pin', { p_pin: '1357' });
  return { L, p, adm, sup, caj };
}

test('sin autorización el vendedor no descuenta; con el PIN de John, sí, una sola vez', async () => {
  const { L, p, caj } = await mostrador();
  const sin = await intentar(rpc(caj, 'fn_register_sale', venta(p, 1, 2000, 200)));
  assert.match(sin.error ?? '', /DESCUENTO_EXCEDE_LIMITE/);

  const aut = await rpc(caj, 'fn_autorizar_descuento', { p_autorizador: L.admin.id, p_pin: '4821', p_pct: 10, p_motivo: 'Cliente frecuente' });
  assert.ok(aut, 'el PIN correcto devuelve la autorización');
  const r = await rpc(caj, 'fn_register_sale', venta(p, 1, 2000, 200, aut));
  assert.equal(r.total, 1800);
  const { rows: [s] } = await banco.su.query('select descuento_autorizado_por from sales where id = $1', [r.sale_id]);
  assert.ok(s.descuento_autorizado_por, 'la venta guarda quién autorizó');

  const otra = await intentar(rpc(caj, 'fn_register_sale', venta(p, 1, 2000, 200, aut)));
  assert.match(otra.error ?? '', /AUTORIZACION_INVALIDA/, 'la misma autorización no sirve dos veces');
});

test('la autorización llega hasta lo autorizado, y hasta el tope de quien autoriza', async () => {
  const { L, p, caj } = await mostrador();
  const sup = L.supervisor.id;
  const aut = await rpc(caj, 'fn_autorizar_descuento', { p_autorizador: sup, p_pin: '1357', p_pct: 5 });
  const mas = await intentar(rpc(caj, 'fn_register_sale', venta(p, 1, 2000, 200, aut)));
  assert.match(mas.error ?? '', /DESCUENTO_EXCEDE_LIMITE/, '10 % con una autorización de 5 %');
  // El supervisor tiene tope 10 %: no puede autorizar 50.
  const tope = await intentar(rpc(caj, 'fn_autorizar_descuento', { p_autorizador: sup, p_pin: '1357', p_pct: 50 }));
  assert.match(tope.error ?? '', /AUTORIZACION_EXCEDE_TOPE/);
});

test('un PIN malo no autoriza y queda anotado; cinco seguidos bloquean al autorizador', async () => {
  const { L, caj } = await mostrador();
  const adm = L.admin.id;
  for (let i = 0; i < 5; i++) {
    const r = await rpc(caj, 'fn_autorizar_descuento', { p_autorizador: adm, p_pin: '0000', p_pct: 10 });
    assert.equal(r, null, `el intento ${i + 1} con PIN malo no autoriza`);
  }
  const { rows: [n] } = await banco.su.query('select count(*)::int as n from intentos_pin where autorizador = $1 and not correcto', [adm]);
  assert.equal(n.n, 5, 'los intentos fallidos quedan registrados');
  const bloqueado = await intentar(rpc(caj, 'fn_autorizar_descuento', { p_autorizador: adm, p_pin: '4821', p_pct: 10 }));
  assert.match(bloqueado.error ?? '', /PIN_BLOQUEADO/, 'ni con el PIN correcto, mientras está bloqueado');
});

test('la autorización es de ese vendedor: a otro no le sirve; y vence', async () => {
  const { L, p, caj } = await mostrador();
  const aut = await rpc(caj, 'fn_autorizar_descuento', { p_autorizador: L.admin.id, p_pin: '4821', p_pct: 10 });
  const caj2 = await banco.como(L.cajero2);
  await rpc(caj2, 'fn_open_cash_session', { p_opening_amount: 0 });
  const ajena = await intentar(rpc(caj2, 'fn_register_sale', venta(p, 1, 2000, 200, aut)));
  assert.match(ajena.error ?? '', /AUTORIZACION_INVALIDA/);

  await banco.su.query(`update autorizaciones_descuento set expira_en = now() - interval '1 minute' where id = $1`, [aut]);
  const vencida = await intentar(rpc(caj, 'fn_register_sale', venta(p, 1, 2000, 200, aut)));
  assert.match(vencida.error ?? '', /AUTORIZACION_INVALIDA/);
});

test('solo admin y supervisor guardan PIN; el PIN no se puede leer; un vendedor no es autorizador', async () => {
  const { L, caj } = await mostrador();
  const r = await intentar(rpc(caj, 'fn_guardar_pin', { p_pin: '1111' }));
  assert.match(r.error ?? '', /SIN_PERMISO/);
  const malo = await intentar(rpc(await banco.como(L.admin), 'fn_guardar_pin', { p_pin: '12a4' }));
  assert.match(malo.error ?? '', /PIN_INVALIDO/);
  const leer = await intentar((await banco.como(L.admin)).query('select hash from pines_autorizacion'));
  assert.equal(leer.ok, false, 'el administrador leyó los PIN');
  const lista = await rpc(caj, 'fn_autorizadores', {});
  assert.deepEqual(lista.map((x) => x.nombre).sort(), ['admin', 'supervisor'], 'autorizan quienes tienen PIN, no el vendedor');
  const yo = await intentar(rpc(caj, 'fn_autorizar_descuento', { p_autorizador: L.cajero1.id, p_pin: '1111', p_pct: 10 }));
  assert.match(yo.error ?? '', /AUTORIZADOR_INVALIDO/);
});
