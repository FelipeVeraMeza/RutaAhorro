/**
 * El celular es la meta: cada pantalla, a 360 × 740, con cada rol.
 *
 *   node tools/ui/movil.mjs            (la app compilada en http://localhost:3001)
 *   RA_BASE=http://localhost:3005 node tools/ui/movil.mjs
 *
 * Mide lo que se puede medir sin mirar:
 *   · desplazamiento horizontal (la página es más ancha que la pantalla)
 *   · botones y enlaces visibles de menos de 44 px de alto (RNF-16)
 *   · errores de JavaScript y respuestas 4xx/5xx
 * y deja una captura por pantalla en tools/ui/.capturas/ para mirar lo demás.
 *
 * Solo lee: no crea ventas, productos ni cajas. Corre con los usuarios del
 * local "QA · pruebas internas".
 */
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = dotenv.parse(fs.readFileSync('.env.local'));
const BASE = process.env.RA_BASE ?? 'http://localhost:3001';
const opc = { auth: { persistSession: false, autoRefreshToken: false } };
const servicio = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, opc);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const CAPTURAS = 'tools/ui/.capturas';
fs.mkdirSync(CAPTURAS, { recursive: true });

async function credenciales(alias) {
  const correo = `qa-${alias}-${ref}@example.com`;
  const { data } = await servicio.auth.admin.listUsers({ perPage: 1000 });
  const u = data.users.find((x) => x.email === correo);
  if (!u) return null;
  const clave = randomBytes(12).toString('base64url');
  await servicio.auth.admin.updateUserById(u.id, { password: clave });
  return { correo, clave };
}

const RUTAS = {
  admin: ['/', '/pos', '/caja', '/precio', '/productos', '/productos/importar', '/productos/etiquetas',
    '/inventario', '/proveedores', '/proveedores/recepcion', '/ventas', '/reportes', '/usuarios', '/configuracion',
    '/facturacion'],
  // Ventas no es del vendedor: lo manda a Inicio, con solo sus ventas (CP-09).
  cajero: ['/', '/pos', '/caja', '/precio', '/productos'],
};

const TAMANOS = [
  { nombre: 'celular', width: 360, height: 740, isMobile: true, hasTouch: true },
  { nombre: 'computador', width: 1280, height: 800, isMobile: false, hasTouch: false },
];

const problemas = [];
const nav = await chromium.launch({ channel: 'msedge', headless: true });

for (const [alias, rutas] of Object.entries(RUTAS)) {
  const cred = await credenciales(alias);
  if (!cred) { console.log(`(no existe el usuario qa-${alias}; se salta)`); continue; }
  for (const t of TAMANOS) {
    const ctx = await nav.newContext({ viewport: { width: t.width, height: t.height }, isMobile: t.isMobile, hasTouch: t.hasTouch });
    const p = await ctx.newPage();
    const errores = [];
    p.on('pageerror', (e) => errores.push(`JS: ${e.message}`));
    p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errores.push(`${r.status()} ${r.url().replace(BASE, '')}`); });

    await p.goto(`${BASE}/login`);
    await p.fill('#email', cred.correo);
    await p.fill('#password', cred.clave);
    await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: 30000 }), p.click('button[type=submit]')]);

    console.log(`\n${alias} · ${t.nombre} (${t.width} px)`);
    for (const ruta of rutas) {
      errores.length = 0;
      await p.goto(`${BASE}${ruta}`);
      await p.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
      await p.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 20000 }).catch(() => {});
      // Que termine de cargar: la captura con "Cargando…" no dice nada.
      await p.waitForFunction(() => !/Cargando/.test(document.querySelector('main')?.innerText ?? ''), null, { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(500);

      const m = await p.evaluate(() => {
        const ancho = document.documentElement.clientWidth;
        const desborde = document.documentElement.scrollWidth - ancho;
        // Quién se sale: el elemento más externo que pasa el borde derecho.
        const culpables = [];
        if (desborde > 1) {
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.right > ancho + 1 && r.width > 0 && !culpables.some((c) => c.el.contains(el))) {
              culpables.push({ el, txt: `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : ''} (${Math.round(r.right)} px)` });
            }
            if (culpables.length >= 3) break;
          }
        }
        const chicos = [];
        for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button]')) {
          const r = el.getBoundingClientRect();
          const estilo = getComputedStyle(el);
          if (!r.width || !r.height || estilo.visibility === 'hidden') continue;
          // Oculto a propósito (sr-only, el <input type=file> detrás de su botón).
          if (r.width < 4 || r.height < 4 || estilo.opacity === '0') continue;
          if (el.type === 'checkbox' || el.type === 'radio') continue;
          if (r.height < 44 - 0.5) {
            const nombre = (el.getAttribute('aria-label') || el.innerText || el.placeholder || el.name || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
            chicos.push(`${nombre} (${Math.round(r.height)} px)`);
          }
        }
        return { desborde, culpables: culpables.map((c) => c.txt), chicos };
      });

      const archivo = `${CAPTURAS}/${alias}-${t.nombre}${ruta.replace(/\//g, '_') || '_inicio'}.png`;
      await p.screenshot({ path: archivo, fullPage: true });

      const malo = [];
      if (m.desborde > 1) malo.push(`se desborda ${m.desborde} px → ${m.culpables.join(', ')}`);
      if (t.isMobile && m.chicos.length) malo.push(`${m.chicos.length} objetivos < 44 px: ${m.chicos.slice(0, 4).join(' · ')}${m.chicos.length > 4 ? ' …' : ''}`);
      if (errores.length) malo.push(errores.slice(0, 3).join(' | '));
      console.log(`  ${malo.length ? '✖' : '✔'} ${ruta.padEnd(24)} ${malo.join(' ; ')}`);
      if (malo.length) problemas.push({ alias, tamano: t.nombre, ruta, ...m, errores: [...errores] });
    }
    await ctx.close();
  }
}

await nav.close();
fs.writeFileSync('tools/ui/.resultado-movil.json', JSON.stringify(problemas, null, 1));
console.log(`\n${problemas.length ? problemas.length + ' pantallas con problemas' : 'Todas las pantallas pasan'} · capturas en ${CAPTURAS}/`);
process.exit(problemas.length ? 1 : 0);
