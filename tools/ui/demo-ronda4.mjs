/**
 * Recorrido del MODO DEMO, ronda 4 (2026-10-01): redondeo del efectivo,
 * fiado, pie del comprobante, cuentas por pagar, y los casos de la ronda 3
 * que no tenían datos que los provocaran (caja de otro día, caja olvidada,
 * cierre completo, merma del mes). Cita cada ID.
 *   RA_BASE=http://localhost:3000 node tools/ui/demo-ronda4.mjs
 * Con Chromium en vez de Edge: CHROME_PATH=/ruta/a/chrome.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.RA_BASE ?? 'http://localhost:3000';
// En Windows, pathname trae "/C:/...": sin la barra inicial, mkdir arma "C:\C:\...".
const SP = new URL('./.capturas/demo', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(SP, { recursive: true });
const nav = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'msedge' });
const resultados = [];
const errores = [];
const ok = (rf, cumple, texto, detalle = '') => {
  resultados.push({ rf, cumple: Boolean(cumple), texto });
  console.log(cumple ? '✔' : '✖', rf, texto, detalle ? `· ${detalle}` : '');
};

async function pagina(rol, ancho = 360, alto = 780) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto } });
  if (rol) await ctx.addCookies([{ name: 'demo_rol', value: rol, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${rol}: ${e.message.slice(0, 150)}`));
  return p;
}
const ir = async (p, ruta) => { await p.goto(BASE + ruta, { waitUntil: 'networkidle' }); await p.waitForTimeout(900); };
const texto = (p) => p.locator('main').first().innerText();
const cuerpo = (p) => p.locator('body').innerText();
const plano = (s) => s.replace(/\s+/g, ' ');
const desborda = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
/** La caja de la maqueta vive en una cookie: se escribe para provocar cada caso. */
async function cajaDemo(p, usuario, cambios) {
  const base = {
    usuario, abierta: true, id: `caja-${Date.now()}`, apertura: 20000, abiertaEn: new Date().toISOString(),
    ventas: { n: 0, total: 0, porMedio: {}, redondeo: 0 }, movs: [], abonos: 0, cierres: [],
  };
  await p.context().addCookies([{ name: 'demo_caja', value: encodeURIComponent(JSON.stringify({ ...base, ...cambios })), url: BASE }]);
}
async function agregar(p, nombre) {
  await p.fill('input[type=search]', nombre);
  await p.waitForTimeout(600);
  await p.locator('main li button', { hasText: nombre }).first().click();
  await p.waitForTimeout(300);
}

// ===================================================== admin: un solo celular
// Clientes, fiado y facturas viven en la base del navegador de este contexto.
let p = await pagina('admin');
await cajaDemo(p, 'demo-admin', {});

// ---- RF-M9-13 · pie del comprobante
await ir(p, '/configuracion');
const pie = 'Cambios dentro de 7 días con este comprobante';
await p.getByLabel('Texto al pie del comprobante').fill(pie);
await p.getByRole('button', { name: 'Guardar pie del comprobante' }).click();
await p.waitForTimeout(600);
ok('RF-M9-13', /Pie del comprobante guardado/.test(await texto(p)), 'el administrador guarda el pie del comprobante');
ok('RF-M9-13', await p.getByLabel('Texto al pie del comprobante').getAttribute('maxlength') === '160', 'con límite de 160 caracteres');

// ---- un cliente (para el fiado de más abajo)
await ir(p, '/clientes');
await p.getByRole('button', { name: 'Nuevo cliente' }).click();
const ficha = p.getByRole('dialog');
await ficha.getByLabel('Nombre o razón social').fill('Doña Rosa');
await ficha.getByRole('button', { name: 'Guardar' }).click();
await p.waitForTimeout(800);

// ---- un total que no termina en 0. Antes salía del 8 % de un cliente; desde
// 0032 los clientes no tienen precio propio, así que es un producto de $1.463.
await ir(p, '/productos');
await p.getByRole('button', { name: /Nuevo producto/ }).first().click();
const alta = p.getByRole('dialog');
await alta.getByPlaceholder('Ej: Arroz grado 1 · 1 kg').fill('Redondeo QA');
await alta.getByLabel(/^Precio de venta/).fill('1463');
const pere = alta.getByRole('checkbox', { name: /Producto perecible/ });
if (await pere.isChecked()) await pere.uncheck();
await alta.getByLabel(/Cuántos tienes hoy en la bodega/).fill('5');
await alta.getByRole('button', { name: 'Crear producto' }).click();
await p.waitForTimeout(1200);

