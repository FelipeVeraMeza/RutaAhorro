/**
 * Precio por cantidad y ofertas (RQ-04, RQ-08; punto 8 de la lista del cliente).
 *
 * Lo que pidió el cliente, textual: «1 por $2.000 y si llevas 3 te llevas los
 * 3 a $1.400 cada uno». Es decir:
 *
 *   · el precio de lista vale para cualquier cantidad;
 *   · un tramo dice "desde N unidades, cada una a $P";
 *   · se aplica el tramo con el N más alto que la cantidad alcanza, y el
 *     precio vale para TODAS las unidades de la línea, no solo para las que
 *     pasan de N. Con 4 unidades y el ejemplo de arriba: 4 × $1.400.
 *
 * Un tramo puede tener vigencia (desde / hasta, por día del local): eso es una
 * promoción. "Esta semana, desde 1 unidad a $1.800" es un tramo desde 1 con
 * fechas.
 *
 * Desde 0021 un tramo dice su precio de dos maneras: un monto fijo ("a
 * $1.400") o un porcentaje sobre el precio normal ("10 % menos"). El
 * porcentaje existe para las ofertas que se aplican a muchos productos a la
 * vez —«todas las cervezas, desde 6, 10 % menos»—: con un monto fijo, cada vez
 * que sube el precio de un producto habría que rehacer su oferta, y en un
 * almacén los precios suben todos los meses.
 *
 * La misma regla está en la base (`fn_precio_por_cantidad`, 0018) y es la que
 * manda: esta versión existe para que el POS muestre el total al instante y
 * sin conexión. Las dos se prueban con los mismos casos.
 */
import { clp, formatCLP } from './money.js';

export interface TramoPrecio {
  /** Desde cuántas unidades rige. 1 = cualquier cantidad (una promoción). */
  desde: number;
  /** Precio de cada unidad, IVA incluido. Null si el tramo es un porcentaje. */
  precio?: number | null;
  /** Porcentaje de rebaja sobre el precio normal (10 = 10 % menos). Null si es un monto. */
  descuentoPct?: number | null;
  /** Día del local en que empieza a regir, 'AAAA-MM-DD'. Sin fecha = desde siempre. */
  vigenteDesde?: string | null;
  /** Último día del local en que rige, inclusive. Sin fecha = sin término. */
  vigenteHasta?: string | null;
}

export interface PrecioAplicado {
  /** Precio de cada unidad para esta cantidad. */
  precio: number;
  /** El tramo que se aplicó, o null si rige el precio de lista. */
  tramo: TramoPrecio | null;
}

/**
 * El precio de cada unidad que da un tramo, para un precio normal.
 *
 * El porcentaje se lleva a centésimas enteras antes de multiplicar: 12,35 ×
 * 100 en punto flotante es 1234,9999… y el redondeo cambiaría de lado. Con
 * enteros la división por 10.000 da un .5 exacto cuando corresponde, y
 * Math.round lo sube igual que round() de PostgreSQL con un positivo
 * (`fn_precio_tramo`, 0021).
 */
export function precioDelTramo(t: TramoPrecio, precioLista: number): number {
  if (t.descuentoPct != null) {
    const centesimas = Math.round(t.descuentoPct * 100);
    return Math.round((clp(precioLista) * (10_000 - centesimas)) / 10_000);
  }
  return clp(t.precio ?? precioLista);
}

/** El tramo en palabras: "a $1.400 c/u" o "10% menos". */
export function describirTramo(t: TramoPrecio): string {
  if (t.descuentoPct != null) return `${String(t.descuentoPct).replace('.', ',')}% menos`;
  return `a ${formatCLP(t.precio ?? 0)} c/u`;
}

/** ¿El tramo rige ese día? Las fechas se comparan como texto 'AAAA-MM-DD'. */
export function tramoVigente(t: TramoPrecio, dia?: string | null): boolean {
  if (!dia) return !t.vigenteDesde && !t.vigenteHasta;
  if (t.vigenteDesde && t.vigenteDesde > dia) return false;
  if (t.vigenteHasta && t.vigenteHasta < dia) return false;
  return true;
}

/**
 * El precio de cada unidad para `cantidad` unidades.
 *
 * Nunca más caro que el de lista: si el dueño baja el precio de lista por
 * debajo de un tramo viejo, el cliente paga el menor. Entre dos tramos con el
 * mismo "desde" (una promoción encima del precio por mayor), gana el menor.
 */
