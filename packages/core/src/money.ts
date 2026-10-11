/**
 * Dinero en pesos chilenos.
 *
 * Regla del proyecto (RNF-32): el CLP no tiene decimales y el dinero SIEMPRE se
 * representa como entero. Nunca `number` con decimales, nunca `float`.
 * Una diferencia de $1 por redondeo en un arqueo hace que el cajero deje de
 * confiar en el sistema completo.
 */

/** Redondeo al entero más cercano, con medio hacia arriba y simétrico en negativos. */
export function clp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

const formatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** "$12.990" — formato chileno, sin decimales (RNF-21). */
export function formatCLP(value: number): string {
  // El espacio duro que mete Intl entre "$" y el número se ve mal en pantallas
  // angostas de celular; lo eliminamos.
  return formatter.format(clp(value)).replace(/ /g, '');
}

/** "12.990" — sin símbolo, para campos de formulario. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(clp(value));
}

/** Lee "$12.990", "12990", "12.990" → 12990. Devuelve null si no es un monto. */
export function parseCLP(input: string): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^\d-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** IVA contenido en un precio que YA lo incluye (S-9: precios con IVA incluido). */
export function taxIncluded(grossAmount: number, ivaPct = 19): number {
  return clp(grossAmount - grossAmount / (1 + ivaPct / 100));
}

/** Neto de un precio con IVA incluido. */
export function netAmount(grossAmount: number, ivaPct = 19): number {
  return clp(grossAmount) - taxIncluded(grossAmount, ivaPct);
}

/** Margen en pesos. */
export function margin(salePrice: number, cost: number): number {
  return clp(salePrice) - clp(cost);
}

/**
 * Margen como porcentaje del PRECIO DE VENTA, no del costo.
 * Es la convención de retail: "margen 30 %" significa que 30 centavos de cada
 * peso vendido son margen. Calcularlo sobre el costo daría un número más grande
 * y halagador, pero no es el que usa el negocio.
 */
export function marginPct(salePrice: number, cost: number): number {
  const price = clp(salePrice);
  if (price <= 0) return 0;
  return Math.round((margin(price, cost) / price) * 1000) / 10;
}

/**
 * Margen en pesos con el costo NETO, que es como se guarda desde 2026-10-01
 * (docs/26 N° 13): el costo sale de la factura del proveedor, sin IVA, y el
 * precio de venta lo trae incluido. Comparar el precio con IVA contra un
 * costo neto le sumaba al margen el 19 % que es del fisco: un producto de
 * $2.490 con costo neto $1.850 mostraba 25,7 % y deja 11,6 %.
 */
export function margenNeto(precioConIva: number, costoNeto: number, ivaPct = 19): number {
  return netAmount(precioConIva, ivaPct) - clp(costoNeto);
}

/** `margenNeto` como porcentaje del precio de venta sin IVA. */
export function margenNetoPct(precioConIva: number, costoNeto: number, ivaPct = 19): number {
  const neto = netAmount(precioConIva, ivaPct);
  if (neto <= 0) return 0;
  return Math.round((margenNeto(precioConIva, costoNeto, ivaPct) / neto) * 1000) / 10;
}

/** Vuelto. Nunca negativo: si pagó de menos, el vuelto es 0, no una deuda. */
export function change(received: number, total: number): number {
  return Math.max(clp(received) - clp(total), 0);
}

// ---------------------------------------------------------------------------
// Validación de campos de dinero
// ---------------------------------------------------------------------------

export interface MontoValidado {
  valido: boolean;
  /** Monto en pesos enteros. 0 cuando no es válido. */
  valor: number;
  /** Mensaje en lenguaje del negocio, o null si está bien. */
  error: string | null;
}

