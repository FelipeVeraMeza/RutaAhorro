/**
 * Recorrido de la tienda online (docs/33): las actualizaciones que se pueden
 * ver en la maqueta. Cada comprobación cita su número (U-n) de docs/33.
 *   RA_BASE=http://localhost:3005 CHROME_PATH=/opt/pw-browsers/chromium node tools/ui/tienda-150.mjs
 * Necesita la maqueta (NEXT_PUBLIC_DEMO=true) recién levantada: los pedidos
 * de la maqueta viven en la memoria del servidor.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.RA_BASE ?? 'http://localhost:3005';
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const resultados = [];
const errores = [];
const ok = (id, cumple, texto, detalle = '') => {
  resultados.push({ id, cumple: Boolean(cumple), texto });
  console.log(cumple ? '✔' : '✖', id, texto, detalle ? `· ${detalle}` : '');
};
async function nuevaPagina({ rol = null, ancho = 360 } = {}) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: 800 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
  if (rol) await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${rol ?? 'cliente'}: ${e.message.slice(0, 150)}`));
  p.on('dialog', (d) => void d.accept());
  return p;
}
const ir = async (p, ruta) => { await p.goto(BASE + ruta, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); };
const texto = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
const sinDesborde = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const jsonLd = (p) => p.$$eval('script[type="application/ld+json"]', (xs) => xs.map((x) => JSON.parse(x.textContent)));

// ================================================================ cliente
const c = await nuevaPagina();
await ir(c, '/tienda');
let t = await texto(c);
ok('U-78', /Ofertas de hoy/.test(t) && /Arroz grado 1/.test(t), 'la portada muestra las ofertas que más rebajan');
ok('U-91', /Abierto · cierra a las|Cerrado · abre/.test(t), 'barra de abierto/cerrado con el horario del local');
ok('U-92', /Lun a Vie/.test(t) && /Sáb/.test(t), 'el pie muestra el horario de la semana agrupado');
ok('U-139', (await c.locator('a[href="#contenido"]').count()) === 1, 'enlace "Saltar al contenido"');
ok('U-80', /−\d+%/.test(t), 'la tarjeta en oferta dice cuánto rebaja (−N %)');
const sitio = (await jsonLd(c)).find((x) => x['@type'] === 'WebSite');
ok('U-131', sitio?.potentialAction?.['@type'] === 'SearchAction', 'datos para Google: el buscador de la tienda');
ok('U-142', await sinDesborde(c), 'portada sin desborde a 360 px');

await ir(c, '/tienda/productos?q=aceites');
ok('U-64', /Aceite vegetal/.test(await texto(c)), 'buscar en plural encuentra el singular ("aceites" → Aceite)');
await ir(c, '/tienda/productos?q=lehe');
t = await texto(c);
ok('U-67', /¿Quisiste decir leche\?/.test(t), '"¿Quisiste decir leche?" cuando no encuentra "lehe"');
await c.getByRole('link', { name: 'leche', exact: true }).click();
await c.waitForURL(/q=leche/).catch(() => {});
await c.waitForTimeout(600);
ok('U-67', /Leche entera/.test(await texto(c)), 'la sugerencia lleva a la búsqueda corregida');

await ir(c, '/tienda/productos?categoria=L%C3%A1cteos&disponibles=1');
t = await texto(c);
ok('U-72', (await c.getByRole('link', { name: 'Quitar el filtro Lácteos' }).count()) === 1
  && (await c.getByRole('link', { name: 'Quitar el filtro Solo disponibles' }).count()) === 1, 'los filtros puestos se ven y se quitan de a uno');
await c.getByRole('link', { name: 'Quitar el filtro Lácteos' }).click();
await c.waitForURL((u) => !u.search.includes('categoria=')).catch(() => {});
await c.waitForTimeout(600);
ok('U-72', !/categoria=/.test(c.url()) && /disponibles=1/.test(c.url()), 'quitar uno deja los demás');
ok('U-69', (await c.locator('input[type=checkbox][name="disponibles"]').count()) === 1 && (await c.locator('input[type=checkbox][name="ofertas"]').count()) === 1, 'filtros "Solo lo disponible" y "Solo con oferta"');
ok('U-74', (await c.locator('select option[value="mayor-descuento"]').count()) >= 1 || /Mayor descuento/.test(await c.content()), 'orden por mayor descuento');
await ir(c, '/tienda/productos?ofertas=1');
t = await texto(c);
ok('U-70', /Arroz grado 1/.test(t) && !/Azúcar/.test(t), 'solo con oferta');

await ir(c, '/tienda/p/p02');
t = await texto(c);
ok('U-83', /\$2\.475 el kg/.test(t), 'la ficha dice el precio por kilo ("400 g" a $990 → $2.475 el kg)');
const canonica = await c.locator('link[rel="canonical"]').getAttribute('href');
ok('U-125', /\/p\/p02$/.test(canonica ?? ''), 'la ficha tiene su dirección canónica', canonica);
const ld = await jsonLd(c);
ok('U-129', ld.some((x) => x['@type'] === 'BreadcrumbList') && ld.some((x) => x['@type'] === 'Product' && x.offers?.seller), 'datos para Google: ruta y producto con vendedor');
const corazon = c.getByRole('button', { name: /Guardar Fideos spaghetti · 400 g en favoritos/ }).first();
await corazon.click();
await c.waitForTimeout(300);
ok('U-86', (await c.getByRole('button', { name: /Quitar Fideos spaghetti · 400 g de favoritos/ }).first().getAttribute('aria-pressed')) === 'true', 'el corazón guarda el producto en favoritos');
await ir(c, '/tienda/p/p03');
await ir(c, '/tienda/p/p01');
await c.waitForTimeout(800);
t = await texto(c);
ok('U-87', /Vistos hace poco/.test(t) && /Aceite vegetal/.test(t) && /Fideos spaghetti/.test(t), 'la ficha muestra los vistos hace poco');

// Carrito: 3 arroz (oferta desde 3 a $1.390) y 1 aceite.
await c.getByRole('button', { name: /Agregar/ }).first().click();
await c.getByRole('button', { name: 'Agregar uno' }).first().click();
await c.getByRole('button', { name: 'Agregar uno' }).first().click();
await ir(c, '/tienda/p/p03');
await c.getByRole('button', { name: /Agregar/ }).first().click();
await ir(c, '/tienda/carrito');
t = await texto(c);
ok('U-49', /\$1\.390 c\/u/.test(t) && /con oferta/.test(t), 'el carrito cobra la oferta por cantidad');
ok('U-44', (await c.getByRole('button', { name: 'Copiar lista' }).count()) === 1, 'botón "Copiar lista"');
await c.getByRole('button', { name: 'Quitar Aceite vegetal · 900 ml del carrito' }).click();
await c.waitForTimeout(300);
ok('U-45', /Sacaste Aceite vegetal/.test(await texto(c)), 'al quitar, ofrece deshacer');
await c.getByRole('button', { name: 'Deshacer' }).click();
await c.waitForTimeout(300);
ok('U-45', /Aceite vegetal/.test(await c.locator('main ul').first().innerText()), '"Deshacer" lo devuelve al carrito');
ok('U-142', await sinDesborde(c), 'carrito sin desborde a 360 px');

// Confirmar pedido: primero sin datos.
await c.getByRole('button', { name: /Hacer pedido/ }).click();
await c.waitForTimeout(300);
ok('U-38', /Escribe tu nombre/.test(await texto(c)), 'pedir sin nombre lo dice antes de enviar');
await c.getByLabel('Tu nombre').fill('Ana Pérez');
await c.getByLabel('Celular', { exact: true }).fill('9 1234 5678');
await c.getByLabel(/Nota para el local/).fill('Sin bolsa');
await c.getByRole('button', { name: /Hacer pedido/ }).click();
await c.waitForURL(/\/tienda\/pedido\/[A-Z2-9]{8}\?nuevo=1/, { timeout: 15000 }).catch(() => {});
const codigo = c.url().match(/pedido\/([A-Z2-9]{8})/)?.[1];
t = await texto(c);
ok('U-1', Boolean(codigo) && /Recibimos tu pedido N° 1/.test(t), 'el pedido queda hecho con número y código', codigo);
ok('U-40', /Sin bolsa/.test(t) && /\$6\.660/.test(t), 'el seguimiento muestra lo pedido, la nota y el total (3 × $1.390 + $2.490)');
ok('U-55', (await c.locator('meta[name="robots"]').getAttribute('content'))?.includes('noindex'), 'el seguimiento no se indexa');
ok('U-10', /Dónde se retira/.test(t) && /Cómo llegar/.test(t), 'dice dónde se retira, con el mapa');
await ir(c, '/tienda/carrito');
ok('U-43', /Tu carrito está vacío/.test(await texto(c)), 'después del pedido el carrito queda vacío');
await ir(c, '/tienda/cuenta');
await c.waitForTimeout(800);
t = await texto(c);
ok('U-57', /N° 1/.test(t) && /Recibido/.test(t) && (await c.getByRole('link', { name: /Ver cómo va/ }).count()) >= 1, 'Mis pedidos muestra el número, el estado y el seguimiento');
ok('U-88', /Mis favoritos/.test(t) && /Fideos spaghetti/.test(t), 'Mi cuenta muestra los favoritos');

// Otro pedido, para cancelarlo.
await ir(c, '/tienda/p/p09');
await c.getByRole('button', { name: /Agregar/ }).first().click();
await ir(c, '/tienda/carrito');
await c.getByRole('button', { name: /Hacer pedido/ }).click();
await c.waitForURL(/\/tienda\/pedido\//, { timeout: 15000 }).catch(() => {});
const codigo2 = c.url().match(/pedido\/([A-Z2-9]{8})/)?.[1];
ok('U-37', Boolean(codigo2) && codigo2 !== codigo, 'el segundo pedido usa los datos guardados y tiene otro código');

await ir(c, '/tienda/contacto');
t = await texto(c);
ok('U-94', /Contacto y horario/.test(t) && (await c.locator('a[href*="google.com/maps"]').count()) >= 1, 'Contacto con dirección, horario y "Cómo llegar"');
ok('U-132', (await jsonLd(c)).some((x) => x['@type'] === 'GroceryStore'), 'datos para Google: el local');
await ir(c, '/tienda/ayuda');
ok('U-96', (await c.locator('details').count()) >= 6 && (await jsonLd(c)).some((x) => x['@type'] === 'FAQPage'), 'Cómo comprar: preguntas frecuentes');
await ir(c, '/tienda/categorias');
ok('U-89', /Abarrotes/.test(await texto(c)), 'página con todas las categorías');

const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
ok('U-134', /\/categorias/.test(sitemap) && /productos\?categoria=/.test(sitemap), 'el sitemap trae las categorías y la ayuda');
const robots = await (await fetch(`${BASE}/robots.txt`)).text();
ok('U-135', /Disallow: \/tienda\/carrito/.test(robots) && /Disallow: \/tienda\/pedido\//.test(robots), 'robots.txt no deja rastrear carrito ni pedidos');

// API: lo que el servidor rechaza.
const post = (cuerpo, extra = {}) => fetch(`${BASE}/api/tienda/pedidos`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(cuerpo),
});
const base = { client_uuid: crypto.randomUUID(), cliente: { nombre: 'Bot', celular: '9 1234 5678', correo: '' }, lineas: [{ id: '11111111-2222-3333-4444-555555555555', cantidad: 1 }] };
ok('U-27', (await post(base, { Origin: 'https://otro-sitio.cl' })).status === 403, 'un pedido desde otro sitio se rechaza (CSRF)');
const r1 = await post({ ...base, cliente: { ...base.cliente, celular: '123' } });
ok('U-29', r1.status === 400 && /celular/.test((await r1.json()).error.message), 'el servidor valida el celular');
ok('U-28', (await post({ ...base, empresa: 'ACME' })).status === 400, 'la trampa para robots rechaza el pedido');
const productos = await (await fetch(`${BASE}/api/tienda/productos?ids=p01,../../etc,p01'%20or%201=1`)).json();
ok('U-34', productos.productos.length === 1, 'la API ignora id que no son de producto');
const estados = await (await fetch(`${BASE}/api/tienda/pedidos/estado?codigos=${codigo},XXXXXXX0`)).json();
ok('U-36', estados.pedidos.length === 1 && !JSON.stringify(estados).includes('1234'), 'el estado por código no trae datos de contacto');

const salud = await fetch(`${BASE}/api/tienda/salud`);
const s1 = await salud.json();
ok('U-144', salud.status === 200 && s1.ok === true && s1.productos > 0 && !('costo' in s1), 'chequeo de salud para el monitor de disponibilidad');
const cabeceras = (await fetch(`${BASE}/tienda`)).headers;
ok('U-143', /default-src 'self'/.test(cabeceras.get('content-security-policy-report-only') ?? ''), 'política de contenido de la tienda (modo informe)');
await ir(c, '/tienda/p/no-existe');
ok('U-97', /No encontramos lo que buscas/.test(await texto(c)) && (await c.locator('input[name="q"]').count()) === 1, 'el "no encontrado" ofrece buscar ahí mismo');
await ir(c, '/tienda/cuenta');
ok('U-61', (await c.getByRole('button', { name: 'Descargar mis datos' }).count()) === 1, 'Mi cuenta deja descargar lo guardado en el celular');
await ir(c, `/tienda/pedido/${codigo}`);
ok('U-56', (await c.getByRole('button', { name: 'Imprimir o guardar' }).count()) === 1, 'el seguimiento se puede imprimir o guardar en PDF');
await ir(c, '/tienda/ofertas');
ok('U-75', (await c.locator('select').first().inputValue().catch(() => '')) === 'mayor-descuento' || /Mayor descuento/.test(await texto(c)), 'Ofertas parte por lo que más rebaja');

// ================================================================ personal
const a = await nuevaPagina({ rol: 'admin', ancho: 1280 });
await ir(a, '/');
await a.waitForTimeout(1500);
ok('U-114', /pedidos web nuevos/.test(await texto(a)), 'el Inicio avisa los pedidos web nuevos');
await ir(a, '/pedidos-web');
await a.waitForTimeout(800);
t = await texto(a);
ok('U-100', /N° 1 · Ana Pérez/.test(t) && /Sin bolsa/.test(t), 'Pedidos web muestra el pedido con su nota');
await a.locator('li', { hasText: 'N° 1 · Ana Pérez' }).getByRole('button', { name: 'Empezar a preparar' }).click();
await a.waitForTimeout(800);
await a.getByRole('button', { name: /En preparación/ }).click();
await a.locator('li', { hasText: 'N° 1 · Ana Pérez' }).getByRole('button', { name: 'Listo para retirar' }).click();
await a.waitForTimeout(800);
await a.getByRole('button', { name: /^Listos/ }).click();
const avisar = await a.locator('li', { hasText: 'N° 1 · Ana Pérez' }).getByRole('link', { name: 'Avisar que está listo' }).getAttribute('href');
ok('U-104', /wa\.me\/56912345678/.test(avisar ?? '') && /listo%20para%20retirar/.test(avisar ?? ''), 'avisa al cliente por WhatsApp con el mensaje escrito');
await a.getByRole('button', { name: 'Nuevos' }).click();
await a.locator('li', { hasText: 'N° 2' }).getByRole('button', { name: 'Cancelar pedido' }).click();
ok('U-12', await a.getByRole('button', { name: 'Cancelar el pedido' }).isDisabled(), 'cancelar pide el motivo');
await a.getByRole('button', { name: 'Sin stock' }).click();
await a.getByRole('button', { name: 'Cancelar el pedido' }).click();
await a.waitForTimeout(800);
await a.getByRole('button', { name: /Entregados y cancelados/ }).click();
ok('U-12', /Cancelado: Sin stock/.test(await texto(a)), 'queda cancelado con el motivo');
ok('U-142', await sinDesborde(a), 'Pedidos web sin desborde');
await a.getByRole('button', { name: /^Listos/ }).click();
await a.getByLabel('Buscar un pedido').fill('ana');
const conAna = /N° 1 · Ana Pérez/.test(await texto(a));
await a.getByLabel('Buscar un pedido').fill('rodrigo');
ok('U-109', conAna && !/N° 1 · Ana Pérez/.test(await texto(a)), 'Pedidos web busca por nombre');
await a.getByLabel('Buscar un pedido').fill('');

await ir(c, `/tienda/pedido/${codigo}`);
ok('U-52', /Listo para retirar/.test(await texto(c)), 'el cliente ve en el seguimiento que está listo');
await ir(c, `/tienda/pedido/${codigo2}`);
ok('U-52', /Cancelado/.test(await texto(c)) && /Sin stock/.test(await texto(c)), 'y ve el motivo si se canceló');

await ir(a, '/configuracion#tienda');
await a.getByRole('button', { name: /Tienda online/ }).click();
t = await texto(a);
ok('U-115', /Recibir pedidos en la tienda/.test(t) && /Horario de atención/.test(t), 'Configuración → Tienda online');
await a.locator('input[placeholder="Cerrado"]').first().fill('temprano');
ok('U-116', /No se entiende el horario del lunes/.test(await texto(a)), 'un horario mal escrito se avisa antes de guardar');

const v = await nuevaPagina({ rol: 'vendedor' });
await ir(v, '/pedidos-web');
ok('U-112', /Pedidos web/.test(await v.locator('h1').first().innerText()), 'el vendedor atiende los pedidos web');
const b = await nuevaPagina({ rol: 'bodega' });
await ir(b, '/pedidos-web');
ok('U-112', !/pedidos-web/.test(b.url()), 'bodega no entra (los pedidos traen el celular del cliente)');

ok('U-150', errores.length === 0, `sin errores de JavaScript (${errores.length})`, errores.join(' | '));
const bien = resultados.filter((r) => r.cumple).length;
console.log(`\n${bien}/${resultados.length} comprobaciones`);
await nav.close();
process.exit(bien === resultados.length ? 0 : 1);
