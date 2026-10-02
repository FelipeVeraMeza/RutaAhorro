/**
 * Facturación (0026, 0027) en el celular (360 px), como la usa el
 * administrador en "QA · pruebas internas":
 *
 *   emitir una factura con una línea del catálogo y una libre, con el receptor
 *   autocompletado desde un cliente existente → ver bajar el stock → nota de
 *   crédito parcial → registrar una factura recibida con el proveedor por RUT →
 *   resumen del mes → que la barra de navegación no tape "Emitir factura".
 *
 *   node tools/ui/facturacion.mjs   (la app compilada en http://localhost:3001)
 *   RA_BASE=https://… node tools/ui/facturacion.mjs
 *
 * El flete se elige para que la suma con IVA no exista en una factura (0027):
 * la pantalla tiene que avisar el ajuste de $1 y la base cobrar lo mismo.
 */
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resumenFactura } from '@rutaahorro/core';

const env = dotenv.parse(fs.readFileSync('.env.local'));
const BASE = process.env.RA_BASE ?? 'http://localhost:3001';
const opc = { auth: { persistSession: false, autoRefreshToken: false } };
const servicio = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, opc);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];

const resultados = [];
function ok(rf, cumple, texto, detalle = '') {
  resultados.push({ rf, cumple, texto, detalle });
  console.log(`  ${cumple ? '✔' : '✖'} ${rf} · ${texto}${detalle ? ' — ' + detalle : ''}`);
}
async function usuario(alias) {
  const correo = `qa-${alias}-${ref}@example.com`;
  const { data } = await servicio.auth.admin.listUsers({ perPage: 1000 });
  const u = data.users.find((x) => x.email === correo);
  const clave = randomBytes(12).toString('base64url');
  await servicio.auth.admin.updateUserById(u.id, { password: clave });
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opc);
  await cli.auth.signInWithPassword({ email: correo, password: clave });
  return { id: u.id, correo, clave, cli };
}
function rutAlAzar() {
  const n = 10_000_000 + Math.floor(Math.random() * 60_000_000);
  let s = 0, m = 2;
  for (const d of String(n).split('').reverse()) { s += Number(d) * m; m = m === 7 ? 2 : m + 1; }
  const dv = 11 - (s % 11);
  return `${n.toLocaleString('es-CL')}-${dv === 11 ? '0' : dv === 10 ? 'K' : dv}`;
}
const clp = (n) => `$${Math.round(n).toLocaleString('es-CL')}`;

// ---------------------------------------------------------------- preparación
const admin = await usuario('admin');
const { data: perfil } = await servicio.from('profiles').select('tenant_id').eq('id', admin.id).single();
const tenant = perfil.tenant_id;
const sufijo = Date.now().toString().slice(-5);

const nProducto = `QA Fact ${sufijo} Aceite`;
const PRECIO = 3990, CANT = 3, STOCK = 50;
const { data: creado, error: eProd } = await admin.cli.rpc('fn_create_product', {
  p_name: nProducto, p_sku: null, p_description: 'Producto de prueba QA', p_category_id: null, p_unit: 'unidad',
  p_sale_price: PRECIO, p_avg_cost: 2000, p_min_stock: 0, p_tracks_expiry: false,
  p_expiry_alert_days: 30, p_barcodes: null, p_initial_stock: 0, p_initial_stock_sala: STOCK });
if (eProd) throw eProd;
const pId = creado.product_id;
const stockSala = async () => Number((await servicio.from('stock_levels').select('quantity')
  .eq('tenant_id', tenant).eq('product_id', pId).single()).data.quantity);

// Un cliente que ya existe, con todo lo que pide una factura.
const nCliente = `QA Fact ${sufijo} Comercial Los Aromos`;
const rutCliente = rutAlAzar();
const { error: eCli } = await admin.cli.rpc('fn_guardar_cliente', { p_id: null, p_datos: {
  nombre: nCliente, rut: rutCliente, giro: 'Venta de abarrotes', direccion: 'Av. Siempre Viva 742',
  comuna: 'Maipú', email: 'compras@aromos.cl', descuento_pct: 0, activo: true } });
if (eCli) throw eCli;
const { data: cliente } = await servicio.from('clientes').select('id').eq('tenant_id', tenant).eq('rut', rutCliente).single();

