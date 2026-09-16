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

  if (typeof maximo === 'number' && valor > maximo) {
    return {
      valido: false,
      valor: 0,
      error: `El ${etiqueta} supera el máximo permitido de ${formatCLP(maximo)}`,
    };
  }

  return { valido: true, valor, error: null };
}

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
