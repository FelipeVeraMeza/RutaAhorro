/**
 * La sesión permanente del SII (`src/sii/sesion.ts`) contra un SII simulado.
 *
 * El simulado imita el login nuevo de clave.w.sii.cl tal como se vio el
 * 2026-10-11: #inputRut que pone puntos y guión mientras se escribe,
 * #inputPass, #bt_ingresar y los avisos .alert_dni ocultos que aparecen al
 * fallar. Detrás, una página de trabajo (/emitir) que solo se ve con sesión, y
 * la sesión la puede vencer el servidor cuando quiera, como el SII.
 *
 * Lo que importa probar: que vuelve a entrar sola, que con la clave mala NO
 * reintenta (el SII la bloquearía), y que la pestaña se presta de a uno.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SesionSii, type AvisoSesion } from '../src/sii/sesion.js';
import { ErrorClaveSii } from '../src/sii/login.js';

const navegador = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((r) => r && fs.existsSync(r));
const sinNavegador = navegador ? false : 'no hay Chromium: define CHROME_PATH';

const CLAVE = 'clave-buena';

interface SiiSimulado { url: string; logins: Array<{ rut: string; clave: string }>; expirar(): void; cerrar(): Promise<void> }

async function levantarSii(): Promise<SiiSimulado> {
  const validas = new Set<string>();
  const logins: SiiSimulado['logins'] = [];
  const pagina = (t: string, c: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head><body>${c}</body></html>`;
  // El formato que pone el SII: "15620607-5" → "15.620.607-5", en cada tecla.
  const formato = `document.getElementById('inputRut').addEventListener('input', (e) => {
    const l = e.target.value.replace(/[^0-9kK]/g, '');
    e.target.value = l.length < 2 ? l : l.slice(0, -1).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.') + '-' + l.slice(-1);
  });`;

  const servidor = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const sesion = /sesion=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
    const html = (s: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(s); };
    const ir = (a: string, cookie?: string) => {
      res.writeHead(302, { location: a, ...(cookie ? { 'set-cookie': `${cookie}; Path=/` } : {}) });
      res.end();
    };

    if (u.pathname === '/emitir') {
      if (!sesion || !validas.has(sesion)) return ir('/login');
      return html(pagina('Emitir boleta', '<form id="boleta"><input name="monto"></form>'));
    }
    if (u.pathname === '/login' && req.method === 'GET') {
      const error = u.searchParams.get('error');
      return html(pagina('Autenticación', `<form method="POST" action="/login">
        <input id="inputRut" name="rut" type="text">
        <input id="inputPass" name="clave" type="password">
        <span class="alert_dni" style="display:${error ? 'block' : 'none'}">Clave incorrecta</span>
        <span class="alert_dni" style="display:none">RUT no válido</span>
        <button id="bt_ingresar" type="submit">INGRESAR</button>
      </form><script>${formato}</script>`));
    }
    if (u.pathname === '/login' && req.method === 'POST') {
      let s = '';
      for await (const t of req) s += t;
      const b = new URLSearchParams(s);
      logins.push({ rut: b.get('rut') ?? '', clave: b.get('clave') ?? '' });
      if (b.get('clave') !== CLAVE) return ir('/login?error=1');
      const id = `s${logins.length}`;
      validas.add(id);
      // Como el SII: después del login no vuelve a la página de trabajo.
      return ir('/inicio', `sesion=${id}`);
    }
    if (u.pathname === '/inicio') return html(pagina('Mi SII', '<p>Bienvenido</p>'));
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`,
    logins,
    expirar: () => validas.clear(),
    cerrar: () => new Promise<void>((ok) => { servidor.closeAllConnections(); servidor.close(() => ok()); }),
  };
}

const abiertos: Array<{ cerrar(): Promise<void> } | SesionSii> = [];
after(async () => {
  for (const a of abiertos) await (a instanceof SesionSii ? a.detener() : a.cerrar());
});

async function preparar(clave = CLAVE) {
  const sii = await levantarSii();
  const avisos: AvisoSesion[] = [];
  const sesion = new SesionSii({
    chromePath: navegador as string,
    url: `${sii.url}/emitir`,
    rut: '15.620.607-5',
    clave,
    cadaMs: 3_600_000, // en las pruebas se vigila a mano
    estaDentro: async (p) => Boolean(await p.$('#boleta')),
    alAviso: (a) => avisos.push(a),
  });
  abiertos.push(sii, sesion);
  return { sii, sesion, avisos };
}

test('entra con el RUT bien formateado y deja la página de trabajo abierta', { skip: sinNavegador, timeout: 120_000 }, async () => {
  const { sii, sesion, avisos } = await preparar();
  await sesion.iniciar();
  assert.equal(sesion.estado, 'lista');
  assert.deepEqual(sii.logins, [{ rut: '15.620.607-5', clave: CLAVE }], 'el campo que da formato no descuadró el RUT');
  assert.ok(await sesion.usar(async (p) => p.$('#boleta')), 'quedó en /emitir aunque el SII lo mandó a /inicio');
  assert.deepEqual(avisos.map((a) => a.tipo), ['entro']);
});

test('si el SII vence la sesión, la siguiente vuelta vuelve a entrar sola', { skip: sinNavegador, timeout: 120_000 }, async () => {
  const { sii, sesion, avisos } = await preparar();
  await sesion.iniciar();
  await sesion.vigilar();
  assert.equal(sii.logins.length, 1, 'con la sesión viva no vuelve a entrar');

  sii.expirar();
  await sesion.vigilar();
  assert.equal(sesion.estado, 'lista');
  assert.equal(sii.logins.length, 2);
  assert.deepEqual(avisos.map((a) => a.tipo), ['entro', 'reentro']);
  assert.ok(await sesion.usar(async (p) => p.$('#boleta')));
});

test('con la clave mala se detiene y NO vuelve a intentar', { skip: sinNavegador, timeout: 120_000 }, async () => {
  const { sii, sesion, avisos } = await preparar('clave-mala');
  await assert.rejects(sesion.iniciar(), (e: Error) => {
    assert.ok(e instanceof ErrorClaveSii);
    assert.match(e.message, /Clave incorrecta/);
    return true;
  });
  assert.equal(sesion.estado, 'detenida');

  await sesion.vigilar();
  await assert.rejects(sesion.usar(async () => 'no debería correr'), ErrorClaveSii);
  assert.equal(sii.logins.length, 1, 'un solo intento: el SII bloquea la clave si se insiste');
  assert.deepEqual(avisos.map((a) => a.tipo), ['detenida']);

  // Con la clave corregida, reanuda.
  await sesion.reanudar({ rut: '15.620.607-5', clave: CLAVE });
  assert.equal(sesion.estado, 'lista');
  assert.equal(sii.logins.length, 2);
});

test('si Chrome se cae, lo vuelve a abrir y entra', { skip: sinNavegador, timeout: 120_000 }, async () => {
  const { sii, sesion } = await preparar();
  await sesion.iniciar();
  await sesion.usar(async (p) => { await p.browser().close(); });
  assert.ok(await sesion.usar(async (p) => p.$('#boleta')));
  assert.equal(sii.logins.length, 2, 'perfil nuevo, sin cookies: entró de nuevo');
});

test('presta la pestaña de a uno: dos trabajos nunca se pisan', { skip: sinNavegador, timeout: 120_000 }, async () => {
  const { sesion } = await preparar();
  await sesion.iniciar();
  let adentro = 0;
  let maximo = 0;
  const trabajo = async () => {
    adentro++;
    maximo = Math.max(maximo, adentro);
    await new Promise((r) => setTimeout(r, 300));
    adentro--;
  };
  await Promise.all([sesion.usar(trabajo), sesion.usar(trabajo), sesion.usar(trabajo)]);
  assert.equal(maximo, 1);
});