// Un proveedor que ya existe, con RUT.
const nProveedor = `QA Fact ${sufijo} Distribuidora`;
const rutProveedor = rutAlAzar();
const { data: proveedor, error: eProv } = await servicio.from('suppliers')
  .insert({ tenant_id: tenant, name: nProveedor, rut: rutProveedor }).select('id').single();
if (eProv) throw eProv;

// Un flete cuyo total con IVA no existe en una factura: tiene que haber ajuste.
let flete = 1000;
while (resumenFactura([{ nombre: 'a', cantidad: CANT, precio: PRECIO }, { nombre: 'b', cantidad: 1, precio: flete }]).ajuste === 0) flete++;
const esperado = resumenFactura([{ nombre: 'a', cantidad: CANT, precio: PRECIO }, { nombre: 'b', cantidad: 1, precio: flete }]);

const mesActual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }).slice(0, 7);
async function mesEnVista(vista) {
  const { data } = await admin.cli.from(vista).select('*').eq('mes', `${mesActual}-01`).maybeSingle();
  return data ?? { neto: 0, iva: 0, total: 0 };
}
const ventasAntes = await mesEnVista('v_ventas_mensuales');
const comprasAntes = await mesEnVista('v_compras_mensuales');

// ---------------------------------------------------------------- navegador
const nav = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await nav.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errores.push(`${r.status()} ${r.url().slice(0, 140)}`); });
await p.goto(`${BASE}/login`);
await p.fill('#email', admin.correo);
await p.fill('#password', admin.clave);
await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login')), p.click('button[type=submit]')]);
const desborde = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const pestana = (n) => p.getByRole('tab', { name: n }).click();

console.log('Se llega desde "Más"');
await p.getByRole('button', { name: 'Más' }).click();
await p.getByRole('link', { name: /Factura/ }).click();
await p.waitForURL('**/facturacion');
await p.getByRole('heading', { name: 'Facturación' }).waitFor();
ok('RQ-46', true, 'Facturación se abre desde "Más" en el celular');

console.log('Nueva factura: el receptor se completa desde Clientes al escribir el RUT');
await pestana('+ Nueva');
// Los obligatorios se anuncian "RUT (obligatorio)".
const rut = p.getByLabel(/^RUT\b/);
await rut.waitFor();
// Se escribe el RUT apenas aparece el campo, sin esperar a que baje la lista
// de clientes: como un usuario rápido o un celular lento. Así se encontró la
// carrera (el RUT escrito antes de que llegara la lista no se reconocía nunca).
await rut.fill(rutCliente.replace(/\./g, ''));
await p.getByText('✓ Cliente guardado').waitFor({ timeout: 15000 }).catch(() => {});
// Pedido de Felipe (29-09): con un cliente guardado se ve altiro a quién se factura.
const tarjetaReceptor = (await p.locator('[data-receptor]').innerText().catch(() => '')).replace(/\n+/g, ' · ');
ok('RQ-20', tarjetaReceptor.startsWith('Se factura a') && tarjetaReceptor.includes(nCliente)
  && tarjetaReceptor.includes('Venta de abarrotes') && tarjetaReceptor.includes('Av. Siempre Viva 742, Maipú'),
  'aparece "Se factura a" con razón social, giro y dirección', tarjetaReceptor);
ok('RQ-20', await p.getByLabel('Razón social').count() === 0, 'y los campos quedan plegados');
await p.locator('[data-receptor]').getByRole('button', { name: 'Corregir datos' }).click();
const receptor = {
  razon: await p.getByLabel('Razón social').inputValue(),
  giro: await p.getByLabel('Giro').inputValue(),
  dir: await p.getByLabel('Dirección').inputValue(),
  comuna: await p.getByLabel('Comuna').inputValue(),
};
ok('RQ-20', receptor.razon === nCliente && receptor.giro === 'Venta de abarrotes' && receptor.dir === 'Av. Siempre Viva 742'
  && receptor.comuna === 'Maipú', 'razón social, giro, dirección y comuna se completaron solos', JSON.stringify(receptor));
ok('RQ-20', await p.getByText('✓ Cliente guardado').count() === 1, 'y dice que es un cliente guardado');