// ---- RF-M5-28 · redondeo del efectivo
await ir(p, '/pos');
await p.waitForTimeout(1500);
await agregar(p, 'Redondeo QA');
await p.getByRole('button', { name: /Elegir cliente/ }).click();
await p.getByRole('dialog').getByRole('button', { name: /Doña Rosa/ }).click();
await p.waitForTimeout(300);
// $1.463 termina en 3: en efectivo baja a $1.460.
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.waitForTimeout(500);
const cobro = plano(await p.getByRole('dialog').innerText());
ok('RF-M5-28', /\$1\.460/.test(cobro) && /Total \$1\.463 · redondeo del efectivo −\$3 \(Ley 20\.956\)/.test(cobro),
  'en efectivo se cobra $1.460 y se dice por qué', cobro.slice(0, 120));
await p.getByRole('button', { name: /Débito/ }).click();
await p.waitForTimeout(200);
ok('RF-M5-28', !/redondeo del efectivo/.test(await p.getByRole('dialog').innerText()), 'con tarjeta se cobra el monto exacto');
await p.getByRole('button', { name: /Efectivo/ }).click();
await p.fill('#recibido', '2000');
await p.waitForTimeout(200);
ok('RF-M5-28', /Vuelto\s*\$540/.test(plano(await p.getByRole('dialog').innerText())), 'el vuelto es sobre lo cobrado: $540');
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.locator('#ticket').waitFor({ timeout: 15000 });
const ticket = plano(await p.locator('#ticket').innerText());
ok('RF-M5-28', /TOTAL \$1\.463/.test(ticket) && /Redondeo \(Ley 20\.956\) -\$3/.test(ticket) && /Total cobrado \$1\.460/.test(ticket),
  'el comprobante muestra el total exacto, el redondeo y lo cobrado', ticket.slice(-200));
ok('RF-M9-13', ticket.includes(pie), 'el pie del local sale en el comprobante');
await p.screenshot({ path: `${SP}/r4-redondeo.png`, fullPage: true });
await p.getByRole('button', { name: 'Nueva venta' }).click();

await ir(p, '/caja');
const caja1 = plano(await texto(p));
ok('RF-M5-28', /Redondeo del efectivo \(Ley 20\.956\): −\$3/.test(caja1), 'la caja muestra el redondeo del turno', caja1.slice(0, 160));
ok('RF-M5-28', /Debería haber \$21\.460/.test(caja1), 'y espera lo que entró al cajón: $20.000 + $1.460');

await ir(p, '/ventas');
await p.locator('main li button', { hasText: '$1.463' }).first().click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Reimprimir o compartir el comprobante' }).click();
await p.waitForTimeout(500);
const copia = plano(await p.getByRole('dialog').last().innerText());
ok('RF-M5-28', /Total cobrado \$1\.460/.test(copia), 'la copia (RF-M5-23) también muestra lo cobrado', copia.slice(-220));
ok('RF-M9-13', copia.includes(pie), 'y el pie del local');
await p.keyboard.press('Escape');

// ---- RF-M5-30 · fiado
await ir(p, '/fiado');
ok('RF-M5-30', /Fiado/.test(await texto(p)), 'el administrador entra a Fiado');
await p.getByRole('button', { name: 'Dar crédito a un cliente' }).click();
await p.getByRole('dialog').getByRole('button', { name: 'Doña Rosa' }).click();
await p.getByLabel('Hasta cuánto se le fía').fill('5000');
await p.getByRole('button', { name: 'Guardar tope' }).click();
await p.waitForTimeout(600);
ok('RF-M5-30', /Doña Rosa puede comprar fiado hasta \$5\.000/.test(await texto(p)), 'el administrador le da $5.000 de crédito');

await ir(p, '/pos');
await p.waitForTimeout(1200);
await agregar(p, 'Redondeo QA');
await agregar(p, 'Aceite');
await p.getByRole('button', { name: /Elegir cliente/ }).click();
await p.getByRole('dialog').getByRole('button', { name: /Doña Rosa/ }).click();
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.waitForTimeout(800);
const fiadoBtn = p.getByRole('button', { name: /Fiado/ });
ok('RF-M5-30', await fiadoBtn.count() === 1, 'con un cliente con crédito aparece "Fiado"');
await fiadoBtn.click();
await p.waitForTimeout(300);
// $1.463 + $2.490 = $3.953 (el Aceite a precio normal: sin precio de cliente desde 0032)
const enFiado = plano(await p.getByRole('dialog').innerText());
ok('RF-M5-30', /debe \$0 de un tope de \$5\.000/.test(enFiado) && /Queda debiendo \$3\.953/.test(enFiado),
  'dice cuánto debe y cuánto quedará debiendo', enFiado.slice(0, 200));
