'use client';

import { useState } from 'react';
import { formatCLP, type PuntoDia } from '@rutaahorro/core';

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** 'AAAA-MM-DD' → "mar 29-09", sin pasar por la zona del navegador (regla 17). */
function etiquetaDia(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS[dow]} ${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
}

/**
 * Ventas por día (RF-M7-10). Una sola serie: un solo color, el de la marca.
 * Tocar o pasar sobre una barra muestra ese día arriba del gráfico; sin tocar
 * nada se ve el último. La tabla oculta dice lo mismo al lector de pantalla.
 */
export function GraficoVentas({ puntos, alto = 112, ultimoEsHoy = true }: { puntos: PuntoDia[]; alto?: number; ultimoEsHoy?: boolean }) {
  const [elegido, setElegido] = useState<number | null>(null);
  if (puntos.length === 0) return null;
  const maximo = Math.max(...puntos.map((p) => p.total), 1);
  const ancho = 100 / puntos.length;
  const i = elegido ?? puntos.length - 1;
  const p = puntos[i];

  return (
    <figure>
      <p className="text-sm num min-h-[1.5rem]" aria-live="polite">
        <span className="text-[var(--texto-suave)]">{etiquetaDia(p.fecha)}{elegido === null && ultimoEsHoy ? ' (hoy)' : ''}: </span>
        <strong>{formatCLP(p.total)}</strong>
        <span className="text-[var(--texto-suave)]"> · {p.ventas} {p.ventas === 1 ? 'venta' : 'ventas'}</span>
      </p>
      <div
        className="relative mt-1 border-b border-[var(--borde)]"
        style={{ height: alto }}
        onMouseLeave={() => setElegido(null)}
        aria-hidden
      >
        {puntos.map((d, k) => {
          const h = d.total > 0 ? Math.max((d.total / maximo) * (alto - 4), 3) : 0;
          return (
            <button
              key={d.fecha}
              type="button"
              tabIndex={-1}
              onMouseEnter={() => setElegido(k)}
              onClick={() => setElegido(k === elegido ? null : k)}
              className="absolute bottom-0 h-full flex items-end justify-center"
              style={{ left: `${k * ancho}%`, width: `${ancho}%`, minWidth: 0, minHeight: 0, padding: 0, fontSize: 0 }}
            >
              <span
                className={`block rounded-t-[4px] ${k === i ? 'bg-marca-700' : 'bg-marca-500'}`}
                style={{ height: h, width: 'calc(100% - 2px)', maxWidth: 18 }}
              />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-[var(--texto-suave)] mt-1 num" aria-hidden>
        <span>{etiquetaDia(puntos[0].fecha)}</span>
        <span>{ultimoEsHoy ? 'hoy' : etiquetaDia(puntos[puntos.length - 1].fecha)}</span>
      </div>
      <table className="sr-only">
        <caption>Ventas por día</caption>
        <thead><tr><th>Día</th><th>Vendido</th><th>Ventas</th></tr></thead>
        <tbody>
          {puntos.map((d) => (
            <tr key={d.fecha}><td>{etiquetaDia(d.fecha)}</td><td>{formatCLP(d.total)}</td><td>{d.ventas}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
