/**
 * Carga masiva de productos (RF-M2-11, RF-M2-12).
 *
 * Regla central: **o se carga el archivo completo, o no se carga nada.**
 * Una carga parcial deja al cliente sin saber qué quedó dentro y qué no, y
 * obliga a revisar 800 productos a mano para averiguarlo. Por eso se valida
 * todo primero y recién después se aplica.
 *
 * Esta función es pura: no toca red ni base de datos. Es la que se prueba.
 */
import { isValidEan, normalizeBarcode } from './barcode.js';
import { clp } from './money.js';

export interface FilaProducto {
  nombre: string;
  sku: string | null;
  codigo_barras: string | null;
  categoria: string | null;
  precio_venta: number;
  costo: number;
  unidad: string;
  stock_inicial: number;
  stock_minimo: number;
  perecible: boolean;
  dias_alerta: number;
}

export interface ErrorFila {
  /** Número de fila como lo ve el usuario en Excel: la 1 es el encabezado. */
  fila: number;
  columna: string;
  mensaje: string;
  valor: string;
}

export interface ResultadoImportacion {
  ok: boolean;
  filas: FilaProducto[];
  errores: ErrorFila[];
  /** Advertencias que no impiden cargar. */
  avisos: ErrorFila[];
  totalFilas: number;
}

/** Columnas de la plantilla. El orden no importa; los nombres sí. */
export const COLUMNAS = [
  'nombre', 'sku', 'codigo_barras', 'categoria', 'precio_venta',
  'costo', 'unidad', 'stock_inicial', 'stock_minimo', 'perecible', 'dias_alerta',
] as const;

export const COLUMNAS_OBLIGATORIAS = ['nombre', 'precio_venta'] as const;

export const UNIDADES_VALIDAS = ['unidad', 'kg', 'gramo', 'litro', 'ml', 'paquete', 'caja'];

/**
 * Divide una línea CSV respetando comillas.
 * Excel en Chile exporta con punto y coma, no con coma: hay que soportar ambos.
 */
export function partirLinea(linea: string, separador: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let enComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      // Comilla doble escapada dentro de un campo entrecomillado
      if (enComillas && linea[i + 1] === '"') { actual += '"'; i++; }
      else enComillas = !enComillas;
    } else if (c === separador && !enComillas) {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map((c) => c.trim());
}

/** Detecta si el archivo usa coma o punto y coma como separador. */
export function detectarSeparador(texto: string): string {
  const primera = texto.split(/\r?\n/)[0] ?? '';
  const puntoYComa = (primera.match(/;/g) ?? []).length;
  const coma = (primera.match(/,/g) ?? []).length;
  return puntoYComa > coma ? ';' : ',';
}

/**
 * Lee un número escrito como lo escribe una persona en Chile:
 * "1.990" son mil novecientos noventa, no 1,99.
 */
