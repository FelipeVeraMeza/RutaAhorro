/**
 * Recorrido del MODO DEMO (NEXT_PUBLIC_DEMO=true, `npm run dev`), 2026-09-30.
 *   RA_BASE=http://localhost:3000 node tools/ui/demo-roles.mjs
 * Con Chromium en vez de Edge: CHROME_PATH=/ruta/a/chrome.
 */
// QA en modo demo: todas las rutas, por rol, en 360 y 1280 px.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.RA_BASE ?? 'http://localhost:3000';
const RUTAS = ['/novedades', '/', '/pos', '/caja', '/precio', '/productos', '/productos/etiquetas', '/productos/ofertas',
  '/productos/importar', '/productos/combos', '/inventario', '/proveedores', '/proveedores/recepcion',
  '/ventas', '/clientes', '/facturacion', '/reportes', '/usuarios', '/configuracion'];
const ROLES = (process.env.ROLES ?? 'admin,supervisor,vendedor,bodega').split(',');
const ANCHOS = (process.env.ANCHOS ?? '360,1280').split(',').map(Number);
const SHOTS = process.env.SHOTS;

const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const informe = [];
for (const rol of ROLES) {
  for (const ancho of ANCHOS) {
    const ctx = await nav.newContext({ viewport: { width: ancho, height: 780 } });
    await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
    const p = await ctx.newPage();
    let errores = [];
    p.on('pageerror', (e) => errores.push(`JS: ${e.message.slice(0, 200)}`));
    p.on('console', (m) => { if (m.type() === 'error') errores.push(`consola: ${m.text().slice(0, 200)}`); });
    p.on('response', (r) => { if (r.status() >= 400) errores.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
    for (const ruta of RUTAS) {
      errores = [];
      await p.goto(BASE + ruta, { waitUntil: 'networkidle', timeout: 90000 }).catch((e) => errores.push('goto ' + e.message.slice(0, 100)));
      await p.waitForTimeout(600);
      const final = new URL(p.url()).pathname;
      const medida = await p.evaluate(() => {
        const desborde = document.documentElement.scrollWidth > window.innerWidth + 1;
        const chicos = [...document.querySelectorAll('button, a, input, select')]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 && getComputedStyle(el).visibility !== 'hidden'; })
          .map((el) => `${el.tagName.toLowerCase()}:"${(el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 30)}"(${Math.round(el.getBoundingClientRect().height)})`);
        const h1 = document.querySelector('main h1')?.textContent?.trim() ?? '';
        const alertas = [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent.trim().slice(0, 120));
        return { desborde, chicos: chicos.slice(0, 8), h1, alertas };
      });
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/${rol}-${ancho}-${ruta.replaceAll('/', '_') || 'inicio'}.png`, fullPage: true });
      informe.push({ rol, ancho, ruta, final, ...medida, errores: [...new Set(errores)] });
    }
    await ctx.close();
  }
}
await nav.close();
for (const f of informe) {
  const marcas = [];
  if (f.final !== f.ruta) marcas.push(`→ ${f.final}`);
  if (f.desborde) marcas.push('DESBORDE');
  if (f.errores.length) marcas.push(`ERR ${f.errores.join(' | ')}`);
  if (f.alertas.length) marcas.push(`ALERTA ${f.alertas.join(' | ')}`);
  if (f.chicos.length && f.ancho === 360) marcas.push(`chicos ${f.chicos.join(' ')}`);
  console.log(`${f.rol.padEnd(10)} ${String(f.ancho).padEnd(5)} ${f.ruta.padEnd(24)} h1="${f.h1}" ${marcas.join(' · ')}`);
}
