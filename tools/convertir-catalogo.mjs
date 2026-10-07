/**
 * Convierte el catálogo exportado del sistema anterior (columnas "Descripción",
 * "ID interno", "SKU", "Precio de Venta Neto", "Impuesto Adicional"…) a la
 * plantilla de Productos → Importar.
 *
 *   node tools/convertir-catalogo.mjs catalogo.xlsx      (o .csv / .txt copiado de Excel)
 *   node tools/convertir-catalogo.mjs catalogo.txt --existentes=catalogo-2026-10-07.csv
 *
 * Con --existentes (lo que baja Productos → Exportar) quedan fuera los
 * productos que el local ya cargó: si el código de barras coincide, el
 * importador los actualizaría con el nombre y el precio del sistema anterior,
 * y "Galleta bon o bon blanco 95g" pasaría a "BON O BON BLANCO COOKIES". Los
 * que se parecen por nombre pero no tienen el código se listan para revisar:
 * pueden quedar duplicados.
 *
 * Deja al lado `<nombre>-para-importar.csv` y `<nombre>-informe.txt`. No toca
 * la base: el archivo se sube en Productos → Importar, que muestra la vista
 * previa y, si un código de barras ya existe, actualiza ese producto en vez
 * de duplicarlo.
 *
 * Reglas (Felipe, 2026-10-07):
 *   · El precio del sistema anterior es NETO: se le suma el IVA (19 %) y se
 *     sube a la decena: 1.218 → 1.449,42 → $1.450. En las bebidas el IABA va
 *     INCLUIDO en ese precio, no encima: la bebida de 3 L queda en $1.990 y
 *     el sistema separa el impuesto en la boleta y la factura (el local,
 *     2026-10-07: "debe quedar final a 1990"). La tasa del art. 42 letra a)
 *     —10 %, o 18 % si dice "párrafo 2°"— solo arma la lista para asignarles
 *     el impuesto después de importar.
 *   · Precio 0 o 1 (relleno del sistema anterior) → $0, para ponérselo después.
 *   · SKU = el "ID interno": único y estable, para volver a importar sin duplicar.
 *   · Código de barras: solo si parece uno de verdad (8 a 14 dígitos, con su
 *     dígito de control bien si es EAN/UPC, y no "11111111"). Los códigos
 *     internos (AC0021, I- 2077) van a la descripción. Un código repetido
 *     queda en el primer producto: el importador rechaza el archivo entero si
 *     dos filas comparten código.
 *   · Todo por unidad, stock 0 y sin costo: lo real entra con el conteo y las
 *     recepciones.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IVA = 0.19;
/** Nombres de bebidas analcohólicas que pagan IABA. Solo para avisar: la tasa no se adivina. */
const BEBIDA = /\b(PET\s*\d|COCA|PEPSI|SPRITE|FANTA|INCA KOLA|BILZ|PAP|KEM|7UP|SEVEN UP|CANADA DRY|CRUSH|LIMON SODA|GINGER|MONSTER|ROCKSTAR|RED\s?BULL|SCORE|GARRA|ENERGY|GATORADE|CACHANTUN|AGUA|N[EÉ]CTAR|JUGO|WATT?S|LIVEAN|ALOE VERA|LOVE LEMON|BEBIDA)\b/i;

/** Dígito de control EAN/UPC/GTIN (módulo 10, pesos 3 y 1 desde la derecha). */
function digitoControlOk(c) {
  let suma = 0;
  for (let i = c.length - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) suma += Number(c[i]) * peso;
  return (10 - (suma % 10)) % 10 === Number(c[c.length - 1]);
}

/** null si no es un código de barras usable; si no, el código (12 dígitos → 13 con 0, como el sistema). */
export function codigoDeBarras(bruto) {
  const c = String(bruto ?? '').replace(/\s+/g, '');
  if (!/^\d{8,14}$/.test(c)) return null;
  if (/^(\d)\1+$/.test(c)) return null; // 11111111, 2222222222
  if (!digitoControlOk(c)) return null;
  return c.length === 12 ? `0${c}` : c;
}

