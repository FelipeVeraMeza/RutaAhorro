/**
 * Vender sin internet (RNF-08, RNF-13, RNF-01): el service worker solo existe
 * en producción, así que esto corre contra la app COMPILADA:
 *   NEXT_PUBLIC_DEMO=true npm run build:web && cd apps/web && npx next start -p 3006
 *   RA_BASE=http://localhost:3006 node tools/ui/sin-red.mjs
 * (en demo para no depender de Supabase; contra Railway entra con QA_CORREO/QA_CLAVE).
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const BASE = process.env.RA_BASE ?? 'http://localhost:3006';
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const ctx = await nav.newContext({ viewport: { width: 360, height: 780 } });
if (!process.env.QA_CORREO) await ctx.addCookies([{ name: 'demo_rol', value: 'vendedor', url: BASE }]);
const p = await ctx.newPage();
const resultados = [];
const ok = (rf, cumple, texto) => { resultados.push({ rf, cumple: Boolean(cumple), texto }); console.log(cumple ? '✔' : '✖', rf, texto); };

if (process.env.QA_CORREO) {
  await p.goto(`${BASE}/login`);
  await p.fill('#email', process.env.QA_CORREO);
  await p.fill('#password', process.env.QA_CLAVE ?? '');
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}

await p.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
const activo = await p.evaluate(async () => {
  const r = await navigator.serviceWorker.ready;
  return Boolean(r.active);
});
ok('RNF-13', activo, 'el service worker queda instalado y activo');
// La primera visita instala el service worker; la segunda ya pasa por él y queda guardada.
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(800);

await ctx.setOffline(true);
await p.reload({ waitUntil: 'load' }).catch(() => {});
await p.waitForTimeout(1500);
const texto = await p.locator('body').innerText();
ok('RNF-08', /Escanear producto/.test(texto), 'sin red, Vender vuelve a abrir desde el celular');
ok('RNF-08', !/ERR_INTERNET_DISCONNECTED|No hay conexión a Internet/.test(texto), 'el navegador no muestra su página de "sin conexión"');
await p.fill('input[type=search]', 'arroz').catch(() => {});
await p.waitForTimeout(800);
ok('RNF-08', await p.locator('ul button', { hasText: 'Arroz' }).count() > 0, 'y busca en el catálogo guardado');

await p.goto(`${BASE}/caja`).catch(() => {});
await p.waitForTimeout(800);
ok('RNF-08', /Sin conexión/.test(await p.locator('body').innerText()), 'una pantalla no guardada explica que no hay conexión y ofrece ir a Vender');
await ctx.setOffline(false);

writeFileSync(new URL('./.resultado-sin-red.json', import.meta.url), JSON.stringify(resultados, null, 1));
const bien = resultados.filter((r) => r.cumple).length;
console.log(`\n${bien}/${resultados.length}`);
await nav.close();
process.exit(bien === resultados.length ? 0 : 1);
