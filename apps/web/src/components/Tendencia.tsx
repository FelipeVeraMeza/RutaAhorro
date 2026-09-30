'use client';

import { useEffect, useState } from 'react';
import {
  formatCLP, serieCompleta, periodoAnterior, variacionPct, textoVariacion, sumaTotales, sumarDias,
  type PuntoDia,
} from '@rutaahorro/core';
import { repoReportes, hoyLocal } from '@/lib/datos/reportes';
import { useConfiguracion } from '@/lib/datos/configuracion';
import { GraficoVentas } from './GraficoVentas';

const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Una variación con texto y signo, no solo color (RNF-46). */
export function Variacion({ pct, contra }: { pct: number | null; contra: string }) {
  const t = textoVariacion(pct);
  if (t === null) return <span className="text-xs text-[var(--texto-suave)]">sin datos para comparar con {contra}</span>;
  const clase = pct! > 0 ? 'insignia-ok' : pct! < 0 ? 'insignia-alerta' : 'insignia-neutra';
  return (
    <span className="text-xs text-[var(--texto-suave)]">
      <span className={`insignia ${clase} num`}>{pct! > 0 ? '▲' : pct! < 0 ? '▼' : '='} {t}</span> vs {contra}
    </span>
  );
}

/**
 * Los últimos 30 días en el Inicio (RF-M7-10) y cómo van contra antes
 * (RF-M7-11). Antes el dueño veía solo "Vendido hoy": un número sin contexto
 * no dice si el día va bien o mal.
 */
export function Tendencia() {
  const { zonaHoraria } = useConfiguracion();
  const [datos, setDatos] = useState<{ serie: PuntoDia[]; anterior: PuntoDia[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const hoy = hoyLocal(zonaHoraria);
    const desde = sumarDias(hoy, -29);
    const previo = periodoAnterior(desde, hoy);
    let vivo = true;
    void repoReportes().ventasPorDia({ desde: previo.desde, hasta: hoy })
      .then((filas) => {
        if (!vivo) return;
        const puntos = filas.map((f) => ({ fecha: f.fecha, total: f.total, ventas: f.ventas }));
        setDatos({
          serie: serieCompleta(puntos, desde, hoy),
          anterior: serieCompleta(puntos, previo.desde, previo.hasta),
        });
      })
      .catch(() => { if (vivo) setError(true); });
    return () => { vivo = false; };
  }, [zonaHoraria]);

  if (error) {
    return <p role="alert" className="tarjeta p-4 text-sm text-[var(--color-alerta)]">No pudimos cargar las ventas de los últimos días.</p>;
  }
  if (!datos) {
    return <div className="tarjeta p-4 h-[212px] animate-pulse" aria-busy="true" aria-label="Cargando las ventas de los últimos 30 días" />;
  }

  const actual = sumaTotales(datos.serie);
  const antes = sumaTotales(datos.anterior);
  const hoy = datos.serie[datos.serie.length - 1];
  const haceUnaSemana = datos.serie[datos.serie.length - 8];
  const [y, m, d] = hoy.fecha.split('-').map(Number);
  const diaSemana = DIAS_LARGOS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

  return (
    <section className="tarjeta p-4" aria-labelledby="t-tendencia">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="t-tendencia" className="font-semibold text-sm">Últimos 30 días</h2>
        <p className="num font-bold">{formatCLP(actual.total)}</p>
      </div>
      <div className="flex flex-col gap-1 mt-1 mb-3">
        <Variacion pct={variacionPct(actual.total, antes.total)} contra="los 30 días anteriores" />
        {haceUnaSemana && (
          <Variacion pct={variacionPct(hoy.total, haceUnaSemana.total)} contra={`el ${diaSemana} pasado (hoy)`} />
        )}
      </div>
      <GraficoVentas puntos={datos.serie} />
    </section>
  );
}
