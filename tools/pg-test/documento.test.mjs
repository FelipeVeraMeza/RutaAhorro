/**
 * Boleta, factura y voucher (0015).
 *
 * La regla la pidió el cliente el 2026-09-19 y la aplica la base, no la
 * pantalla: esconder un botón no es seguridad (regla 6), y una venta puede
 * llegar desde la cola sin conexión sin pasar por la pantalla de cobro.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarBanco, nuevoLocal, rpc, intentar, venta } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const RUT_OK = '76.086.428-5';
const RUT_MAL = '76.086.428-4';

/** Un local con caja abierta y un producto con stock, listo para vender. */
async function mostrador(opciones = {}) {
  const L = await nuevoLocal(banco);
  const p = await L.producto();
  const adm = await banco.como(L.admin);
  await rpc(adm, 'fn_adjust_stock', {
    p_product_id: p, p_new_quantity: 50,
    p_movement_type: 'inventario_inicial', p_reason: 'carga', p_ubicacion: 'sala',
  });
  if (opciones.tarjetaEmiteDocumento === false) {
    await banco.su.query(
      `update tenants set settings = settings || '{"tarjeta_emite_documento": false}'::jsonb where id = $1`,
      [L.tenant]);
  }
  const caj = await banco.como(L.cajero1);
  await rpc(caj, 'fn_open_cash_session', { p_opening_amount: 0 });
  return { L, p, caj, adm };
}

async function documentoDe(saleId) {
  const { rows: [r] } = await banco.su.query(
    `select document_type::text as tipo, receptor_rut, receptor_razon_social,
            receptor_giro, receptor_direccion
       from sales where id = $1`, [saleId]);
  return r;
}

// ---------------------------------------------------------------------------
// El RUT, calculado en la base
// ---------------------------------------------------------------------------
test('fn_rut_formateado valida el dígito verificador y devuelve el RUT con puntos', async () => {
  const casos = [
    ['760864285', RUT_OK],
    ['76.086.428-5', RUT_OK],
    ['76086428-5', RUT_OK],
    [' 76.086.428-k ', null],      // dígito equivocado
    [RUT_MAL, null],
    ['1-9', null],                 // más corto que cualquier RUT real
    ['', null],
    [null, null],
    ['abc', null],
  ];
  for (const [entrada, esperado] of casos) {
    const { rows: [r] } = await banco.su.query('select fn_rut_formateado($1) as rut', [entrada]);
    assert.equal(r.rut, esperado, `fn_rut_formateado(${JSON.stringify(entrada)})`);
  }
});

test('un RUT con K de dígito verificador se acepta y se formatea', async () => {
  // El caso que más se escribe mal a mano: cuando el módulo 11 da 10, el
  // dígito es K y no un número.
  const { rows: [r] } = await banco.su.query(`select fn_rut_formateado('12000008k') as rut`);
  assert.equal(r.rut, '12.000.008-K');
});

// ---------------------------------------------------------------------------
// Qué documento corresponde
// ---------------------------------------------------------------------------
test('efectivo y transferencia quedan con boleta', async () => {
  const { p, caj } = await mostrador();
  for (const metodo of ['efectivo', 'transferencia']) {
    const { sale_id, document_type } = await rpc(caj, 'fn_register_sale', venta(p, 1, 1000, { metodo }));
    assert.equal(document_type, 'boleta');
    assert.equal((await documentoDe(sale_id)).tipo, 'boleta');
  }
});

test('con tarjeta el documento lo emite la máquina', async () => {
  const { p, caj } = await mostrador();
  for (const metodo of ['debito', 'credito']) {
    const { sale_id } = await rpc(caj, 'fn_register_sale', venta(p, 1, 1000, { metodo }));
    assert.equal((await documentoDe(sale_id)).tipo, 'voucher');
  }
});

test('no se puede emitir boleta por una venta con tarjeta', async () => {
  const { p, caj } = await mostrador();
  const r = await intentar(rpc(caj, 'fn_register_sale',
    venta(p, 1, 1000, { metodo: 'debito', documento: { tipo: 'boleta' } })));
  assert.match(r.error ?? '', /DOCUMENTO_LO_EMITE_LA_MAQUINA/);
});

test('no se puede emitir voucher por una venta sin tarjeta', async () => {
  const { p, caj } = await mostrador();
  const r = await intentar(rpc(caj, 'fn_register_sale',
    venta(p, 1, 1000, { documento: { tipo: 'voucher' } })));
  assert.match(r.error ?? '', /VOUCHER_SIN_TARJETA/);
});