await p.getByRole('button', { name: 'Confirmar venta' }).click();
await p.locator('#ticket').waitFor({ timeout: 15000 });
ok('RF-M5-30', /Fiado \(a cuenta\)/.test(await p.locator('#ticket').innerText()), 'el comprobante dice que fue fiado');
await p.getByRole('button', { name: 'Nueva venta' }).click();

// Otra vez: ya no alcanza el tope.
await agregar(p, 'Aceite');
await p.getByRole('button', { name: /Elegir cliente/ }).click();
await p.getByRole('dialog').getByRole('button', { name: /Doña Rosa/ }).click();
await p.getByRole('button', { name: 'Cobrar' }).click();
await p.waitForTimeout(800);
await p.getByRole('button', { name: /Fiado/ }).click();
await p.waitForTimeout(300);
const sinCupo = plano(await p.getByRole('dialog').innerText());
ok('RF-M5-30', /Le quedan \$1\.047 de crédito: no alcanza/.test(sinCupo) && await p.getByRole('button', { name: 'Confirmar venta' }).isDisabled(),
  'pasado el tope no deja fiar', sinCupo.slice(0, 160));
await p.keyboard.press('Escape');

await ir(p, '/caja');
const caja2 = plano(await texto(p));
ok('RF-M5-30', /Fiado: \$3\.953 vendidos a cuenta\. No está en el cajón/.test(caja2) && /Debería haber \$21\.460/.test(caja2),
  'lo fiado no suma al efectivo esperado');

await ir(p, '/fiado');
ok('RF-M5-30', /\$3\.953/.test(await texto(p)), 'Fiado muestra lo que debe Doña Rosa');
await p.getByRole('button', { name: 'Abonar a la cuenta de Doña Rosa' }).click();
await p.getByLabel('Monto que paga').fill('2000');
await p.getByRole('button', { name: 'Registrar abono' }).click();
await p.waitForTimeout(700);
ok('RF-M5-30', /queda debiendo \$1\.953/.test(await texto(p)), 'un abono de $2.000 deja $1.953');
await p.getByRole('button', { name: 'Ver movimientos de Doña Rosa' }).click();
await p.waitForTimeout(500);
const movs = plano(await p.getByRole('dialog').innerText());
ok('RF-M5-30', /Compra fiada/.test(movs) && /Abono · Efectivo/.test(movs), 'la cuenta lista compras y abonos');
await p.keyboard.press('Escape');
await ir(p, '/caja');
const caja3 = plano(await texto(p));
ok('RF-M5-30', /Abonos de fiado en efectivo \$2\.000/.test(caja3) && /Debería haber \$23\.460/.test(caja3),
  'el abono en efectivo sí entra a la caja');

