'use client';

import { formatCLP, validarMonto, validarCantidadStock } from '@rutaahorro/core';
import type { ComboEditable } from '@/lib/datos/combos';

/**
 * Packs de este producto: "2 por $500" (0042). Felipe, 2026-10-13: "si agrego
 * uno más se debería cobrar la promo y uno a precio normal".
 *
 * Por dentro es un combo de un solo producto: la caja lo aplica las veces que
 * quepa y lo que sobra va a precio normal. Es distinto del precio por mayor,
 * donde al llegar a la cantidad TODAS las unidades cambian de precio.
 */
export interface FilaPack {
  clave: string;
  /** Id del combo, si ya existía. */
  id: string | null;
  cantidad: string;
  precio: string;
}

/** Los packs de un producto: combos activos con ese único producto. */
export function filasDesdeCombos(combos: ComboEditable[], productoId: string): FilaPack[] {
  return combos
    .filter((c) => c.activo && c.items.length === 1 && c.items[0].productId === productoId)
    .map((c) => ({ clave: c.id, id: c.id, cantidad: String(c.items[0].cantidad), precio: String(c.precio) }));
}

/** Lo que se guarda, o el primer error en palabras del local. */
export function packsDesdeFilas(filas: FilaPack[], precioLista: number):
  { packs: Array<{ id: string | null; cantidad: number; precio: number }>; error: string | null } {
  const packs = [];
  const vistas = new Set<number>();
  for (const [i, f] of filas.entries()) {
    const n = i + 1;
    const vC = validarCantidadStock(f.cantidad, 'unidad', { maximo: 1000 });
    if (!vC.valido || !Number.isInteger(vC.valor) || vC.valor < 2) {
      return { packs: [], error: `Pack ${n}: la cantidad tiene que ser 2 o más unidades enteras.` };
    }
    const vP = validarMonto(f.precio, { permiteCero: false, maximo: 50_000_000 });
    if (!vP.valido) return { packs: [], error: `Pack ${n}: ${vP.error}` };
    if (precioLista > 0 && vP.valor >= vC.valor * precioLista) {
      return { packs: [], error: `Pack ${n}: ${vC.valor} por ${formatCLP(vP.valor)} no es más barato que ${vC.valor} sueltos (${formatCLP(vC.valor * precioLista)}).` };
    }
    if (vistas.has(vC.valor)) return { packs: [], error: `Hay dos packs de ${vC.valor} unidades: deja uno.` };
    vistas.add(vC.valor);
    packs.push({ id: f.id, cantidad: vC.valor, precio: vP.valor });
  }
  return { packs, error: null };
}

export function PacksProducto({ filas, onFilas, precioLista }: {
  filas: FilaPack[];
  onFilas: (f: FilaPack[]) => void;
  precioLista: number;
}) {
  const cambiar = (clave: string, cambio: Partial<FilaPack>) =>
    onFilas(filas.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));

  return (
    <section className="rounded-xl border border-[var(--borde)] p-3" aria-labelledby="titulo-packs">
      <h3 id="titulo-packs" className="font-semibold text-sm">Pack: N por $X (opcional)</h3>
      <p className="text-xs text-[var(--texto-suave)] mt-0.5 mb-3">
        Un precio por un grupo de unidades, como <strong>2 por $500</strong>. La caja lo aplica las veces que quepa y
        lo que sobra va a precio normal: llevando 3, es un pack más una suelta.
      </p>

      <ul className="space-y-3">
        {filas.map((f, i) => {
          const n = Number(f.cantidad);
          const p = Number(String(f.precio).replace(/\D/g, ''));
          // Lo que pasa en la caja con los números de esta fila: un pack y una suelta.
          const ejemplo = Number.isInteger(n) && n >= 2 && p > 0 && precioLista > 0 && p < n * precioLista
            ? `${n} por ${formatCLP(p)} (ahorra ${formatCLP(n * precioLista - p)}). Llevando ${n + 1}: `
              + `1 pack + 1 a ${formatCLP(precioLista)} = ${formatCLP(p + precioLista)}.`
            : null;
          return (
            <li key={f.clave} className="rounded-lg bg-[var(--fondo)] p-2.5">
              <div className="flex items-end gap-2">
                <label className="flex-1 min-w-0">
                  <span className="block text-xs mb-1">Unidades del pack</span>
                  <input inputMode="numeric" value={f.cantidad}
                    onChange={(e) => cambiar(f.clave, { cantidad: e.target.value })}
                    aria-label={`Pack ${i + 1}: cuántas unidades`}
                    className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] bg-white num text-right" />
                </label>
                <label className="flex-1 min-w-0">
                  <span className="block text-xs mb-1">Precio del pack</span>
                  <input inputMode="numeric" value={f.precio}
                    onChange={(e) => cambiar(f.clave, { precio: e.target.value })}
                    aria-label={`Pack ${i + 1}: precio del pack completo`}
                    className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] bg-white num text-right" />
                </label>
                <button type="button" onClick={() => onFilas(filas.filter((x) => x.clave !== f.clave))}
                  aria-label={`Quitar el pack ${i + 1}`}
                  className="tap px-3 rounded-lg text-sm text-[var(--color-alerta)]">
                  Quitar
                </button>
              </div>
              {ejemplo && <p className="text-xs text-marca-700 mt-1.5 num">{ejemplo}</p>}
            </li>
          );
        })}
      </ul>

      <button type="button"
        onClick={() => onFilas([...filas, { clave: `n${Date.now()}`, id: null, cantidad: filas.length ? '' : '2', precio: '' }])}
        className="tap w-full mt-3 rounded-lg border border-dashed border-[var(--borde)] text-sm font-medium">
        {filas.length ? '+ Otro pack' : '+ Agregar pack'}
      </button>
    </section>
  );
}