console.log('Una línea del catálogo y una libre');
await p.getByRole('button', { name: '+ Del catálogo' }).click();
const dlg = p.getByRole('dialog');
await dlg.getByLabel('Buscar producto del catálogo').fill(nProducto);
const opcion = dlg.getByRole('button', { name: new RegExp(nProducto) });
await opcion.waitFor({ timeout: 15000 });
ok('RQ-46', /En bodega 50/.test(await opcion.innerText()), 'el buscador muestra el stock (una sola bodega, 0032)', (await opcion.innerText()).replace(/\n/g, ' · '));
await opcion.click();
const lineas = p.locator('section[aria-labelledby=t-detalle] > ul > li');
await lineas.nth(0).getByLabel(/^Cantidad/).fill(String(CANT));
await p.getByRole('button', { name: '+ Línea libre' }).click();
await lineas.nth(1).getByLabel('Qué se factura').fill('Flete a domicilio QA');
await lineas.nth(1).getByLabel(/^Precio c\/u/).fill(String(flete));
await p.getByRole('radio', { name: 'Crédito' }).click();
const etiquetas = [await lineas.nth(0).innerText(), await lineas.nth(1).innerText()];
ok('RQ-46', /del catálogo · descuenta stock/.test(etiquetas[0]) && /libre · no mueve stock/.test(etiquetas[1]),
  'cada línea dice si descuenta stock');

console.log('La barra de totales: ajuste del IVA y "Emitir factura" a la vista');
const barra = await p.locator('div.fixed', { has: p.getByRole('button', { name: 'Emitir factura' }) }).innerText();
ok('RQ-46', barra.includes(clp(esperado.total).replace('$', '')) && /Ajuste IVA/.test(barra),
  `el total es ${clp(esperado.total)} (suma ${clp(esperado.total - esperado.ajuste)}) y avisa el ajuste`, barra.replace(/\n+/g, ' · '));
for (const donde of ['arriba', 'al fondo']) {
  if (donde === 'al fondo') await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const med = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Emitir factura');
    const r = b.getBoundingClientRect();
    const encima = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { alto: Math.round(r.height), tapado: !b.contains(encima), por: encima?.textContent?.trim().slice(0, 30) };
  });
  ok('RNF-16', med.alto >= 44 && !med.tapado, `"Emitir factura" mide 44 px o más y nada lo tapa (${donde})`,
    `${med.alto} px${med.tapado ? `, lo tapa «${med.por}»` : ''}`);
}
ok('RNF-16', (await desborde()) <= 1, 'el formulario no se desborda a 360 px', `${await desborde()} px`);
await p.screenshot({ path: 'tools/ui/.capturas/facturacion-nueva-360.png' }).catch(() => {});

console.log('Emitir');
await p.getByRole('button', { name: 'Emitir factura' }).click();
const conf = p.getByRole('dialog');
const textoConf = await conf.innerText();
ok('RQ-46', textoConf.includes(nCliente) && /Descuenta del stock: 3 /.test(textoConf) && /menos que la suma|más que la suma/.test(textoConf),
  'la confirmación dice a quién, cuánto sale del stock y por qué el total no es la suma', textoConf.replace(/\n+/g, ' · ').slice(0, 220));
await conf.getByRole('button', { name: 'Sí, emitir' }).click();
const aviso = p.getByRole('status');
await aviso.waitFor({ timeout: 20000 });
const textoAviso = await aviso.innerText();
const { data: f } = await servicio.from('facturas')
  .select('id, numero, folio, estado, modo, cliente_id, neto, iva, total, forma_pago, factura_lineas(id, product_id, cantidad, monto, linea)')
  .eq('tenant_id', tenant).eq('cliente_id', cliente.id).order('created_at', { ascending: false }).limit(1).single();
ok('RQ-46', f.estado === 'emitida' && f.forma_pago === 'credito' && textoAviso.includes(`N° ${f.folio}`),
  'queda emitida (simulada), a crédito, y el aviso dice su folio', textoAviso);
ok('RQ-46', f.total === esperado.total && f.neto === esperado.neto && f.iva === Math.round(f.neto * 0.19),
  'la base cobra lo mismo que mostró la pantalla, con el IVA calculado sobre el neto', `neto ${f.neto} · IVA ${f.iva} · total ${f.total}`);
