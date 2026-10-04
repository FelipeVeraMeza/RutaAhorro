/**
 * Barrido de errores: abre todas las pantallas con cada rol y lista los errores
 * de JavaScript y de consola, diciendo en qué pantalla salieron. Sirve para
 * cazar intermitentes como el React #418 (docs/28): no aprueba ni reprueba.
 *   RA_BASE=http://localhost:3000 ROLES=admin,vendedor TZB=America/Santiago node tools/ui/barrido-errores.mjs
 * RUTAS=/pos,/caja para recorrer solo algunas. TZB: zona horaria del navegador.
 */
import { chromium } from 'playwright-core';
const BASE = process.env.RA_BASE ?? 'http://localhost:3000';
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const rutas = (process.env.RUTAS ?? '/,/pos,/precio,/caja,/ventas,/productos,/productos/etiquetas,/productos/importar,/productos/ofertas,/productos/combos,/inventario,/proveedores,/proveedores/recepcion,/proveedores/devolucion,/reportes,/usuarios,/configuracion,/bitacora,/clientes,/fiado,/facturacion,/cuenta,/ayuda,/novedades').split(',');
for (const rol of (process.env.ROLES ?? 'admin').split(',')) {
  const ctx = await nav.newContext({ viewport: { width: 360, height: 780 }, timezoneId: process.env.TZB || undefined });
  await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
  const p = await ctx.newPage();
  let ruta = '';
  p.on('pageerror', (e) => console.log('ERR', rol, ruta, e.message.slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') console.log('CON', rol, ruta, m.text().slice(0, 160)); });
  for (ruta of rutas) { await p.goto(BASE + ruta, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); }
  await ctx.close();
}
await nav.close();
