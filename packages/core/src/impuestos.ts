/**
 * Desglose de impuestos de una venta: IVA e impuestos adicionales (RQ-06,
 * respuesta 5 del cuestionario: «las bebidas, impuesto específico»).
 *
 * En Chile el precio de góndola ya incluye todo. Para un producto con impuesto
 * adicional (IABA de las bebidas, ILA de vinos, cervezas y licores), el precio
 * es:
 *
 *     total = neto × (1 + IVA + tasa adicional)
 *
 * porque los dos impuestos se calculan sobre el mismo neto: el IVA no se cobra
 * sobre el impuesto adicional. El neto se despeja, el adicional se calcula
 * sobre él, y **el IVA sale por diferencia**, para que
 * `neto + IVA + adicionales === total` sin un peso de descuadre.
 *
 * Las líneas se agrupan por tasa y se calcula una vez por grupo, no línea por
 * línea: un documento con diez bebidas no puede tener diez redondeos. Un
 * descuento a la venta completa se reparte entre los grupos en proporción a su
 * subtotal, y el peso que sobra del reparto va al grupo más grande.
 *
 * Sin impuestos adicionales, el resultado es idéntico al de antes
 * (`taxIncluded` sobre el total), y así lo comprueban las pruebas.
 *
 * La base hace el mismo cálculo (`fn_desglose_impuestos`, 0018) y es la
 * autoridad: el documento tributario se arma con lo que ella guardó.
 */
import { clp } from './money.js';

export interface LineaConImpuesto {
  /** Subtotal de la línea con IVA e impuestos incluidos, ya descontado. */
  subtotal: number;
  /** Tasa del impuesto adicional en porcentaje (18 = 18 %). 0 si no tiene. */
  tasaAdicional?: number;
  /** Nombre del impuesto, para el papel ("IABA 18 %"). */
  nombreAdicional?: string | null;
}

export interface ImpuestoAdicionalDesglosado {
  tasa: number;
  nombre: string | null;
  /** Neto sobre el que se calculó. */
  neto: number;
  monto: number;
}

export interface Desglose {
  total: number;
  neto: number;
  iva: number;
  adicionales: ImpuestoAdicionalDesglosado[];
  /** Suma de los adicionales. */
  totalAdicionales: number;
}

interface Grupo {
  tasa: number;
  nombre: string | null;
  subtotal: number;
}

/**
 * Reparte `descuento` entre los grupos en proporción a su subtotal.
 * Mismo algoritmo que la base: parte entera, y el resto al grupo más grande
 * (el primero en orden de tasa si hay empate).
 */
function repartir(grupos: Grupo[], descuento: number): number[] {
  const suma = grupos.reduce((s, g) => s + g.subtotal, 0);
  const d = Math.min(Math.max(clp(descuento), 0), suma);
  if (d === 0 || suma === 0) return grupos.map(() => 0);
  const partes = grupos.map((g) => Math.floor((d * g.subtotal) / suma));
  const resto = d - partes.reduce((s, x) => s + x, 0);
  let mayor = 0;
  grupos.forEach((g, i) => { if (g.subtotal > grupos[mayor].subtotal) mayor = i; });
  partes[mayor] += resto;
  return partes;
}

export function desglosarImpuestos(
  lineas: readonly LineaConImpuesto[],
  ivaPct = 19,
  descuentoGlobal = 0,
): Desglose {
  const porTasa = new Map<number, Grupo>();
  for (const l of lineas) {
    const tasa = l.tasaAdicional && l.tasaAdicional > 0 ? l.tasaAdicional : 0;
    const g = porTasa.get(tasa) ?? { tasa, nombre: l.nombreAdicional ?? null, subtotal: 0 };
    g.subtotal += clp(l.subtotal);
    porTasa.set(tasa, g);
  }
  const grupos = [...porTasa.values()].sort((a, b) => a.tasa - b.tasa);
  const descuentos = repartir(grupos, descuentoGlobal);

  let neto = 0;
  let iva = 0;
  const adicionales: ImpuestoAdicionalDesglosado[] = [];
  grupos.forEach((g, i) => {
    const s = g.subtotal - descuentos[i];
    if (g.tasa === 0) {
      const ivaGrupo = clp(s - s / (1 + ivaPct / 100));
      iva += ivaGrupo;
      neto += s - ivaGrupo;
      return;
    }
    const netoGrupo = clp(s / (1 + ivaPct / 100 + g.tasa / 100));
    const adicional = clp((netoGrupo * g.tasa) / 100);
    iva += s - netoGrupo - adicional;
    neto += netoGrupo;
    adicionales.push({ tasa: g.tasa, nombre: g.nombre, neto: netoGrupo, monto: adicional });
  });

  const totalAdicionales = adicionales.reduce((s, a) => s + a.monto, 0);
  return { total: neto + iva + totalAdicionales, neto, iva, adicionales, totalAdicionales };
}

/** Los impuestos adicionales vigentes en Chile, para ofrecerlos al configurar. */
export const IMPUESTOS_ADICIONALES_CHILE = [
  { nombre: 'IABA bebidas sin azúcar añadida', codigoSii: 27, tasa: 10 },
  { nombre: 'IABA bebidas con alto azúcar', codigoSii: 271, tasa: 18 },
  { nombre: 'ILA vinos', codigoSii: 25, tasa: 20.5 },
  { nombre: 'ILA cervezas', codigoSii: 26, tasa: 20.5 },
  { nombre: 'ILA licores y destilados', codigoSii: 24, tasa: 31.5 },
] as const;