const [lc, ll] = [...f.factura_lineas].sort((a, b) => a.linea - b.linea);
ok('RQ-46', lc.product_id === pId && Number(lc.cantidad) === CANT && ll.product_id === null,
  'la línea de catálogo apunta al producto y la libre no');
ok('RQ-20', f.cliente_id === cliente.id, 'la factura quedó asociada al cliente existente (no creó otro)');

console.log('El stock bajó');
ok('RQ-46', (await stockSala()) === STOCK - CANT, `la sala tenía ${STOCK} y quedan ${STOCK - CANT}`, `${await stockSala()}`);
await pestana('+ Nueva');
await p.getByRole('button', { name: '+ Del catálogo' }).click();
await dlg.getByLabel('Buscar producto del catálogo').fill(nProducto);
await opcion.waitFor({ timeout: 15000 });
ok('RQ-46', /En bodega 47/.test(await opcion.innerText()), 'y la pantalla lo muestra: "En bodega 47"', (await opcion.innerText()).replace(/\n/g, ' · '));
await dlg.getByRole('button', { name: 'Cancelar' }).click();

console.log('Nota de crédito parcial: vuelve 1 de 3');
await pestana('Emitidas');
const item = p.locator('li', { hasText: `Factura N° ${f.folio}` });
await item.getByRole('button', { name: 'Nota de crédito' }).click();
const nc = p.getByRole('dialog');
await nc.getByLabel(`Cantidad a devolver de ${nProducto}`).fill('1');
await nc.getByLabel('Motivo').fill('Devolución de mercadería');
const botonNc = nc.getByRole('button', { name: /Emitir nota por lo marcado/ });
const estimado = await botonNc.innerText();
await botonNc.click();
await nc.waitFor({ state: 'detached', timeout: 20000 });
const { data: notas } = await servicio.from('factura_notas_credito').select('monto, neto, iva, es_total, lineas').eq('factura_id', f.id);
// La misma cuenta que fn_nota_credito_factura.
const montoNc = Math.round((1 * lc.monto * f.total) / (CANT * (lc.monto + ll.monto)));
ok('RQ-19', notas.length === 1 && !notas[0].es_total && notas[0].monto === montoNc,
  `una nota parcial por ${clp(montoNc)}, proporcional a lo facturado`, `${notas[0]?.monto} · botón «${estimado}»`);
ok('RQ-19', (await stockSala()) === STOCK - CANT + 1, 'el aceite devuelto volvió a la sala', `${await stockSala()}`);
await item.getByText(/Nota de crédito N° \d+ por/).waitFor({ timeout: 10000 });
ok('RQ-19', true, 'la lista muestra la nota bajo la factura');
ok('RQ-19', await item.getByRole('button', { name: 'Nota de crédito' }).count() === 1,
  'y todavía se puede hacer otra nota por lo que queda');

console.log('Factura recibida: el proveedor se reconoce por su RUT');
await pestana('Recibidas');
await p.getByRole('button', { name: '+ Registrar factura recibida' }).click();
const rec = p.getByRole('dialog');
// Igual que con el cliente: el RUT se escribe antes de que baje la lista.
await rec.getByLabel('RUT del proveedor').fill(rutProveedor.replace(/\./g, ''));
await rec.getByText('✓ Proveedor guardado').waitFor({ timeout: 15000 }).catch(() => {});
const razonProv = await rec.getByLabel('Razón social').inputValue();
ok('RQ-47', razonProv === nProveedor && await rec.getByText('✓ Proveedor guardado').count() === 1,
  'la razón social se completa sola y dice que es un proveedor guardado', razonProv);
const folioRec = 100000 + Math.floor(Math.random() * 800000);
await rec.getByLabel('Folio').fill(String(folioRec));
await rec.getByLabel('Neto').fill('100.000');
ok('RQ-47', (await rec.getByLabel('IVA').inputValue()) === '19000', 'propone el IVA: 19 % del neto');
ok('RNF-16', (await desborde()) <= 1, 'el formulario de la recibida no se desborda', `${await desborde()} px`);
await rec.getByRole('button', { name: 'Registrar' }).click();
await rec.waitFor({ state: 'detached', timeout: 20000 }).catch(async (e) => {
  console.log(`  El diálogo sigue abierto: ${(await rec.innerText()).replace(/\n+/g, ' · ').slice(-200)}`);
  throw e;
});
const { data: recibida } = await servicio.from('facturas_recibidas').select('id, supplier_id, total, iva, estado')
  .eq('tenant_id', tenant).eq('folio', folioRec).single();
