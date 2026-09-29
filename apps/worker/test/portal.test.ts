/**
 * El robot del SII (`src/sii/portal.ts`) contra un portal simulado local.
 *
 * Hasta ahora el robot solo compilaba: nunca había abierto una página. Esto lo
 * hace recorrer el flujo entero —login, empresa, receptor con la recarga del
 * SII, varias líneas, validar, comparar el total, firmar, folio, PDF, salir—
 * y comprueba las dos garantías que importan: si el total del portal no es el
 * de la base NO firma, y un error después de firmar avisa que la factura puede
 * estar emitida. Qué NO prueba: ver `portal-simulado.ts`.
 *
 * Necesita un Chromium: CHROME_PATH, o el Chrome instalado. Sin ninguno,
 * se salta diciendo por qué.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planFacturaPortal, resumenFactura, montoLinea } from '@rutaahorro/core';
import { emitirEnPortal, ensayarEnPortal, ErrorDespuesDeFirmar, type CredencialesSii } from '../src/sii/portal.js';
import { levantarPortal, type PortalSimulado } from './portal-simulado.js';

const navegador = [
  process.env.CHROME_PATH,
  // Chrome antes que Edge: Edge en Windows no arranca bajo puppeteer ("Code: 0").
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((r) => r && fs.existsSync(r));
const sinNavegador = navegador ? false : 'no hay Chromium: define CHROME_PATH';

const CRED: CredencialesSii = {
  rutUsuario: '12.345.678-5', claveSii: 'clave-sii-qa', claveCertificado: 'clave-cert-qa', rutEmpresa: '76.086.428-5',
};

// Una línea de catálogo y una libre; $22 fuerza el ajuste del IVA (0027).
const LINEAS = [
  { nombre: 'Pan amasado', cantidad: 3, precio: 1000, unidad: 'unidad' },
  { nombre: 'Flete a domicilio', cantidad: 1, precio: 22, descripcion: 'Entrega en Maipú' },
];
function factura() {
  const r = resumenFactura(LINEAS);
  const plan = planFacturaPortal(LINEAS.map((l) => ({ ...l, monto: montoLinea(l) })), r.neto, r.iva, r.total);
  return {
    receptor: { rut: '76.123.456-0', razon_social: 'Comercial Los Aromos SpA', ciudad: 'Santiago', correo: 'compras@aromos.cl' },
    ciudadEmisor: 'Maipú', formaPago: 'credito' as const, plan,
  };
}

const abiertos: PortalSimulado[] = [];
after(async () => { await Promise.all(abiertos.map((p) => p.cerrar())); });
async function portal(o: Parameters<typeof levantarPortal>[0] = {}) {
  const p = await levantarPortal(o);
  abiertos.push(p);
  return p;
}
const opciones = (p: PortalSimulado) => ({ chromePath: navegador as string, portal: { sii: p.url, misii: p.url } });
const emitir = (p: PortalSimulado) => emitirEnPortal(factura(), CRED, opciones(p));
const ensayar = (p: PortalSimulado) => ensayarEnPortal(factura(), CRED, opciones(p));

test('emite una factura de dos líneas: folio, PDF y todo lo escrito en su lugar', { skip: sinNavegador, timeout: 180_000 }, async () => {
  const p = await portal({
    empresas: [{ rut: '77777777-7', nombre: 'OTRA EMPRESA' }, { rut: '76086428-5', nombre: 'EMPRESA QA SPA' }],
    folio: 4567,
  });
  const r = await emitir(p);

  assert.ok(!r.ensayo);
  assert.equal(r.folio, 4567);
  assert.equal(r.razonSocialSii, 'RAZÓN SOCIAL QUE TRAE EL SII', 'guarda lo que el SII puso como receptor');
  assert.ok(r.pdf && String.fromCharCode(...r.pdf.subarray(0, 4)) === '%PDF', 'bajó el PDF');
  assert.deepEqual(p.logins, [{ rut: '12345678-5', clave: 'clave-sii-qa' }]);
  assert.equal(p.empresaElegida, '76086428-5', 'eligió la empresa por RUT, no la primera de la lista');

  assert.equal(p.firmas.length, 1);
  const { campos, lineas } = p.firmas[0];
  assert.equal(campos.EFXP_RUT_RECEP, '76123456');
  assert.equal(campos.EFXP_DV_RECEP, '0');
  assert.equal(campos.EFXP_CIUDAD_ORIGEN, 'Maipú');
  assert.equal(campos.EFXP_CONTACTO, 'compras@aromos.cl');
  assert.equal(campos.EFXP_FMA_PAGO, '2', 'crédito');
  assert.equal(campos.myPass, 'clave-cert-qa');
  const plan = factura().plan;
  assert.deepEqual(lineas, plan.lineas.map((l) => ({
    nombre: l.nombre, cantidad: l.cantidad, unidad: l.unidad, precio: l.precioNeto, descripcion: l.descripcion ?? '',
  })));
  assert.equal(lineas[1].descripcion, 'Entrega en Maipú');
  // Lo que el portal calculó con esos precios netos es el total de la factura.
  assert.equal(Number(campos.EFXP_MNT_TOTAL.replace(/\D/g, '')), plan.total);
  assert.equal(p.salidas, 1, 'cerró la sesión del SII');
});

test('si el total del portal no es el de la base, NO firma', { skip: sinNavegador, timeout: 180_000 }, async () => {
  const p = await portal({ totalDistinto: true });
  await assert.rejects(emitir(p), (e: Error) => {
    assert.ok(!(e instanceof ErrorDespuesDeFirmar), 'no llegó a firmar');
    assert.match(e.message, /El portal calculó un total de \$\d+ y la factura es de \$\d+\. No se firmó/);
    return true;
  });
  assert.equal(p.firmas.length, 0);
  assert.equal(p.salidas, 1);
});

test('un error después de firmar avisa que la factura puede estar emitida', { skip: sinNavegador, timeout: 180_000 }, async () => {
  const p = await portal({ sinFolio: true });
  await assert.rejects(emitir(p), (e: Error) => {
    assert.ok(e instanceof ErrorDespuesDeFirmar);
    assert.match(e.message, /no se leyó el folio/);
    assert.match(e.message, /puede estar emitida/);
    return true;
  });
  assert.equal(p.firmas.length, 1);
});

test('si la cuenta no puede emitir por esa empresa, se detiene antes de escribir nada', { skip: sinNavegador, timeout: 180_000 }, async () => {
  const p = await portal({ empresas: [{ rut: '77777777-7', nombre: 'OTRA EMPRESA' }, { rut: '99999999-9', nombre: 'TERCERA' }] });
  await assert.rejects(emitir(p), /no aparece entre las que puede emitir.*OTRA EMPRESA/);
  assert.equal(p.firmas.length, 0);
});

// El ensayo es lo que se corre el día que lleguen las credenciales: todo el
// recorrido en el portal real, sin apretar "Firmar". Confirma los supuestos
// (segunda línea, campos de totales) sin emitir nada.
test('ensayo: recorre todo, compara el total y NO firma', { skip: sinNavegador, timeout: 180_000 }, async () => {
  const p = await portal();
  const r = await ensayar(p);
  assert.ok(r.ensayo);
  assert.equal(r.totalPortal, factura().plan.total);
  assert.equal(r.lineas, 2);
  assert.equal(r.razonSocialSii, 'RAZÓN SOCIAL QUE TRAE EL SII');
  assert.equal(p.firmas.length, 0, 'no se apretó Firmar');
  assert.equal(p.salidas, 1, 'cerró la sesión');
});

test('si el SII no reconoce el RUT del receptor, no firma', { skip: sinNavegador, timeout: 180_000 }, async () => {
  const p = await portal({ rutDesconocido: true });
  await assert.rejects(emitir(p), (e: Error) => {
    assert.ok(!(e instanceof ErrorDespuesDeFirmar));
    assert.match(e.message, /El SII no reconoció el RUT del receptor 76\.123\.456-0/);
    return true;
  });
  assert.equal(p.firmas.length, 0);
});
