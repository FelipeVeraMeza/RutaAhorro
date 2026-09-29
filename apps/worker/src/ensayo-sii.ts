/**
 * Ensayo del robot contra el portal REAL del SII, sin firmar (0028).
 *
 *   npm run ensayo-sii -w @rutaahorro/worker
 *   npm run ensayo-sii -w @rutaahorro/worker -- --ver                 (con la ventana a la vista)
 *   npm run ensayo-sii -w @rutaahorro/worker -- --receptor=76.086.428-5
 *
 * Qué hace: toma las credenciales guardadas en Facturación → Emisor SII, entra
 * al portal, elige la empresa, escribe un receptor y DOS líneas de prueba,
 * aprieta "Validar", lee el total que calculó el portal y lo compara con el
 * de la base. Se detiene ANTES de "Firmar": no se emite nada ni se consume un
 * folio. El resultado queda registrado, y sin un ensayo exitoso con las
 * credenciales vigentes la emisión real no se puede encender.
 *
 * Confirma lo que ninguna prueba local puede: que el portal tiene el botón
 * para la segunda línea y los campos de totales donde el robot los busca
 * (apps/worker/src/sii/modelo-vsv/README.md).
 *
 * Necesita, en el .env.local de la raíz: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SECRET_KEY y la MISMA SII_CLAVE_CIFRADO que tiene la web en
 * Railway (con otra, las claves no se descifran). CHROME_PATH es opcional:
 * por omisión, el Chrome instalado.
 */
import fs from 'node:fs';
import { descifrar, formatRut, isValidRut, montoLinea, planFacturaPortal, resumenFactura } from '@rutaahorro/core';
import { admin } from './supabase.js';
import { env } from './env.js';
import { ensayarEnPortal } from './sii/portal.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ver = process.argv.includes('--ver');

function morir(texto: string): never {
  console.error(`\n✖ ${texto}\n`);
  process.exit(1);
}

const chrome = [env.chromePath, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((r) => r && fs.existsSync(r));
if (!chrome) morir('No se encontró Chrome. Instálalo o define CHROME_PATH.');
if (!env.siiClaveCifrado) morir('Falta SII_CLAVE_CIFRADO (la misma que tiene la web en Railway).');

const { data: todas, error } = await admin.from('sii_credenciales').select('*');
if (error) morir(`No se pudieron leer las credenciales: ${error.message}`);
const local = arg('local');
const lista = (todas ?? []).filter((c) => !local || c.tenant_id === local);
if (lista.length === 0) morir('No hay credenciales guardadas. Guárdalas en Facturación → Emisor SII.');
if (lista.length > 1) morir(`Hay credenciales de ${lista.length} locales: indica cuál con --local=<id>.`);
const cred = lista[0];

const receptor = arg('receptor') ?? cred.rut_empresa;
if (!isValidRut(receptor)) morir(`El RUT del receptor no es válido: ${receptor}`);

// Dos líneas: la segunda es justamente lo que VSV nunca hizo.
const lineas = [
  { nombre: 'ENSAYO RutaAhorro - no se emite', cantidad: 1, precio: 1190 },
  { nombre: 'ENSAYO segunda linea', cantidad: 2, precio: 595 },
];
const r = resumenFactura(lineas);
const plan = planFacturaPortal(lineas.map((l) => ({ ...l, monto: montoLinea(l) })), r.neto, r.iva, r.total);

console.log(`\nEnsayo en el portal del SII — NO se firma ni se emite nada`);
console.log(`  entra ${cred.rut_usuario} · empresa ${cred.rut_empresa} · receptor ${formatRut(receptor)} · total $${plan.total}\n`);

let resultado;
try {
  const [claveSii, claveCertificado] = await Promise.all([
    descifrar(cred.clave_sii, env.siiClaveCifrado), descifrar(cred.clave_certificado, env.siiClaveCifrado)]);
  resultado = await ensayarEnPortal(
    { receptor: { rut: formatRut(receptor), razon_social: '' }, formaPago: 'contado', plan },
    { rutUsuario: cred.rut_usuario, claveSii, claveCertificado, rutEmpresa: cred.rut_empresa },
    { chromePath: chrome, headless: !ver, alPaso: (t) => console.log(`  · ${t}`) },
  );
} catch (e) {
  const mensaje = e instanceof Error ? e.message : String(e);
  await admin.rpc('fn_sii_registrar_ensayo', { p_tenant: cred.tenant_id, p_ok: false, p_detalle: { error: mensaje } });
  morir(`El ensayo no pasó: ${mensaje}`);
}

const { error: eReg } = await admin.rpc('fn_sii_registrar_ensayo', { p_tenant: cred.tenant_id, p_ok: true, p_detalle: {
  total_portal: resultado.totalPortal, lineas: resultado.lineas, razon_social_sii: resultado.razonSocialSii } });
if (eReg) morir(`El ensayo pasó, pero no se pudo registrar: ${eReg.message}`);
console.log(`\n✔ El ensayo pasó: el portal reconoció a «${resultado.razonSocialSii}», aceptó ${resultado.lineas} líneas`
  + ` y calculó $${resultado.totalPortal}, igual que la base. No se firmó.`);
console.log('  Ya se puede encender la emisión real en Facturación → Emisor SII.\n');
process.exit(0);
