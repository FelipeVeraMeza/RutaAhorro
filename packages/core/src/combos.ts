/**
 * Combos entre productos distintos (0023): «2 bebidas + 1 pan por $3.000».
 *
 * Decisión de Felipe, 2026-09-27: el combo se aplica solo. Cuando el carrito
 * tiene sus productos, el POS lo aplica las veces que quepa y muestra el
 * ahorro; la base vuelve a calcular cuánto se puede ahorrar y no acepta más.
 *
 * La regla, igual acá y en la base (`fn_ahorro_combos`):
 *
 *   · El ahorro de una aplicación es lo que se pagaría por sus productos al
 *     precio de cada línea (con su oferta por cantidad o su precio de
 *     cliente) menos el precio del combo. Si no ahorra nada, no se aplica.
 *     Así el combo nunca se suma a otra rebaja: solo cobra de menos lo que
 *     todavía no estaba rebajado.
 *   · Los combos se prueban de mayor a menor ahorro por aplicación (empate:
 *     por id), cada uno las veces que alcance con lo que queda en el carrito.
 *     Un producto usado por un combo no se usa en otro.
 *
 * El ahorro se reparte entre las líneas del combo como descuento de la línea
 * (`descuentoCombo`), en pesos enteros y proporcional a lo que pesa cada una.
 * Así el desglose de impuestos por línea y las devoluciones parciales, que
 * trabajan con el subtotal de cada línea, lo respetan sin saber de combos.
 */
import { clp } from './money.js';

export interface ItemCombo {
  productId: string;
  cantidad: number;
}

export interface Combo {
  id: string;
  nombre: string;
  /** Precio del combo completo, IVA incluido. */
  precio: number;
  items: ItemCombo[];
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
}

export interface LineaParaCombo {
  productId: string;
  cantidad: number;
  /** Precio de cada unidad que se cobraría sin el combo. */
  precio: number;
}

export interface ComboAplicado {
  comboId: string;
  nombre: string;
  veces: number;
  ahorro: number;
  /** Cuánto del ahorro va a cada producto. Suma exactamente `ahorro`. */
  porProducto: Record<string, number>;
}

export function comboVigente(c: Combo, dia?: string | null): boolean {
  if (!dia) return !c.vigenteDesde && !c.vigenteHasta;
  if (c.vigenteDesde && c.vigenteDesde > dia) return false;
  if (c.vigenteHasta && c.vigenteHasta < dia) return false;
  return true;
}

/** Lo que cuestan los productos de una aplicación del combo, al precio de cada línea. */
function valorDeUnaVez(c: Combo, precios: Map<string, number>): number | null {
  let suma = 0;
  for (const it of c.items) {
    const p = precios.get(it.productId);
    if (p == null) return null;
    suma += p * it.cantidad;
  }
  return clp(suma);
}

export function calcularCombos(
  lineas: readonly LineaParaCombo[],
  combos: readonly Combo[],
  dia?: string | null,
): ComboAplicado[] {
  const disponible = new Map<string, number>();
  const precios = new Map<string, number>();
  for (const l of lineas) {
    disponible.set(l.productId, (disponible.get(l.productId) ?? 0) + l.cantidad);
    // Dos líneas del mismo producto: vale la más barata, como en la base.
    precios.set(l.productId, Math.min(precios.get(l.productId) ?? Infinity, clp(l.precio)));
  }

  const candidatos = combos
    .filter((c) => c.items.length > 0 && comboVigente(c, dia))
    .map((c) => {
      const valor = valorDeUnaVez(c, precios);
      return { c, valor, ahorro: valor == null ? 0 : valor - clp(c.precio) };
    })
    .filter((x) => x.valor != null && x.ahorro > 0)
    .sort((a, b) => b.ahorro - a.ahorro || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));

  const aplicados: ComboAplicado[] = [];
  for (const { c, valor, ahorro } of candidatos) {
    let veces = Infinity;
    for (const it of c.items) {
      // Con cantidades decimales (kilos) se compara con una tolerancia: 0,3 ×
      // 3 en punto flotante es 0,8999… y el combo no cabría.
      veces = Math.min(veces, Math.floor(((disponible.get(it.productId) ?? 0) + 1e-9) / it.cantidad));
    }
    if (!Number.isFinite(veces) || veces < 1) continue;
    for (const it of c.items) {
      disponible.set(it.productId, (disponible.get(it.productId) ?? 0) - veces * it.cantidad);
    }

    // Reparto del ahorro, en pesos enteros, proporcional al peso de cada
    // producto en el combo. Lo que sobra por redondear va al de más peso.
    const total = ahorro * veces;
    const porProducto: Record<string, number> = {};
    let repartido = 0;
    let mayor = c.items[0].productId;
    let pesoMayor = -1;
    for (const it of c.items) {
      const peso = (precios.get(it.productId) ?? 0) * it.cantidad;
      const parte = Math.floor((total * peso) / (valor as number));
      porProducto[it.productId] = (porProducto[it.productId] ?? 0) + parte;
      repartido += parte;
      if (peso > pesoMayor) { pesoMayor = peso; mayor = it.productId; }
    }
    porProducto[mayor] += total - repartido;
    aplicados.push({ comboId: c.id, nombre: c.nombre, veces, ahorro: total, porProducto });
  }
  return aplicados;
}

/** Revisa un combo antes de guardarlo. Los mismos límites que `fn_guardar_combo`. */
export function validarCombo(
  c: Pick<Combo, 'nombre' | 'precio' | 'items' | 'vigenteDesde' | 'vigenteHasta'>,
  precioNormal: (productId: string) => number | undefined,
): string | null {
  if (!c.nombre.trim()) return 'El combo necesita un nombre.';
  const distintos = new Set(c.items.map((i) => i.productId));
  if (distintos.size < 2) return 'Un combo lleva al menos dos productos distintos. Para uno solo, usa una oferta por cantidad.';
  if (distintos.size !== c.items.length) return 'Hay un producto repetido: súmale la cantidad.';
  if (c.items.some((i) => !(i.cantidad > 0))) return 'Cada producto necesita una cantidad mayor que cero.';
  if (!Number.isInteger(c.precio) || c.precio <= 0) return 'El precio del combo tiene que ser un monto mayor que cero.';
  let normal = 0;
  for (const i of c.items) {
    const p = precioNormal(i.productId);
    if (p == null) return 'Uno de los productos ya no existe o está desactivado.';
    normal += p * i.cantidad;
  }
  if (c.precio >= clp(normal)) return 'El combo tiene que costar menos que sus productos por separado.';
  if (c.vigenteDesde && c.vigenteHasta && c.vigenteHasta < c.vigenteDesde) return 'La fecha de término es anterior a la de inicio.';
  return null;
}
