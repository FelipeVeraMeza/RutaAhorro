/**
 * Ensayo del robot contra el portal REAL del SII, sin firmar (0028).
 *
 *   npm run ensayo-sii -w @rutaahorro/worker
 *   npm run ensayo-sii -w @rutaahorro/worker -- --ver                 (con la ventana a la vista)
 *   npm run ensayo-sii -w @rutaahorro/worker -- --receptor=76.086.428-5
 *   npm run ensayo-sii -w @rutaahorro/worker -- --desde-env --hasta-firma --ver --capturas=../../tmp/ensayo
 *
 * Qué hace: toma las credenciales guardadas en Facturación → Emisor SII, entra
 * al portal, elige la empresa, escribe un receptor y DOS líneas de prueba,
 * aprieta "Validar", lee el total que calculó el portal y lo compara con el
 * de la base. Se detiene ANTES de "Firmar": no se emite nada ni se consume un
 * folio. El resultado queda registrado, y sin un ensayo exitoso con las
 * credenciales vigentes la emisión real no se puede encender.
 *
 * Opciones:
 *   --desde-env     las credenciales salen de .env.local (SII_RUT, SII_CLAVE y,
 *                   si la clave maneja varias empresas, SII_RUT_EMPRESA; ciudad
 *                   en SII_CIUDAD) y no de la base. No registra el ensayo: sirve
 *                   para probar el portal antes de guardar nada en producción.
 *   --hasta-firma   aprieta "Firmar" para comprobar que abre el cuadro de la
 *                   clave del certificado. NO escribe esa clave ni confirma:
 *                   el documento se emite recién con el botón del cuadro.
 *   --capturas=dir  guarda captura y campos de cada pantalla.
 *   --forma-pago=contado|credito|sin_costo   (por omisión, crédito)
 *   --contacto=...  contacto del receptor.
 *   --lineas="Pan amasado:3:1500;Bebida:2:1990"   productos: nombre:cantidad:precio con IVA.
 *   --pausa=60      deja la vista previa del documento a la vista 60 s antes de salir (con --ver).
 *
 * Confirma lo que ninguna prueba local puede: que el portal tiene el botón
 * para la segunda línea y los campos de totales donde el robot los busca
 * (apps/worker/src/sii/modelo-vsv/README.md).
 *
 * Necesita, en el .env.local de la raíz: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SECRET_KEY y (sin --desde-env) la MISMA SII_CLAVE_CIFRADO que tiene
 * la web en Railway (con otra, las claves no se descifran). CHROME_PATH es
 * opcional: por omisión, el Chrome instalado.
 */
import fs from 'node:fs';
import path from 'node:path';
import { descifrar, formatRut, isValidRut, montoLinea, planFacturaPortal, resumenFactura } from '@rutaahorro/core';
import { admin } from './supabase.js';
import { env } from './env.js';
import { ensayarEnPortal, type CredencialesSii } from './sii/portal.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ver = process.argv.includes('--ver');
const desdeEnv = process.argv.includes('--desde-env');
const hastaFirma = process.argv.includes('--hasta-firma');
const capturas = arg('capturas') ? path.resolve(arg('capturas')!) : undefined;
const formaPago = (arg('forma-pago') ?? 'credito') as 'contado' | 'credito' | 'sin_costo';
if (!['contado', 'credito', 'sin_costo'].includes(formaPago)) morir(`--forma-pago no válida: ${formaPago}`);

function morir(texto: string): never {
  console.error(`\n✖ ${texto}\n`);
  process.exit(1);
}

