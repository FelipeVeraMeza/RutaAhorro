/**
 * Completa las fotos de los productos a partir de su código de barras.
 *
 *   npm run db:fotos                 -> dice cuántas encontraría, sin tocar nada
 *   npm run db:fotos -- --aplicar    -> las copia a Storage y las deja en el producto
 *
 * Opciones: --local=<tenant_id> (por omisión TIENDA_TENANT_ID), --limite=N.
 *
 * Para qué existe (docs/30): la tienda online muestra cada producto con su
 * foto y el catálogo no tenía ninguna. Open Food Facts, una base pública,
 * tiene la de ~16 % de los productos (los de marcas grandes). El resto se
 * saca con el celular desde Productos → Editar → Foto.
 *
 * Solo toca productos activos SIN foto: nunca pisa una que alguien subió.
 * Copia la imagen al bucket `productos` (no enlaza a Open Food Facts: si allá
 * la cambian, la tienda no se rompe). El archivo lleva `-off-` en el nombre:
 * la tienda cita la fuente al pie, porque esas fotos son CC BY-SA.
 *
 * Open Food Facts pide no pasar de ~100 consultas por minuto: se espera
 * 900 ms entre una y otra (568 códigos ≈ 9 minutos), y ante un 429 se espera.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { leerFichaPorCodigo, urlFichaPorCodigo, fotoCopiable } from '@rutaahorro/core';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(raiz, '.env.local') });

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const APLICAR = process.argv.includes('--aplicar');
const LOCAL = arg('local') ?? process.env.TIENDA_TENANT_ID;
const LIMITE = Number(arg('limite') ?? Infinity);
const BUCKET = 'productos';
const ESPERA_MS = 900;
const UA = `RutaAhorro/0.1 (${process.env.NEXT_PUBLIC_APP_URL ?? 'sistema de un almacén'})`;
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const secreto = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !secreto) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY en .env.local');
  process.exit(1);
}
if (!LOCAL) {
  console.error('Falta el local: --local=<tenant_id> o TIENDA_TENANT_ID en .env.local');
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, secreto, { auth: { persistSession: false } });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function productosSinFoto() {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from('products')
      .select('id, name, product_barcodes(barcode)')
      .eq('tenant_id', LOCAL).eq('is_active', true).is('image_url', null)
      .order('name').range(desde, desde + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) break;
  }
  return filas
    .map((p) => ({ id: p.id, nombre: p.name, codigos: p.product_barcodes.map((b) => b.barcode).filter((c) => /^\d{8,14}$/.test(c)) }))
    .filter((p) => p.codigos.length);
}

async function asegurarBucket() {
  const { data } = await db.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await db.storage.createBucket(BUCKET, {
    public: true, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: Object.keys(TIPOS),
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

/**
 * La ficha del código. Con 429 (demasiadas consultas) espera y reintenta: si
 * no, un bloqueo pasajero dejaba como "sin ficha" productos que sí tenían.
 */
async function ficha(codigo) {
  for (let intento = 1; ; intento++) {
    const r = await fetch(urlFichaPorCodigo(codigo), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    if (r.status === 429 && intento <= 4) {
      console.log(`   … Open Food Facts pidió esperar (429), reintento ${intento} en 30 s`);
      await dormir(30_000);
      continue;
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Open Food Facts respondió ${r.status}`);
    return leerFichaPorCodigo(await r.json());
  }
}

async function copiarFoto(producto, url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`descarga ${r.status}`);
  const tipo = (r.headers.get('content-type') ?? '').split(';')[0];
  const ext = TIPOS[tipo];
  if (!ext) throw new Error(`formato ${tipo}`);
  const bytes = await r.arrayBuffer();
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('pesa más de 5 MB');
  const ruta = `${LOCAL}/${producto.id}-off-${Date.now()}.${ext}`;
  const { error: e1 } = await db.storage.from(BUCKET).upload(ruta, bytes, { contentType: tipo, cacheControl: '31536000' });
  if (e1) throw e1;
  const publica = db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
  // `is image_url null`: si alguien subió una foto mientras esto corría, gana la suya.
  const { data, error: e2 } = await db.from('products').update({ image_url: publica })
    .eq('id', producto.id).eq('tenant_id', LOCAL).is('image_url', null).select('id');
  if (e2 || !data?.length) {
    await db.storage.from(BUCKET).remove([ruta]);
    if (e2) throw e2;
    return false;
  }
  return true;
}

const productos = (await productosSinFoto()).slice(0, LIMITE);
console.log(`${productos.length} productos activos sin foto y con código de barras. ${APLICAR ? 'Copiando fotos…' : 'Solo revisando (agrega --aplicar para guardar).'}\n`);
if (APLICAR) await asegurarBucket();

let conFoto = 0, guardadas = 0, sinFicha = 0, fallas = 0, sinRespuesta = 0;
for (const [i, p] of productos.entries()) {
  let encontrada = null;
  let fallo = false;
  for (const c of p.codigos) {
    try { encontrada = await ficha(c); } catch (e) { encontrada = null; fallo = true; console.log(`   ✖ ${p.nombre}: ${e.message}`); }
    await dormir(ESPERA_MS);
    if (encontrada?.imagen && fotoCopiable(encontrada.imagen)) break;
    encontrada = null;
  }
  const n = `[${String(i + 1).padStart(3)}/${productos.length}]`;
  if (!encontrada) { if (fallo) sinRespuesta++; else sinFicha++; continue; }
  conFoto++;
  if (!APLICAR) { console.log(`${n} 📷 ${p.nombre}  ←  ${encontrada.nombre}`); continue; }
  try {
    if (await copiarFoto(p, encontrada.imagen)) { guardadas++; console.log(`${n} ✓ ${p.nombre}  ←  ${encontrada.nombre}`); }
    else console.log(`${n} · ${p.nombre}: ya tenía foto, no se tocó`);
  } catch (e) {
    fallas++;
    console.log(`${n} ✖ ${p.nombre}: ${e.message}`);
  }
}

console.log(`\nCon foto en Open Food Facts: ${conFoto} de ${productos.length}. Sin ficha: ${sinFicha}.`);
if (sinRespuesta) console.log(`Sin respuesta: ${sinRespuesta}. Vuelve a correrlo: solo toma los que siguen sin foto.`);
if (APLICAR) console.log(`Guardadas: ${guardadas}. Fallas: ${fallas}.`);