test('un local con máquina no integrada sí emite boleta con tarjeta', async () => {
  const { p, caj } = await mostrador({ tarjetaEmiteDocumento: false });
  const { sale_id } = await rpc(caj, 'fn_register_sale', venta(p, 1, 1000, { metodo: 'debito' }));
  assert.equal((await documentoDe(sale_id)).tipo, 'boleta');
});

// ---------------------------------------------------------------------------
// Factura
// ---------------------------------------------------------------------------
test('la factura guarda los datos del receptor con el RUT formateado', async () => {
  const { p, caj } = await mostrador();
  const { sale_id } = await rpc(caj, 'fn_register_sale', venta(p, 1, 1000, {
    documento: {
      tipo: 'factura', rut: '760864285', razon_social: '  Comercial Los Andes SpA ',
      giro: 'Comercio', direccion: 'Av. Siempre Viva 742',
    },
  }));
  assert.deepEqual(await documentoDe(sale_id), {
    tipo: 'factura',
    receptor_rut: RUT_OK,
    receptor_razon_social: 'Comercial Los Andes SpA',
    receptor_giro: 'Comercio',
    receptor_direccion: 'Av. Siempre Viva 742',
  });
});

test('la factura se puede hacer también con tarjeta: la máquina no emite facturas', async () => {
  const { p, caj } = await mostrador();
  const { sale_id } = await rpc(caj, 'fn_register_sale', venta(p, 1, 1000, {
    metodo: 'credito',
    documento: { tipo: 'factura', rut: RUT_OK, razon_social: 'Los Andes' },
  }));
  assert.equal((await documentoDe(sale_id)).tipo, 'factura');
});

test('una factura sin razón social o con RUT inválido no se registra', async () => {
  const { p, caj } = await mostrador();
  const malos = [
    [{ tipo: 'factura', rut: RUT_OK }, /RAZON_SOCIAL_REQUERIDA/],
    [{ tipo: 'factura', rut: RUT_OK, razon_social: '   ' }, /RAZON_SOCIAL_REQUERIDA/],
    [{ tipo: 'factura', razon_social: 'Los Andes' }, /RUT_INVALIDO/],
    [{ tipo: 'factura', rut: RUT_MAL, razon_social: 'Los Andes' }, /RUT_INVALIDO/],
  ];
  for (const [documento, esperado] of malos) {
    const r = await intentar(rpc(caj, 'fn_register_sale', venta(p, 1, 1000, { documento })));
    assert.match(r.error ?? '', esperado, JSON.stringify(documento));
  }
});

test('la venta rechazada por el documento no deja stock movido ni folio usado', async () => {
  const { L, p, caj } = await mostrador();
  const antes = await L.stock(p);
  const { rows: [f0] } = await banco.su.query(
    'select last_folio from folio_counters where tenant_id = $1', [L.tenant]);

  await intentar(rpc(caj, 'fn_register_sale',
    venta(p, 3, 1000, { documento: { tipo: 'factura', rut: RUT_MAL, razon_social: 'X' } })));

  assert.equal(await L.stock(p), antes, 'la venta rechazada movió stock');
  const { rows: [f1] } = await banco.su.query(
    'select last_folio from folio_counters where tenant_id = $1', [L.tenant]);
  assert.equal(Number(f1?.last_folio ?? 0), Number(f0?.last_folio ?? 0), 'se gastó un folio');
});

test('el reenvío de una venta devuelve el documento que ya tenía, sin duplicarla', async () => {
  const { p, caj } = await mostrador();
  const args = venta(p, 1, 1000, {
    metodo: 'debito',
    documento: { tipo: 'factura', rut: RUT_OK, razon_social: 'Los Andes' },
  });
  const primera = await rpc(caj, 'fn_register_sale', args);
  const segunda = await rpc(caj, 'fn_register_sale', args);
  assert.equal(segunda.already_existed, true);
  assert.equal(segunda.sale_id, primera.sale_id);
  assert.equal(segunda.document_type, 'factura');
});

// ---------------------------------------------------------------------------
// El invariante del dato, no el de quien lo escribe
// ---------------------------------------------------------------------------
test('nadie puede dejar una factura sin receptor, ni siquiera saltándose la función', async () => {
  const { L, p, caj } = await mostrador();
  const { sale_id } = await rpc(caj, 'fn_register_sale', venta(p, 1, 1000));
  const r = await intentar(banco.su.query(
    `update sales set document_type = 'factura' where id = $1`, [sale_id]));
  assert.match(r.error ?? '', /sales_factura_con_receptor|REGISTRO_INMUTABLE/);
  assert.ok(L.tenant);
});