// ---- RF-M3-13 · cuentas por pagar
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const en = (d) => { const x = new Date(`${hoy}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
await ir(p, '/proveedores?vista=pagar');
ok('RF-M3-13', await p.getByRole('tab', { name: /Por pagar/ }).count() === 1, 'Compras tiene la pestaña "Por pagar"');
async function nuevaFactura(proveedor, numero, monto, vence) {
  await p.getByRole('button', { name: 'Registrar factura' }).first().click();
  const d = p.getByRole('dialog');
  await d.getByLabel('Proveedor').selectOption({ label: proveedor });
  await d.getByLabel('N° de factura').fill(numero);
  await d.getByLabel('Monto total').fill(monto);
  await d.getByLabel('Emitida el').fill(en(-27));
  await d.getByLabel('Vence el').fill(vence);
  await d.getByRole('button', { name: 'Registrar factura' }).click();
  await p.waitForTimeout(600);
}
await nuevaFactura('Distribuidora Sur Ltda.', '1001', '84.500', en(3));
await nuevaFactura('Lácteos del Valle', '77', '32.000', en(20));
await nuevaFactura('Comercial Aseo SpA', '5', '12.000', en(-2));
const pp = plano(await texto(p));
ok('RF-M3-13', /Por pagar \$128\.500/.test(pp), 'suma lo adeudado', pp.slice(0, 160));
ok('RF-M3-13', /Comercial Aseo SpA.*Vencida hace 2 días.*Distribuidora Sur Ltda\..*Vence en 3 días.*Lácteos del Valle/.test(pp),
  'ordenadas por vencimiento, con lo vencido marcado');
await nuevaFactura('Distribuidora Sur Ltda.', '1001', '1.000', en(5));
ok('RF-M3-13', /ya está registrada/.test(await p.getByRole('dialog').innerText().catch(() => '')), 'la misma factura no se ingresa dos veces');
await p.keyboard.press('Escape');

await ir(p, '/');
const ini = plano(await texto(p));
ok('RF-M3-13', /Facturas de proveedores por pagar esta semana \(\$96\.500\)/.test(ini) && /Vencida hace 2 d/.test(ini) && /En 3 d/.test(ini) && !/N° 77/.test(ini),
  'el Inicio avisa lo que vence en 7 días (y no lo de 20)', (ini.match(/Facturas de proveedores[^]{0,160}/) ?? [''])[0]);

await ir(p, '/proveedores?vista=pagar');
await p.getByRole('button', { name: 'Marcar pagada la factura 5 de Comercial Aseo SpA' }).click();
await p.getByRole('button', { name: /Efectivo de la caja/ }).click();
await p.getByRole('button', { name: 'Marcar pagada', exact: true }).click();
await p.waitForTimeout(700);
ok('RF-M3-13', /salió como egreso de tu caja/.test(await texto(p)) && /Por pagar \$116\.500/.test(plano(await texto(p))),
  'pagada con efectivo de la caja, sale de lo adeudado');
await ir(p, '/caja');
ok('RF-M3-13', /Pago factura N° 5/.test(await texto(p)) && /Debería haber \$11\.460/.test(plano(await texto(p))),
  'y queda como egreso de la caja');

// Recepción con factura a crédito
await ir(p, '/proveedores/recepcion');
await p.locator('#prov').selectOption({ label: 'Lácteos del Valle' });
await p.locator('#tipo').selectOption('factura');
await p.locator('#num').fill('88');
await p.getByRole('radio', { name: /A crédito/ }).click();   // el vencimiento se pide al elegir "A crédito"
await p.getByRole('button', { name: '30 días' }).click();
ok('RF-M3-13', (await p.inputValue('#vence')) === en(30), 'al recibir con factura se indica el vencimiento (30 días)');
await p.getByPlaceholder(/Buscar|nombre o código/i).first().fill('Leche');
await p.waitForTimeout(700);
await p.locator('main li button', { hasText: 'Leche' }).first().click();
await p.waitForTimeout(400);
const venceLote = p.locator('input[type=date]').nth(1);
if (await venceLote.count()) await venceLote.fill(en(15));
await p.getByRole('button', { name: /Confirmar/ }).last().click();
await p.waitForURL(/\/proveedores\?/, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(800);
ok('RF-M3-13', /La factura quedó en Por pagar/.test(await texto(p)), 'y queda en Por pagar sola', plano(await texto(p)).slice(0, 140));

// ---- RF-M4-24 · merma del mes en el Inicio
await ir(p, '/inventario');
await p.getByRole('button', { name: 'Ajustar' }).first().click();
const aj = p.getByRole('dialog');
const actual = Number(await aj.getByLabel('Cantidad real').inputValue());
await aj.getByLabel('Cantidad real').fill(String(Math.max(actual - 2, 0)));
await aj.getByText('Registrar como').click();
await aj.getByPlaceholder('…o escribe otro motivo').fill('Se cayó de la repisa');
await aj.getByRole('button', { name: 'Registrar ajuste' }).click();
await p.waitForTimeout(800);
await ir(p, '/');
const ini2 = plano(await texto(p));
ok('RF-M4-24', /Pérdidas por merma y ajustes este mes \(\d+ movimientos?\) \$[\d.]+/.test(ini2), 'el Inicio muestra lo perdido por merma este mes',
  (ini2.match(/Pérdidas por merma[^$]*\$[\d.]+/) ?? [''])[0]);
ok('RF-M4-24', await p.getByRole('link', { name: /^\$[\d.]+$/ }).first().getAttribute('href') === '/reportes?vista=ajustes', 'con enlace al detalle');
await p.context().close();

// El supervisor no ve costos: tampoco la merma del mes.
p = await pagina('supervisor');
await ir(p, '/');
ok('RF-M4-24', !/Pérdidas por merma/.test(await texto(p)), 'el supervisor no ve la merma en pesos');
await p.context().close();

// ===================================================== cajas viejas
p = await pagina('vendedor');
const ayer = new Date(Date.now() - 30 * 3_600_000).toISOString();
await cajaDemo(p, 'demo-vendedor', { abiertaEn: ayer, ventas: { n: 2, total: 5000, porMedio: { efectivo: 3000, debito: 2000 }, redondeo: 0 } });
await ir(p, '/caja');
const vieja = plano(await texto(p));
ok('RF-M6-15', /Esta caja quedó abierta de otro día/.test(vieja), 'la caja de ayer avisa que quedó abierta de otro día');

// RF-M6-14 · el cierre completo con su resumen
await p.getByRole('button', { name: 'Cerrar caja' }).first().click();
await p.waitForTimeout(400);
const esperado = (vieja.match(/Debería haber (\$[\d.]+)/) ?? [])[1];
await p.fill('#contado', '22.000');
await p.waitForTimeout(200);
await p.fill('#nota', 'Faltan $1.000, se revisa mañana');
await p.getByRole('button', { name: /Confirmar cierre|Cerrar caja/ }).last().click();
await p.waitForTimeout(900);
const cierre = plano(await texto(p));
ok('RF-M6-14', /Caja cerrada/.test(cierre) && await p.getByRole('button', { name: 'Imprimir' }).count() === 1,
  'al cerrar aparece el resumen con "Imprimir"');
ok('RF-M6-14', esperado && cierre.includes(`Debía haber ${esperado}`) && /Contado \$22\.000/.test(cierre) && /Faltante \$1\.000/.test(cierre),
  `el resumen coincide con lo registrado (debía ${esperado}, contado $22.000)`);
await p.screenshot({ path: `${SP}/r4-cierre.png`, fullPage: true });
await p.context().close();

// RF-M8-08 · el jefe ve la caja olvidada
p = await pagina('admin');
await cajaDemo(p, 'demo-admin', { abiertaEn: ayer });
await ir(p, '/');
const olvidada = plano(await texto(p));
ok('RF-M8-08', /Cajas abiertas hace más de 12 h/.test(olvidada) && /Abierta 30 h/.test(olvidada),
  'el Inicio avisa la caja abierta hace más de las horas configuradas', (olvidada.match(/Cajas abiertas[^]{0,60}/) ?? [''])[0]);
await p.context().close();

// ===================================================== permisos y pantallas
p = await pagina('vendedor');
await ir(p, '/fiado');
ok('RF-M5-30', new URL(p.url()).pathname === '/fiado' && await p.getByRole('button', { name: 'Dar crédito a un cliente' }).count() === 0,
  'el vendedor entra a Fiado (recibe abonos) pero no da crédito');
await ir(p, '/proveedores?vista=pagar');
ok('RF-M3-13', new URL(p.url()).pathname !== '/proveedores', 'el vendedor no ve las cuentas por pagar');
await p.context().close();
p = await pagina('bodega');
await ir(p, '/proveedores?vista=pagar');
ok('RF-M3-13', await p.getByRole('tab', { name: /Por pagar/ }).count() === 0, 'bodega no ve la pestaña Por pagar');
await ir(p, '/fiado');
ok('RF-M5-30', new URL(p.url()).pathname !== '/fiado', 'bodega no entra a Fiado');
await p.context().close();

// RNF-16 · las pantallas nuevas a 360 px
p = await pagina('admin');
const sinDesborde = [];
for (const r of ['/fiado', '/proveedores?vista=pagar', '/configuracion']) {
  await ir(p, r);
  if (!(await desborda(p))) sinDesborde.push(r);
}
ok('RNF-16', sinDesborde.length === 3, `a 360 px las pantallas nuevas no se salen (${sinDesborde.join(', ')})`);
await p.context().close();

ok('RNF-40', errores.length === 0, `sin errores de JavaScript en las pantallas (${errores.length})`, errores.slice(0, 3).join(' | '));
await nav.close();
const fallas = resultados.filter((r) => !r.cumple);
writeFileSync(new URL('./.resultado-demo-ronda4.json', import.meta.url), JSON.stringify(resultados, null, 2));
console.log(`\n${resultados.length - fallas.length}/${resultados.length} comprobaciones`);
process.exit(fallas.length ? 1 : 0);