export function precioPorCantidad(
  precioLista: number,
  tramos: readonly TramoPrecio[] | null | undefined,
  cantidad: number,
  dia?: string | null,
): PrecioAplicado {
  const lista = clp(precioLista);
  let elegido: TramoPrecio | null = null;
  let precioElegido = lista;
  for (const t of tramos ?? []) {
    if (!(t.desde <= cantidad) || !tramoVigente(t, dia)) continue;
    const p = precioDelTramo(t, lista);
    if (!elegido || t.desde > elegido.desde || (t.desde === elegido.desde && p < precioElegido)) {
      elegido = t;
      precioElegido = p;
    }
  }
  if (!elegido || precioElegido >= lista) return { precio: lista, tramo: null };
  return { precio: precioElegido, tramo: elegido };
}

/** Los tramos que rigen ese día, ordenados por cantidad. Para mostrarlos. */
export function tramosVigentes(
  tramos: readonly TramoPrecio[] | null | undefined,
  dia?: string | null,
): TramoPrecio[] {
  return (tramos ?? [])
    .filter((t) => tramoVigente(t, dia))
    .sort((a, b) => a.desde - b.desde || (a.precio ?? 0) - (b.precio ?? 0) || (b.descuentoPct ?? 0) - (a.descuentoPct ?? 0));
}

export interface ErrorTramo {
  indice: number;
  mensaje: string;
}

/**
 * Revisa los tramos antes de guardarlos. Los mismos límites están en la base
 * (`fn_guardar_precios_producto`); acá es para decirlo en el formulario.
 */
export function validarTramos(tramos: readonly TramoPrecio[], precioLista: number): ErrorTramo[] {
  const errores: ErrorTramo[] = [];
  const vistos = new Map<string, number>();
  tramos.forEach((t, i) => {
    if (!Number.isFinite(t.desde) || t.desde < 1) {
      errores.push({ indice: i, mensaje: 'La cantidad tiene que ser 1 o más.' });
    } else if (!Number.isInteger(t.desde)) {
      // Todo se vende por unidad (0032): "desde 2,5" se guardaba y el cliente
      // veía "Por mayor desde 2,5", que en la práctica es desde 3.
      errores.push({ indice: i, mensaje: 'La cantidad va por unidad: 2, 3, 6…' });
    }
    if ((t.precio != null) === (t.descuentoPct != null)) {
      errores.push({ indice: i, mensaje: 'La oferta lleva un precio o un porcentaje, no los dos.' });
    } else if (t.descuentoPct != null) {
      if (!Number.isFinite(t.descuentoPct) || t.descuentoPct <= 0 || t.descuentoPct >= 100) {
        errores.push({ indice: i, mensaje: 'El porcentaje tiene que estar entre 0 y 100.' });
      } else if (Math.abs(t.descuentoPct * 100 - Math.round(t.descuentoPct * 100)) > 1e-6) {
        errores.push({ indice: i, mensaje: 'El porcentaje admite hasta dos decimales.' });
      }
    } else if (!Number.isInteger(t.precio) || (t.precio as number) <= 0) {
      errores.push({ indice: i, mensaje: 'El precio tiene que ser un monto mayor que cero.' });
    } else if ((t.precio as number) >= clp(precioLista)) {
      errores.push({ indice: i, mensaje: 'El precio de la oferta tiene que ser menor que el precio normal.' });
    }
    if (t.desde === 1 && !t.vigenteDesde && !t.vigenteHasta) {
      errores.push({ indice: i, mensaje: 'Desde 1 unidad y sin fechas es cambiar el precio normal: cámbialo arriba.' });
    }
    if (t.vigenteDesde && t.vigenteHasta && t.vigenteHasta < t.vigenteDesde) {
      errores.push({ indice: i, mensaje: 'La fecha de término es anterior a la de inicio.' });
    }
    const clave = `${t.desde}|${t.vigenteDesde ?? ''}|${t.vigenteHasta ?? ''}`;
    if (vistos.has(clave)) {
      errores.push({ indice: i, mensaje: `Repite la cantidad del tramo ${vistos.get(clave)! + 1}.` });
    } else {
      vistos.set(clave, i);
    }
  });
  return errores;
}