/** "1.672,26" o "1672,26" o "1672.26" → 1672.26. Vacío o ilegible → null. */
export function leerNeto(bruto) {
  const t = String(bruto ?? '').trim().replace(/\s/g, '');
  if (t === '') return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}

/** Tasa del IABA según el texto de "Impuesto Adicional". */
export function tasaAdicional(texto) {
  const t = String(texto ?? '').toUpperCase();
  if (!t.includes('ART. 42')) return 0;
  return /P[AÁ]RRAFO\s*2/.test(t) ? 0.18 : 0.10;
}

/** Neto → precio al público: con IVA y subido a la decena. El IABA va incluido, no se suma. */
export function precioPublico(neto) {
  if (neto == null || neto <= 1) return 0;
  // A centavos primero: 1000 × 1,19 da 1190,0000000000002 y subiría a 1.200.
  const conImpuestos = Math.round(neto * (1 + IVA) * 100) / 100;
  return Math.ceil(conImpuestos / 10 - 1e-9) * 10;
}

function limpiarNombre(bruto, codigo) {
  let n = String(bruto ?? '').replace(/["\t]/g, ' ').replace(/\s+/g, ' ').trim();
  // "106030105921   TAPA CARTON C10": el código pegado al inicio del nombre.
  const c = String(codigo ?? '').trim();
  if (c && n.toUpperCase().startsWith(c.toUpperCase() + ' ')) n = n.slice(c.length).trim();
  return n;
}

/** Divide una línea respetando comillas (Excel cita los campos con tabulaciones dentro). */
function dividir(linea, sep) {
  const out = [];
  let campo = '', comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (comillas) {
      if (ch === '"' && linea[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"' && campo.trim() === '') { comillas = true; campo = ''; }
    else if (ch === sep) { out.push(campo); campo = ''; }
    else campo += ch;
  }
  out.push(campo);
  return out;
}

export function leerTexto(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const sep = lineas[0].includes('\t') ? '\t' : lineas[0].includes(';') ? ';' : ',';
  return lineas.map((l) => dividir(l, sep));
}

// ------------------------------------------------- productos ya cargados
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'y', 'sabor', 'a', 'en', 'x',
  'g', 'gr', 'grs', 'gramos', 'kg', 'k', 'kilo', 'ml', 'cc', 'l', 'lt', 'lts', 'litro', 'un', 'u', 'unidades']);

/** "Galleta bon o bon blanco 95g" → {galleta, bon, blanco, 95}: para comparar nombres escritos distinto. */
export function palabrasDe(nombre) {
  return new Set(String(nombre ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')
    .split(/[^a-z0-9ñ]+/).filter((p) => p.length > 1 && !PALABRAS_VACIAS.has(p) || /^\d+$/.test(p)));
}

/** Cuánto se parecen dos nombres: palabras en común sobre las del más corto (0 a 1). */
export function parecido(a, b) {
  const pa = palabrasDe(a), pb = palabrasDe(b);
  if (!pa.size || !pb.size) return 0;
  let comunes = 0;
  for (const x of pa) if (pb.has(x)) comunes++;
  return comunes / Math.min(pa.size, pb.size);
}

/** El CSV de Productos → Exportar → [{ nombre, codigos }]. */
export function leerExistentes(filas) {
  const enc = filas[0].map((h) => h.trim().toLowerCase());
  const iNombre = enc.indexOf('nombre'), iCodigos = enc.indexOf('codigos_de_barra');
  if (iNombre < 0) throw new Error('El archivo de existentes no es el que baja Productos → Exportar (falta "nombre")');
  return filas.slice(1).filter((f) => String(f[iNombre] ?? '').trim()).map((f) => ({
    nombre: String(f[iNombre]).trim(),
    codigos: iCodigos < 0 ? [] : String(f[iCodigos] ?? '').split(/\s+/).map((c) => codigoDeBarras(c) ?? c).filter(Boolean),
  }));
}

const csv = (v) => (/[;"\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** Filas de la planilla anterior (con encabezado) → CSV para importar + informe. */
export function convertirCatalogo(filas, existentes = []) {
  const yaCargados = new Map();
  for (const e of existentes) for (const c of e.codigos) yaCargados.set(c, e.nombre);
  const enc = filas[0].map((h) => h.trim().toLowerCase());
  const col = (nombre) => {
    const i = enc.indexOf(nombre.toLowerCase());
    if (i < 0) throw new Error(`Falta la columna "${nombre}". Encabezados: ${filas[0].join(' | ')}`);
    return i;
  };
  const iNombre = col('Descripción'), iId = col('ID interno'), iSku = col('SKU'), iPrecio = col('Precio de Venta Neto');
  const iImp = enc.indexOf('impuesto adicional');

  const salida = [['nombre', 'descripcion', 'sku', 'codigo_barras', 'categoria', 'precio_venta', 'costo', 'unidad',
    'stock_inicial', 'stock_minimo', 'perecible', 'dias_alerta'].join(';')];
  const inf = { total: 0, sinPrecio: [], codigoInterno: [], codigoMalo: [], codigoRepetido: [], nombreRepetido: [],
    iaba10: [], iaba18: [], bebidaSinImpuesto: [], revisarPrecio: [], idRepetido: [], yaCargado: [], posibleDuplicado: [] };
  const codigos = new Map(), nombres = new Map(), ids = new Set();

  for (const f of filas.slice(1)) {
    const id = String(f[iId] ?? '').trim();
    const crudo = String(f[iSku] ?? '').trim();
    const nombre = limpiarNombre(f[iNombre], crudo);
    if (!nombre && !id) continue;
    inf.total++;
    if (ids.has(id)) { inf.idRepetido.push(`${id} ${nombre}`); continue; }
    ids.add(id);

    const neto = leerNeto(f[iPrecio]);
    const tasa = iImp >= 0 ? tasaAdicional(f[iImp]) : 0;
    const precio = precioPublico(neto);
    const etiqueta = `${nombre} (ID ${id})`;
    if (precio === 0) inf.sinPrecio.push(etiqueta);
    if (precio >= 15000) inf.revisarPrecio.push(`${etiqueta}: neto ${neto} → $${precio.toLocaleString('es-CL')}`);
    if (tasa === 0.18) inf.iaba18.push(etiqueta);
    if (tasa === 0.10) inf.iaba10.push(etiqueta);
    // El sistema anterior no marcaba el impuesto en todas las bebidas: una
    // Coca-Cola sin él queda con solo IVA y se vende más barata de lo que debe.
    if (tasa === 0 && precio > 0 && BEBIDA.test(nombre) && !/\b(ATUN|GALLETA|MERMELADA)\b/i.test(nombre)) inf.bebidaSinImpuesto.push(`${etiqueta}: $${precio.toLocaleString('es-CL')}`);

    // Ya está en el local con ese código: se deja como lo cargaron (nombre y precio).
    const cYa = codigoDeBarras(crudo);
    if (cYa && yaCargados.has(cYa)) {
      inf.yaCargado.push(`${etiqueta} = "${yaCargados.get(cYa)}" (${cYa})`);
      continue;
    }
    const parecidos = existentes.filter((e) => parecido(e.nombre, nombre) >= 0.6);
    if (parecidos.length) inf.posibleDuplicado.push(`${etiqueta} ≈ ${parecidos.map((e) => `"${e.nombre}"`).join(', ')}`);

    let codigo = null, descripcion = '';
    if (crudo) {
      const c = codigoDeBarras(crudo);
      if (c && codigos.has(c)) {
        inf.codigoRepetido.push(`${etiqueta}: ${c} ya es de "${codigos.get(c)}"`);
      } else if (c) {
        codigo = c;
        codigos.set(c, nombre);
      } else if (/^\d{8,14}$/.test(crudo.replace(/\s+/g, '')) && !/^(\d)\1+$/.test(crudo.replace(/\s+/g, ''))) {
        inf.codigoMalo.push(`${etiqueta}: ${crudo} (el dígito de control no cuadra: revisa el envase)`);
      } else {
        descripcion = `Código anterior: ${crudo}`;
        inf.codigoInterno.push(`${etiqueta}: ${crudo}`);
      }
    }

    const clave = nombre.toLowerCase();
    if (nombres.has(clave)) inf.nombreRepetido.push(`${etiqueta} se llama igual que el ID ${nombres.get(clave)}`);
    else nombres.set(clave, id);

    salida.push([nombre, descripcion, id, codigo ?? '', '', precio, '', 'unidad', 0, '', 'no', ''].map(csv).join(';'));
  }

  const lista = (titulo, xs, nota = '') => (xs.length ? `\n## ${titulo} (${xs.length})${nota ? `\n${nota}` : ''}\n${xs.map((x) => `  · ${x}`).join('\n')}\n` : '');
  const informe = `Catálogo convertido: ${salida.length - 1} productos de ${inf.total} filas.\n`
    + lista('Ya cargados en el local: quedan fuera (conservan su nombre y precio)', inf.yaCargado)
    + lista('Se parecen a uno ya cargado que no tiene ese código: pueden quedar duplicados', inf.posibleDuplicado,
      'Si es el mismo, agrégale el código al producto que ya existe (Productos → Editar) antes de importar, o bórralo de este archivo.')
    + lista('Sin precio: quedan en $0', inf.sinPrecio, 'Venían con precio 0 o 1. Ponles precio antes de venderlos.')
    + lista('IABA 18 % (bebidas con alto azúcar)', inf.iaba18, 'El precio final ya lo incluye. Después de importar: Configuración → Impuestos → "IABA bebidas con alto azúcar" → Elegir productos.')
    + lista('IABA 10 % (bebidas sin azúcar añadida)', inf.iaba10, 'Igual, con "IABA bebidas sin azúcar añadida".')
    + lista('Bebidas sin el IABA marcado en el sistema anterior', inf.bebidaSinImpuesto,
      'El precio no cambia. Revisa cuáles pagan IABA (azucaradas 18 %, sin azúcar 10 %; el agua no) y asígnales el impuesto en Configuración → Impuestos, para que la boleta y la factura lo separen.')
    + lista('Precios altos para revisar', inf.revisarPrecio, 'Puede ser un precio por caja, o una coma que faltó (BILZ 3L venía en 16722).')
    + lista('Código de barras repetido: quedó solo en el primero', inf.codigoRepetido)
    + lista('Código con el dígito de control malo: no se cargó', inf.codigoMalo)
    + lista('Código interno (no es de barras): va en la descripción', inf.codigoInterno)
    + lista('Nombre repetido (son productos distintos con el mismo nombre)', inf.nombreRepetido)
    + lista('ID interno repetido: se omitió la segunda fila', inf.idRepetido);
  return { csv: '﻿' + salida.join('\r\n') + '\r\n', informe, inf };
}

// ----------------------------------------------------------------- consola
const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const archivo = process.argv[2];
  if (!archivo || !fs.existsSync(archivo)) {
    console.error('\nUso: node tools/convertir-catalogo.mjs <catalogo.xlsx | .csv | .txt>\n');
    process.exit(1);
  }
  let filas;
  if (/\.xlsx$/i.test(archivo)) {
    const { leerXlsx } = await import('../packages/core/dist/index.js');
    filas = (await leerXlsx(new Uint8Array(fs.readFileSync(archivo)))).filas;
  } else {
    filas = leerTexto(fs.readFileSync(archivo, 'utf8'));
  }
  const rutaExistentes = process.argv.find((a) => a.startsWith('--existentes='))?.slice('--existentes='.length);
  const existentes = rutaExistentes ? leerExistentes(leerTexto(fs.readFileSync(rutaExistentes, 'utf8'))) : [];
  if (rutaExistentes) console.log(`\nYa cargados en el local: ${existentes.length} productos (${rutaExistentes})`);
  const { csv: salida, informe } = convertirCatalogo(filas, existentes);
  const base = archivo.replace(/\.[^.]+$/, '');
  fs.writeFileSync(`${base}-para-importar.csv`, salida);
  fs.writeFileSync(`${base}-informe.txt`, informe);
  console.log(`\n${informe.split('\n')[0]}`);
  console.log(`  → ${base}-para-importar.csv  (súbelo en Productos → Importar)`);
  console.log(`  → ${base}-informe.txt        (qué cambió y qué revisar)\n`);
}