export function leerNumero(valor: string): number | null {
  const limpio = String(valor ?? '').trim();
  if (limpio === '') return null;

  // Se acepta solo: signo opcional, símbolo de moneda opcional y dígitos con
  // separadores . y , — cualquier letra invalida el valor.
  //
  // Esta verificación no es cosmética: sin ella, "mil pesos" quedaba en 0
  // (porque al quitar las letras queda "" y Number("") es 0) y el producto se
  // habría cargado con precio cero en vez de rechazarse. Lo detectó una prueba.
  if (!/^-?\s*\$?\s*\d[\d.,]*$/.test(limpio)) return null;

  const sinMoneda = limpio.replace(/[\s$]/g, '');

  // Si tiene coma decimal (formato chileno: 1.234,56), la coma manda
  const normalizado = sinMoneda.includes(',')
    ? sinMoneda.replace(/\./g, '').replace(',', '.')
    : sinMoneda.replace(/\.(?=\d{3}(\D|$))/g, ''); // puntos de miles

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function leerBooleano(valor: string): boolean {
  const v = String(valor ?? '').trim().toLowerCase();
  return ['si', 'sí', 'true', '1', 'x', 'verdadero'].includes(v);
}

/**
 * Valida y convierte el contenido de un CSV.
 * Nunca lanza excepciones: devuelve los errores para mostrárselos al usuario.
 */
export function parsearProductos(texto: string): ResultadoImportacion {
  const errores: ErrorFila[] = [];
  const avisos: ErrorFila[] = [];
  const filas: FilaProducto[] = [];

  const sinBom = texto.replace(/^﻿/, '');
  const lineas = sinBom.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (lineas.length === 0) {
    return { ok: false, filas: [], errores: [{ fila: 0, columna: '', mensaje: 'El archivo está vacío', valor: '' }], avisos: [], totalFilas: 0 };
  }

  const sep = detectarSeparador(sinBom);
  const encabezado = partirLinea(lineas[0], sep).map((c) => c.toLowerCase().replace(/\s+/g, '_'));

  for (const obligatoria of COLUMNAS_OBLIGATORIAS) {
    if (!encabezado.includes(obligatoria)) {
      errores.push({
        fila: 1, columna: obligatoria,
        mensaje: `Falta la columna obligatoria "${obligatoria}"`,
        valor: encabezado.join(sep),
      });
    }
  }
  if (errores.length > 0) {
    return { ok: false, filas: [], errores, avisos, totalFilas: 0 };
  }

  const idx = (col: string) => encabezado.indexOf(col);
  const campo = (cols: string[], col: string) => {
    const i = idx(col);
    return i === -1 ? '' : (cols[i] ?? '');
  };

  // Para detectar duplicados DENTRO del archivo
  const skusVistos = new Map<string, number>();
  const codigosVistos = new Map<string, number>();

  for (let i = 1; i < lineas.length; i++) {
    const nFila = i + 1; // como lo ve el usuario en Excel
    const cols = partirLinea(lineas[i], sep);

    const nombre = campo(cols, 'nombre');
    if (nombre === '') {
      errores.push({ fila: nFila, columna: 'nombre', mensaje: 'El nombre no puede estar vacío', valor: '' });
      continue;
    }

    const precioBruto = campo(cols, 'precio_venta');
    const precio = leerNumero(precioBruto);
    if (precio === null) {
      errores.push({ fila: nFila, columna: 'precio_venta', mensaje: 'El precio no es un número válido', valor: precioBruto });
    } else if (precio < 0) {
      errores.push({ fila: nFila, columna: 'precio_venta', mensaje: 'El precio no puede ser negativo', valor: precioBruto });
    }

    const costoBruto = campo(cols, 'costo');
    const costo = costoBruto === '' ? 0 : leerNumero(costoBruto);
    if (costo === null) {
      errores.push({ fila: nFila, columna: 'costo', mensaje: 'El costo no es un número válido', valor: costoBruto });
    } else if (costo < 0) {
      errores.push({ fila: nFila, columna: 'costo', mensaje: 'El costo no puede ser negativo', valor: costoBruto });
    }

    // Vender bajo el costo es legal, pero casi siempre es un error de tipeo.
    if (precio !== null && costo !== null && costo > 0 && precio < costo) {
      avisos.push({
        fila: nFila, columna: 'precio_venta',
        mensaje: `El precio (${precio}) es menor al costo (${costo}). Revisa que no esté invertido`,
        valor: precioBruto,
      });
    }

    const sku = campo(cols, 'sku') || null;
    if (sku) {
      const anterior = skusVistos.get(sku.toLowerCase());
      if (anterior) {
        errores.push({ fila: nFila, columna: 'sku', mensaje: `El SKU se repite: ya está en la fila ${anterior}`, valor: sku });
      } else {
        skusVistos.set(sku.toLowerCase(), nFila);
      }
    }

    const codigoBruto = campo(cols, 'codigo_barras');
    let codigo: string | null = null;
    if (codigoBruto) {
      codigo = normalizeBarcode(codigoBruto);
      const anterior = codigosVistos.get(codigo);
      if (anterior) {
        errores.push({ fila: nFila, columna: 'codigo_barras', mensaje: `El código se repite: ya está en la fila ${anterior}`, valor: codigoBruto });
      } else {
        codigosVistos.set(codigo, nFila);
      }
      // Dígito de control inválido es aviso, no error: hay comercios que usan
      // códigos internos propios que no cumplen EAN.
      if (/^\d+$/.test(codigo) && [8, 12, 13].includes(codigo.length) && !isValidEan(codigo)) {
        avisos.push({
          fila: nFila, columna: 'codigo_barras',
          mensaje: 'El dígito de control del código no cuadra. Verifica que esté bien copiado',
          valor: codigoBruto,
        });
      }
    }

    const unidadBruta = (campo(cols, 'unidad') || 'unidad').toLowerCase();
    const unidad = UNIDADES_VALIDAS.includes(unidadBruta) ? unidadBruta : 'unidad';
    if (!UNIDADES_VALIDAS.includes(unidadBruta) && campo(cols, 'unidad') !== '') {
      avisos.push({
        fila: nFila, columna: 'unidad',
        mensaje: `Unidad "${unidadBruta}" no reconocida, se usará "unidad"`,
        valor: unidadBruta,
      });
    }

    const stockBruto = campo(cols, 'stock_inicial');
    const stock = stockBruto === '' ? 0 : leerNumero(stockBruto);
    if (stock === null) {
      errores.push({ fila: nFila, columna: 'stock_inicial', mensaje: 'El stock inicial no es un número válido', valor: stockBruto });
    } else if (stock < 0) {
      errores.push({ fila: nFila, columna: 'stock_inicial', mensaje: 'El stock inicial no puede ser negativo', valor: stockBruto });
    }

    const minimoBruto = campo(cols, 'stock_minimo');
    const minimo = minimoBruto === '' ? 0 : leerNumero(minimoBruto);
    if (minimo === null) {
      errores.push({ fila: nFila, columna: 'stock_minimo', mensaje: 'El stock mínimo no es un número válido', valor: minimoBruto });
    }

    const perecible = leerBooleano(campo(cols, 'perecible'));
    const diasBruto = campo(cols, 'dias_alerta');
    const dias = diasBruto === '' ? 30 : (leerNumero(diasBruto) ?? 30);

    // Solo se agrega si esta fila no aportó errores
    const filaTieneError = errores.some((e) => e.fila === nFila);
    if (!filaTieneError && precio !== null && costo !== null && stock !== null && minimo !== null) {
      filas.push({
        nombre,
        sku,
        codigo_barras: codigo,
        categoria: campo(cols, 'categoria') || null,
        precio_venta: clp(precio),
        costo: clp(costo),
        unidad,
        stock_inicial: stock,
        stock_minimo: minimo,
        perecible,
        dias_alerta: Math.max(0, Math.round(dias)),
      });
    }
  }

  return {
    ok: errores.length === 0 && filas.length > 0,
    filas,
    errores,
    avisos,
    totalFilas: lineas.length - 1,
  };
}

/** Plantilla CSV de ejemplo para que el cliente sepa qué formato usar. */
export function plantillaCSV(): string {
  const ejemplo = [
    COLUMNAS.join(';'),
    'Arroz grado 1 · 1 kg;ARR-1K;7801234000018;Abarrotes;1590;1100;unidad;40;10;no;30',
    'Leche entera · 1 L;LEC-1L;7801234000056;Lácteos;1190;850;unidad;36;20;si;10',
    'Detergente · 3 L;DET-3L;;Limpieza;5990;4300;unidad;9;4;no;30',
  ];
  // BOM para que Excel en Windows abra los acentos correctamente
  return '﻿' + ejemplo.join('\r\n') + '\r\n';
}
