'use client';

import Link from 'next/link';
import {
  formatCLP, validarMonto, validarCantidad, validarCantidadStock, validarTramos, etiquetaAdicional, precioDelTramo,
  type TramoPrecio,
} from '@rutaahorro/core';
import type { ImpuestoAdicional } from '@/lib/datos/precios';

/**
 * Ofertas por cantidad e impuesto adicional de un producto (0018).
 *
 * Una oferta es "desde N unidades, cada una a $P", con fechas si es una
 * promoción. El ejemplo del cliente —«1 por $2.000 y si llevas 3 te llevas
 * los 3 a $1.400 cada uno»— es una fila: desde 3, a $1.400.
 *
 * Las filas se editan como texto (lo que la persona escribe) y se convierten
 * a tramos al guardar, con los mismos validadores que el resto del formulario:
 * "1.400" es mil cuatrocientos, no uno coma cuatro.
 *
 * Desde 0021 una oferta también puede ser un porcentaje ("10 % menos"), que
 * sigue al precio normal cuando cambia. Es lo que deja la pantalla de ofertas
 * a varios productos, y acá se ve y se edita igual.
 */
export interface FilaOferta {
  clave: string;
  desde: string;
  /** 'precio': `precio` es el monto c/u. 'pct': `precio` es el porcentaje de rebaja. */
  modo: 'precio' | 'pct';
  precio: string;
  conFechas: boolean;
  vigenteDesde: string;
  vigenteHasta: string;
}

export function filasDesdeTramos(tramos: TramoPrecio[]): FilaOferta[] {
  return tramos.map((t, i) => ({
    clave: `t${i}-${t.desde}`,
    desde: String(t.desde).replace('.', ','),
    modo: t.descuentoPct != null ? 'pct' : 'precio',
    precio: t.descuentoPct != null
      ? String(t.descuentoPct).replace('.', ',')
      : (t.precio ?? 0).toLocaleString('es-CL'),
    conFechas: Boolean(t.vigenteDesde || t.vigenteHasta),
    vigenteDesde: t.vigenteDesde ?? '',
    vigenteHasta: t.vigenteHasta ?? '',
  }));
}

/** Filas → tramos, o el primer error en palabras. */
export function tramosDesdeFilas(
  filas: FilaOferta[], precioLista: number,
): { tramos: TramoPrecio[]; error: string | null } {
  const tramos: TramoPrecio[] = [];
  for (const [i, f] of filas.entries()) {
    const n = `Oferta ${i + 1}: `;
    // Por unidad (0032): "desde 2,5" no existe.
    const vDesde = validarCantidadStock(f.desde, 'unidad', { maximo: 1_000_000 });
    if (!vDesde.valido) return { tramos: [], error: n + vDesde.error };
    let monto: Pick<TramoPrecio, 'precio' | 'descuentoPct'>;
    if (f.modo === 'pct') {
      const vPct = validarCantidad(f.precio, { maximo: 99.99 });
      if (!vPct.valido) return { tramos: [], error: n + vPct.error };
      monto = { descuentoPct: vPct.valor };
    } else {
      const vPrecio = validarMonto(f.precio, { etiqueta: 'precio de la oferta', permiteCero: false, maximo: 50_000_000 });
      if (!vPrecio.valido) return { tramos: [], error: n + vPrecio.error };
      monto = { precio: vPrecio.valor };
    }
    tramos.push({
      desde: vDesde.valor,
      ...monto,
      vigenteDesde: f.conFechas ? f.vigenteDesde || null : null,
      vigenteHasta: f.conFechas ? f.vigenteHasta || null : null,
    });
  }
  const errores = validarTramos(tramos, precioLista);
  if (errores.length) return { tramos: [], error: `Oferta ${errores[0].indice + 1}: ${errores[0].mensaje}` };
  return { tramos, error: null };
}