ok('RQ-47', recibida.supplier_id === proveedor.id && recibida.total === 119000 && recibida.iva === 19000,
  'quedó registrada contra ese proveedor, por $119.000', JSON.stringify(recibida));
const { count: provs } = await servicio.from('suppliers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant).eq('rut', rutProveedor);
ok('RQ-47', provs === 1, 'no creó un proveedor repetido');
await p.getByText(String(folioRec)).first().waitFor({ timeout: 10000 });

console.log('Resumen del mes');
await pestana('Resumen');
const tarjeta = p.locator('li', { has: p.getByRole('table') }).first();
await tarjeta.waitFor({ timeout: 15000 });
const ventas = await mesEnVista('v_ventas_mensuales');
const compras = await mesEnVista('v_compras_mensuales');
const fila = async (n) => (await tarjeta.getByRole('row', { name: new RegExp(n) }).innerText()).replace(/\s+/g, ' ');
const filaVentas = await fila('Ventas'), filaCompras = await fila('Compras');
ok('RQ-48', Number(ventas.total) - Number(ventasAntes.total) === f.total - montoNc,
  'las ventas del mes suben lo facturado menos la nota', `+${Number(ventas.total) - Number(ventasAntes.total)}`);
ok('RQ-48', Number(compras.total) - Number(comprasAntes.total) === 119000 && Number(compras.iva) - Number(comprasAntes.iva) === 19000,
  'las compras del mes suben $119.000 y el IVA crédito $19.000');
ok('RQ-48', filaVentas.includes(clp(ventas.total).slice(1)) && filaCompras.includes(clp(compras.total).slice(1)),
  'la pantalla muestra lo mismo que la base', `${filaVentas} | ${filaCompras}`);
const pagar = Number(ventas.iva) - Number(compras.iva);
ok('RQ-48', (await tarjeta.innerText()).includes(clp(Math.abs(pagar)).slice(1)),
  `IVA ${pagar >= 0 ? 'a pagar' : 'remanente'}: débito − crédito = ${clp(Math.abs(pagar))}`);
ok('RNF-16', (await desborde()) <= 1, 'el resumen no se desborda a 360 px', `${await desborde()} px`);

console.log('Emisor SII: qué falta para emitir de verdad (0028)');
await pestana('Emisor SII');
const pasos = p.locator('[data-pasos]');
await pasos.waitFor({ timeout: 15000 });
const textoPasos = (await pasos.innerText()).replace(/\n+/g, ' · ');
const { count: conCred } = await servicio.from('sii_credenciales').select('tenant_id', { count: 'exact', head: true }).eq('tenant_id', tenant);
ok('RQ-49', /1\. Datos del emisor · listo/.test(textoPasos) && /3\. Ensayo en el portal, sin firmar · pendiente/.test(textoPasos)
  && (conCred ? true : /2\. Credenciales del SII · pendiente/.test(textoPasos)),
  'la lista dice qué está listo y qué falta, con texto y no solo color', textoPasos.slice(0, 200));
ok('RQ-49', await p.getByRole('button', { name: 'Encender' }).isDisabled(), 'sin ensayo, "Encender" no se puede tocar');
ok('RNF-16', (await desborde()) <= 1, 'Emisor SII no se desborda a 360 px', `${await desborde()} px`);

console.log(`\nErrores de JavaScript o HTTP: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
if (errores.length) ok('RNF', false, 'sin errores de JavaScript ni respuestas 4xx/5xx');
await nav.close();

// La factura y la nota quedan (son inmutables); lo demás se desactiva o anula.
await admin.cli.from('products').update({ is_active: false }).eq('id', pId);
await admin.cli.rpc('fn_guardar_cliente', { p_id: cliente.id, p_datos: { nombre: nCliente, rut: rutCliente, descuento_pct: 0, activo: false } });
await admin.cli.rpc('fn_anular_factura_recibida', { p_id: recibida.id, p_motivo: 'Recorrido QA' });
await servicio.from('suppliers').update({ is_active: false }).eq('id', proveedor.id);

const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-facturacion.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