export interface OpcionesMonto {
  /** Si el campo puede quedar vacío. Por defecto, no. */
  permiteVacio?: boolean;
  /** Si acepta cero como monto válido. Por defecto, sí. */
  permiteCero?: boolean;
  /** Tope superior, para atajar un cero de más al teclear. */
  maximo?: number;
  /** Cómo se llama el campo en el mensaje de error. */
  etiqueta?: string;
  /**
   * Acepta centavos y los redondea al peso: 907,58 → 908. Es para el costo,
   * que se copia de la factura del proveedor y ahí el neto unitario viene con
   * decimales. Sin esto no había forma de escribirlo (Felipe, 2026-10-06).
   */
  redondeaDecimales?: boolean;
}

/** "907,58", "1.234,5" o "907.58" (punto con 1 o 2 decimales) → número con decimales. */
function leerConDecimales(limpio: string): number | null {
  if (/,/.test(limpio)) {
    if (!/^-?(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(limpio)) return null;
    return Number(limpio.replace(/\./g, '').replace(',', '.'));
  }
  // Con tres dígitos tras el punto es separador de miles (1.990); con uno o
  // dos no puede serlo, así que es la coma escrita con el teclado en inglés.
  if (/^-?\d+\.\d{1,2}$/.test(limpio)) return Number(limpio);
  return null;
}

/** ¿El monto escrito trae centavos? Para avisar que se guardó redondeado. */
export function hayDecimales(entrada: string): boolean {
  const limpio = String(entrada ?? '').trim().replace(/^\$\s*/, '').replace(/\s+/g, '');
  const n = leerConDecimales(limpio);
  return n !== null && !Number.isInteger(n);
}

/**
 * Valida lo que el usuario escribió en un campo de dinero.
 *
 * `parseCLP` solo interpreta: limpia el formato y devuelve un número, y ese
 * número puede ser negativo porque acepta el signo menos. Eso basta para
 * mostrar un total, pero no para guardar: un "ingreso" de caja de −500 entra
 * como egreso encubierto y descuadra el arqueo sin dejar rastro de que alguien
 * escribió un signo.
 *
 * Esta función es la que deben usar los formularios antes de enviar. Los
 * mensajes están en lenguaje del negocio (RNF-22): el cajero no tiene por qué
 * leer "valor inválido".
 */
export function validarMonto(entrada: string, opciones: OpcionesMonto = {}): MontoValidado {
  const {
    permiteVacio = false,
    permiteCero = true,
    maximo,
    etiqueta = 'monto',
    redondeaDecimales = false,
  } = opciones;

  const texto = String(entrada ?? '').trim();

  if (texto === '') {
    return permiteVacio
      ? { valido: true, valor: 0, error: null }
      : { valido: false, valor: 0, error: `Escribe el ${etiqueta}` };
  }

  // Un texto que no contiene ningún dígito no es un monto a medio escribir:
  // es otra cosa. Distinguirlo permite un mensaje más útil que "inválido".
  if (!/\d/.test(texto)) {
    return { valido: false, valor: 0, error: `El ${etiqueta} tiene que ser un número` };
  }

  // Los pesos no llevan decimales y el punto separa miles. parseCLP borra todo
  // lo que no es dígito, así que "1990,5" se leía 19.905 y "1.5" se leía 15:
  // un costo o un monto recibido diez veces mayor, sin aviso.
  const limpio = texto.replace(/^\$\s*/, '').replace(/\s+/g, '');
  const conDecimales = redondeaDecimales ? leerConDecimales(limpio) : null;
  if (conDecimales !== null) {
    return validarMonto(String(clp(conDecimales)), { ...opciones, redondeaDecimales: false });
  }
  if (/,/.test(limpio)) {
    if (redondeaDecimales) {
      return { valido: false, valor: 0, error: `Revisa el ${etiqueta}: escríbelo como 907,58 o 1.990` };
    }
    return { valido: false, valor: 0, error: `Los pesos van sin decimales: escribe el ${etiqueta} sin coma` };
  }
  if (/[^\d.\-]/.test(limpio)) {
    return { valido: false, valor: 0, error: `El ${etiqueta} tiene que ser un número` };
  }
  if (limpio.includes('.') && !/^-?\d{1,3}(\.\d{3})+$/.test(limpio)) {
    return { valido: false, valor: 0, error: `Revisa el ${etiqueta}: el punto separa miles (1.990)` };
  }

  const valor = parseCLP(texto);
  if (valor === null || !Number.isFinite(valor)) {
    return { valido: false, valor: 0, error: `El ${etiqueta} tiene que ser un número` };
  }

  if (valor < 0) {
    return { valido: false, valor: 0, error: `El ${etiqueta} no puede ser negativo` };
  }

  if (valor === 0 && !permiteCero) {
    return { valido: false, valor: 0, error: `El ${etiqueta} tiene que ser mayor que cero` };
  }

  // Sin tope propio, el de la base: los montos son `integer` en PostgreSQL y
  // más de $2.147.483.647 se rechazaba allá con un error que nadie entendía.
  const tope = Math.min(maximo ?? MAXIMO_EN_LA_BASE, MAXIMO_EN_LA_BASE);
  if (valor > tope) {
    return {
      valido: false,
      valor: 0,
      error: `El ${etiqueta} supera el máximo permitido de ${formatCLP(tope)}`,
    };
  }

  return { valido: true, valor, error: null };
}

/** El mayor `integer` de PostgreSQL: el tope de todo monto que se guarda. */
export const MAXIMO_EN_LA_BASE = 2_147_483_647;

/**
 * Valida una cantidad de producto: unidades, no pesos.
 *
 * Acepta decimales porque hay productos que se venden por peso (RF-M2-14),
 * pero nunca negativos: un conteo de inventario de −5 o un ajuste a cantidad
 * negativa dejarían un saldo que no existe en ninguna bodega.
 */
export function validarCantidad(
  entrada: string,
  opciones: { permiteVacio?: boolean; permiteCero?: boolean; maximo?: number } = {},
): MontoValidado {
  const { permiteVacio = false, permiteCero = true, maximo } = opciones;
  const texto = String(entrada ?? '').trim();

  if (texto === '') {
    return permiteVacio
      ? { valido: true, valor: 0, error: null }
      : { valido: false, valor: 0, error: 'Escribe la cantidad' };
  }

  // Solo dígitos con una coma o un punto decimal (o puntos de miles, que
  // resuelven las versiones enteras de abajo). `Number` aceptaba "1e2" como
  // 100 y "0x10" como 16: un dedo de más en el teclado cambiaba el conteo.
  if (!/^-?\d+([.,]\d+)?$/.test(texto) && !MILES.test(texto)) {
    return { valido: false, valor: 0, error: 'La cantidad tiene que ser un número' };
  }
  const valor = Number(texto.replace(',', '.'));
  if (!Number.isFinite(valor)) {
    return { valido: false, valor: 0, error: 'La cantidad tiene que ser un número' };
  }
  if (valor < 0) {
    return { valido: false, valor: 0, error: 'La cantidad no puede ser negativa' };
  }
  if (valor === 0 && !permiteCero) {
    return { valido: false, valor: 0, error: 'La cantidad tiene que ser mayor que cero' };
  }
  if (typeof maximo === 'number' && valor > maximo) {
    return { valido: false, valor: 0, error: `La cantidad supera el máximo de ${maximo}` };
  }

  return { valido: true, valor, error: null };
}

/** "1.000", "12.500.000": puntos que separan miles, como se escribe en Chile. */
const MILES = /^\d{1,3}(\.\d{3})+$/;

/**
 * En lo que se cuenta entero, "1.000" son mil: el punto separa miles en Chile.
 * Se leía como 1 (punto decimal) y recibir "1.000 bolsas" dejaba una.
 */
function conMilesSiEsEntero(entrada: string): string {
  const t = String(entrada ?? '').trim();
  return MILES.test(t) ? t.replace(/\./g, '') : entrada;
}

/**
 * Unidades que se venden fraccionadas: 0,35 kg de queso sí, 1,5 panes no.
 * Las demás (unidad, paquete, caja) se cuentan enteras.
 */
export const UNIDADES_FRACCIONARIAS: readonly string[] = ['kg', 'gramo', 'litro', 'ml'];

export function admiteDecimales(unidad: string | null | undefined): boolean {
  return UNIDADES_FRACCIONARIAS.includes((unidad ?? '').trim().toLowerCase());
}

/** Una cantidad como se escribe en Chile: coma decimal, hasta 3 decimales, sin ceros de más. */
export function formatCantidad(cantidad: number): string {
  if (!Number.isFinite(cantidad)) return '0';
  return cantidad.toLocaleString('es-CL', { maximumFractionDigits: 3, useGrouping: false });
}

/**
 * Valida la cantidad que el cajero escribe en una línea del POS.
 *
 * Existe porque para 20 panes había que tocar "+" 19 veces, y un producto por
 * kilo no admitía 0,35. Entero para lo que se cuenta; hasta 3 decimales (lo
 * que guarda la base, numeric(14,3)) para lo que se pesa o se mide.
 */
export function validarCantidadVenta(
  entrada: string,
  unidad: string | null | undefined,
  maximo = 100_000,
): MontoValidado {
  const v = validarCantidad(admiteDecimales(unidad) ? entrada : conMilesSiEsEntero(entrada), { permiteCero: false, maximo });
  if (!v.valido) return v;
  if (!admiteDecimales(unidad)) {
    if (!Number.isInteger(v.valor)) {
      return { valido: false, valor: 0, error: 'Este producto se vende entero: escribe 1, 2, 3…' };
    }
    return v;
  }
  // En milésimas, con tolerancia: 0,35 × 1000 da 349,99999999999994.
  const milesimas = v.valor * 1000;
  if (Math.abs(milesimas - Math.round(milesimas)) > 1e-6) {
    return { valido: false, valor: 0, error: 'Hasta 3 decimales: 0,125 sí, 0,1255 no' };
  }
  return { valido: true, valor: Math.round(milesimas) / 1000, error: null };
}

/**
 * Un porcentaje como se escribe en Chile: "25,7 %", con coma decimal. El
 * margen de Productos salía "25.7%": con punto, en un país donde el punto
 * separa miles, 25.7 se puede leer veinticinco mil.
 */
export function formatPct(valor: number, decimales = 1): string {
  return `${valor.toLocaleString('es-CL', { maximumFractionDigits: decimales })} %`;
}

/** Texto para comparar en una búsqueda: minúsculas y sin tildes ("José" → "jose"). */
export function textoBusqueda(texto: string | null | undefined): string {
  return (texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * RF-M2-20 · ¿`texto` contiene lo buscado, sin importar tildes ni mayúsculas?
 * Productos y Vender ya lo hacían; los buscadores de clientes, combos,
 * ofertas, facturas y fiado no: "jose" no encontraba a "José".
 */
export function coincide(texto: string | null | undefined, busqueda: string): boolean {
  return textoBusqueda(texto).includes(textoBusqueda(busqueda));
}

/**
 * Una cantidad de inventario (ajuste, toma, traspaso): como `validarCantidad`
 * (acepta cero y vacío según las opciones), pero entera para lo que se cuenta
 * por unidad. Se aceptaba "2,5 botellas" en un ajuste o en un conteo, y el
 * stock quedaba con medias botellas que nadie puede vender.
 */
export function validarCantidadStock(
  entrada: string,
  unidad: string | null | undefined,
  opciones: { permiteVacio?: boolean; permiteCero?: boolean; maximo?: number } = {},
): MontoValidado {
  const v = validarCantidad(admiteDecimales(unidad) ? entrada : conMilesSiEsEntero(entrada), opciones);
  if (!v.valido || admiteDecimales(unidad) || Number.isInteger(v.valor)) return v;
  return { valido: false, valor: 0, error: 'Este producto se cuenta entero: escribe 1, 2, 3…' };
}
