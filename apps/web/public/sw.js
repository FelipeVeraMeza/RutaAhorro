/*
 * Service worker de RutaAhorro (RNF-08, RNF-13, RNF-01).
 *
 * El POS ya vendía sin internet (cola en IndexedDB, ADR-005), pero solo si la
 * pantalla estaba abierta: si el celular se reiniciaba o el cajero recargaba
 * sin señal, el navegador mostraba "sin conexión" y no había cómo vender.
 *
 * Reglas, en orden de prudencia:
 *  - Solo GET del mismo sitio. Nunca /api/, nunca Supabase (es otro dominio y
 *    el service worker ni lo ve).
 *  - Archivos de /_next/static/ y /icons/: primero la caché. Tienen el hash en
 *    el nombre, así que no cambian nunca.
 *  - Pantallas: primero la red, siempre. Solo si la red falla se muestra la
 *    última copia guardada, y solo de las pantallas de mostrador (Vender,
 *    Consultar precio). Una respuesta que redirige (sesión vencida) no
 *    se guarda. Al cerrar sesión la app borra estas copias.
 */
const VERSION = 'v1';
const ESTATICO = `ra-estatico-${VERSION}`;
const PAGINAS = `ra-paginas-${VERSION}`;
// La Caja no: mostraría montos viejos como si fueran de ahora.
const PANTALLAS_SIN_RED = ['/pos', '/precio'];
const MAX_ESTATICOS = 200;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('ra-') && k !== ESTATICO && k !== PAGINAS) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

async function recortar(nombre, max) {
  const cache = await caches.open(nombre);
  const claves = await cache.keys();
  for (let i = 0; i < claves.length - max; i++) await cache.delete(claves[i]);
}

const PAGINA_SIN_RED = `<!doctype html><html lang="es-CL"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión · RutaAhorro</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
a,button{display:inline-block;min-height:44px;line-height:44px;padding:0 20px;border-radius:12px;background:#157a4c;color:#fff;font-weight:600;text-decoration:none;border:0;font-size:16px}</style></head>
<body><div><h1 style="font-size:20px">Sin conexión</h1>
<p style="color:#5b6577;max-width:320px">Esta pantalla no está guardada en este celular. Vender y Consultar precio funcionan sin internet si los abriste antes con conexión.</p>
<p><a href="/pos">Ir a Vender</a></p><p><button onclick="location.reload()" style="background:#fff;color:#0f172a;border:1px solid #e3e6ea">Reintentar</button></p></div></body></html>`;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith((async () => {
      const guardado = await caches.match(req);
      if (guardado) return guardado;
      const r = await fetch(req);
      if (r.ok) {
        const cache = await caches.open(ESTATICO);
        await cache.put(req, r.clone());
        void recortar(ESTATICO, MAX_ESTATICOS);
      }
      return r;
    })());
    return;
  }

  if (req.mode === 'navigate') {
    const guardable = PANTALLAS_SIN_RED.includes(url.pathname);
    event.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (guardable && r.ok && !r.redirected && r.type === 'basic') {
          const cache = await caches.open(PAGINAS);
          await cache.put(url.pathname, r.clone());
        }
        return r;
      } catch {
        const guardado = guardable ? await caches.match(url.pathname, { cacheName: PAGINAS }) : null;
        return guardado ?? new Response(PAGINA_SIN_RED, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
  }
});