export function OfertasEImpuesto({
  filas, onFilas, precioLista, impuestos, impuestoId, onImpuesto, esAdmin,
}: {
  filas: FilaOferta[];
  onFilas: (f: FilaOferta[]) => void;
  precioLista: number;
  impuestos: ImpuestoAdicional[];
  impuestoId: string | null;
  onImpuesto: (id: string | null) => void;
  esAdmin: boolean;
}) {
  const cambiar = (clave: string, cambio: Partial<FilaOferta>) =>
    onFilas(filas.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  const activos = impuestos.filter((i) => i.activo || i.id === impuestoId);

  return (
    <>
      <section className="rounded-xl border border-[var(--borde)] p-3" aria-labelledby="titulo-ofertas">
        <h3 id="titulo-ofertas" className="font-semibold text-sm">Precio por mayor y ofertas</h3>
        <p className="text-xs text-[var(--texto-suave)] mt-0.5 mb-3">
          Precio por mayor: desde 3 unidades a $1.400 c/u. Al llevar 3 o más, <strong>todas</strong> las
          unidades quedan a ese precio; con 2, precio normal. Es del producto, vale para cualquier
          cliente. Con fechas, es una promoción.
        </p>

        <ul className="space-y-3">
          {filas.map((f, i) => {
            const vD = validarCantidad(f.desde, { maximo: 1_000_000 });
            const vP = f.modo === 'pct'
              ? validarCantidad(f.precio, { maximo: 99.99 })
              : validarMonto(f.precio, { permiteCero: false, maximo: 50_000_000 });
            const cu = vP.valido && vP.valor > 0
              ? precioDelTramo(f.modo === 'pct' ? { desde: 1, descuentoPct: vP.valor } : { desde: 1, precio: vP.valor }, precioLista)
              : null;
            const ejemplo = vD.valido && vD.valor >= 1 && cu != null && precioLista > cu
              ? `${f.desde} ${vD.valor === 1 ? 'unidad' : 'unidades'} = ${formatCLP(vD.valor * cu)}${f.modo === 'pct' ? ` (${formatCLP(cu)} c/u)` : ''} · ahorra ${formatCLP(vD.valor * (precioLista - cu))}`
              : null;
            return (
              <li key={f.clave} className="rounded-lg bg-[var(--fondo)] p-2.5">
                <div className="flex items-end gap-2">
                  <label className="flex-1 min-w-0">
                    <span className="block text-xs mb-1">Desde (unidades)</span>
                    <input
                      inputMode="numeric" value={f.desde}
                      onChange={(e) => cambiar(f.clave, { desde: e.target.value })}
                      aria-label={`Oferta ${i + 1}: desde cuántas unidades`}
                      className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] bg-white num text-right"
                    />
                  </label>
                  <label className="flex-1 min-w-0">
                    <span className="block text-xs mb-1">{f.modo === 'pct' ? '% menos' : 'Precio c/u'}</span>
                    <input
                      inputMode={f.modo === 'pct' ? 'decimal' : 'numeric'} value={f.precio}
                      onChange={(e) => cambiar(f.clave, { precio: e.target.value })}
                      aria-label={f.modo === 'pct' ? `Oferta ${i + 1}: porcentaje de rebaja` : `Oferta ${i + 1}: precio de cada unidad`}
                      className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] bg-white num text-right"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => onFilas(filas.filter((x) => x.clave !== f.clave))}
                    aria-label={`Quitar la oferta ${i + 1}`}
                    className="tap px-3 rounded-lg text-sm text-[var(--color-alerta)]"
                  >
                    Quitar
                  </button>
                </div>
                {ejemplo && <p className="text-xs text-marca-700 mt-1.5 num">{ejemplo}</p>}
                <button
                  type="button"
                  onClick={() => cambiar(f.clave, { modo: f.modo === 'pct' ? 'precio' : 'pct', precio: '' })}
                  className="tap mt-1 text-sm underline text-[var(--texto-suave)]"
                >
                  {f.modo === 'pct' ? 'Usar un precio fijo en vez de %' : 'Usar un % de rebaja en vez de precio'}
                </button>

                <label className="flex items-center gap-2 mt-2 text-sm cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox" checked={f.conFechas}
                    onChange={(e) => cambiar(f.clave, { conFechas: e.target.checked })}
                    className="w-5 h-5 accent-[var(--color-marca-500)]"
                  />
                  Solo entre fechas (promoción)
                </label>
                {f.conFechas && (
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className="block text-xs mb-1">Desde el</span>
                      <input
                        type="date" value={f.vigenteDesde}
                        onChange={(e) => cambiar(f.clave, { vigenteDesde: e.target.value })}
                        className="tap w-full px-2 py-2 rounded-lg border border-[var(--borde)] bg-white text-sm"
                      />
                    </label>
                    <label>
                      <span className="block text-xs mb-1">Hasta el</span>
                      <input
                        type="date" value={f.vigenteHasta}
                        onChange={(e) => cambiar(f.clave, { vigenteHasta: e.target.value })}
                        className="tap w-full px-2 py-2 rounded-lg border border-[var(--borde)] bg-white text-sm"
                      />
                    </label>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => onFilas([...filas, {
            clave: `n${Date.now()}`, desde: filas.length ? '' : '3', modo: 'precio', precio: '',
            conFechas: false, vigenteDesde: '', vigenteHasta: '',
          }])}
          className="tap w-full mt-3 rounded-lg border border-dashed border-[var(--borde)] text-sm font-medium"
        >
          + Agregar oferta
        </button>
      </section>

      <section className="rounded-xl border border-[var(--borde)] p-3" aria-labelledby="titulo-impuesto">
        <h3 id="titulo-impuesto" className="font-semibold text-sm">Impuesto adicional</h3>
        <p className="text-xs text-[var(--texto-suave)] mt-0.5 mb-2">
          Para bebidas (IABA) y alcoholes (ILA). El precio de venta ya lo incluye: el sistema lo
          separa en la boleta.
        </p>
        <select
          value={impuestoId ?? ''}
          onChange={(e) => onImpuesto(e.target.value || null)}
          aria-label="Impuesto adicional"
          className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] bg-white"
        >
          <option value="">Ninguno (solo IVA)</option>
          {activos.map((i) => (
            <option key={i.id} value={i.id}>
              {etiquetaAdicional(i)}{i.activo ? '' : ' (desactivado)'}
            </option>
          ))}
        </select>
        {impuestos.length === 0 && (
          <p className="text-xs text-[var(--texto-suave)] mt-2">
            Todavía no hay impuestos configurados.{' '}
            {esAdmin
              ? <Link href="/configuracion" className="underline">Configurarlos</Link>
              : 'Pídele al administrador que los configure.'}
          </p>
        )}
      </section>
    </>
  );
}