const chrome = [env.chromePath, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((r) => r && fs.existsSync(r));
if (!chrome) morir('No se encontró Chrome. Instálalo o define CHROME_PATH.');

/** Las credenciales y lo que hace falta para registrar el ensayo (null con --desde-env). */
async function credenciales(): Promise<{ cred: CredencialesSii; ciudad: string | null; tenant: string | null }> {
  if (desdeEnv) {
    const { SII_RUT, SII_CLAVE, SII_RUT_EMPRESA, SII_CIUDAD, SII_CLAVE_CERTIFICADO } = process.env;
    if (!SII_RUT || !SII_CLAVE) morir('Con --desde-env faltan SII_RUT y SII_CLAVE en .env.local.');
    if (!isValidRut(SII_RUT)) morir(`SII_RUT no es un RUT válido: ${SII_RUT}`);
    return {
      cred: { rutUsuario: formatRut(SII_RUT), claveSii: SII_CLAVE, claveCertificado: SII_CLAVE_CERTIFICADO ?? '', rutEmpresa: SII_RUT_EMPRESA || null },
      ciudad: SII_CIUDAD || 'Santiago',
      tenant: null,
    };
  }
  if (!env.siiClaveCifrado) morir('Falta SII_CLAVE_CIFRADO (la misma que tiene la web en Railway).');
  const { data: todas, error } = await admin.from('sii_credenciales').select('*');
  if (error) morir(`No se pudieron leer las credenciales: ${error.message}`);
  const local = arg('local');
  const lista = (todas ?? []).filter((c) => !local || c.tenant_id === local);
  if (lista.length === 0) morir('No hay credenciales guardadas. Guárdalas en Facturación → Emisor SII.');
  if (lista.length > 1) morir(`Hay credenciales de ${lista.length} locales: indica cuál con --local=<id>.`);
  const c = lista[0];
  const [claveSii, claveCertificado] = await Promise.all([
    descifrar(c.clave_sii, env.siiClaveCifrado), descifrar(c.clave_certificado, env.siiClaveCifrado)]);
  return { cred: { rutUsuario: c.rut_usuario, claveSii, claveCertificado, rutEmpresa: c.rut_empresa }, ciudad: c.ciudad, tenant: c.tenant_id };
}

const { cred, ciudad, tenant } = await credenciales();
const registrar = async (ok: boolean, detalle: Record<string, unknown>) =>
  tenant ? admin.rpc('fn_sii_registrar_ensayo', { p_tenant: tenant, p_ok: ok, p_detalle: detalle }) : { error: null };

// Sin --receptor, la factura de ensayo va a la propia empresa (o a la persona, si no se guardó empresa: 0037).
const receptor = arg('receptor') ?? cred.rutEmpresa ?? cred.rutUsuario;
if (!isValidRut(receptor)) morir(`El RUT del receptor no es válido: ${receptor}`);

// --lineas="Pan amasado:3:1500;Bebida 1,5 L:2:1990" → nombre:cantidad:precio CON IVA (como en el POS).
// Sin --lineas, dos líneas de ensayo: la segunda es justamente lo que VSV nunca hizo.
function leerLineas(texto: string) {
  return texto.split(';').map((t) => t.trim()).filter(Boolean).map((t) => {
    const partes = t.split(':');
    const precio = Number(partes.pop()?.replace(/[^\d]/g, ''));
    const cantidad = Number(partes.pop()?.replace(',', '.'));
    const nombre = partes.join(':').trim();
    if (!nombre || !(cantidad > 0) || !(precio > 0)) morir(`Línea mal escrita: "${t}". Formato: nombre:cantidad:precio`);
    return { nombre, cantidad, precio };
  });
}
const lineas = arg('lineas') ? leerLineas(arg('lineas')!) : [
  { nombre: 'ENSAYO RutaAhorro - no se emite', cantidad: 1, precio: 1190 },
  { nombre: 'ENSAYO segunda linea', cantidad: 2, precio: 595 },
];
const r = resumenFactura(lineas);
const plan = planFacturaPortal(lineas.map((l) => ({ ...l, monto: montoLinea(l) })), r.neto, r.iva, r.total);

console.log(`\nEnsayo en el portal del SII — NO se firma ni se emite nada${hastaFirma ? ' (llega hasta el cuadro de la firma, sin escribir la clave)' : ''}`);
console.log(`  entra ${cred.rutUsuario} · empresa ${cred.rutEmpresa ?? '(la única de la clave)'} · ciudad ${ciudad ?? '?'} · receptor ${formatRut(receptor)} · ${formaPago} · total $${plan.total}\n`);

let resultado;
try {
  resultado = await ensayarEnPortal(
    { receptor: { rut: formatRut(receptor), razon_social: '', ciudad: arg('ciudad-receptor') ?? ciudad, contacto: arg('contacto') },
      ciudadEmisor: ciudad, telefonoEmisor: arg('telefono') ?? process.env.SII_TELEFONO, formaPago, plan },
    cred,
    { chromePath: chrome, headless: !ver, hastaFirma, capturas, alPaso: (t) => console.log(`  · ${t}`),
      pausaVistaPreviaMs: Number(arg('pausa') ?? 0) * 1000 },
  );
} catch (e) {
  const mensaje = e instanceof Error ? e.message : String(e);
  await registrar(false, { error: mensaje });
  morir(`El ensayo no pasó: ${mensaje}${capturas ? `\n  Capturas en ${capturas}` : ''}`);
}

const { error: eReg } = await registrar(true, {
  total_portal: resultado.totalPortal, lineas: resultado.lineas, razon_social_sii: resultado.razonSocialSii });
if (eReg) morir(`El ensayo pasó, pero no se pudo registrar: ${eReg.message}`);
console.log(`\n✔ El ensayo pasó: el portal reconoció a «${resultado.razonSocialSii}», aceptó ${resultado.lineas} líneas`
  + ` y calculó $${resultado.totalPortal}, igual que la base. No se firmó. Se cerró la sesión del SII.`);
if (capturas) console.log(`  Capturas en ${capturas}`);
console.log(tenant ? '  Ya se puede encender la emisión real en Facturación → Emisor SII.\n'
  : '  (--desde-env: no quedó registrado; para encender la emisión, guarda las claves y corre el ensayo sin --desde-env.)\n');
process.exit(0);
