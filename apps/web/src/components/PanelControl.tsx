'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCLP } from '@rutaahorro/core';
import { avisosSinLeer, marcarAvisosLeidos, cajasOlvidadas, type Aviso, type CajaOlvidada } from '@/lib/datos/avisos';
import { repoReportes, hoyLocal } from '@/lib/datos/reportes';
import { useConfiguracion } from '@/lib/datos/configuracion';
import { porVencer, type FacturaProveedor } from '@/lib/datos/porPagar';
import { Icono } from './Icono';

/**
 * Lo que el jefe tiene que mirar además de las ventas: avisos del sistema
 * (RF-M8-07), cajas olvidadas abiertas (RF-M8-08) y cuánto se perdió en
 * mermas este mes (RF-M4-24, solo quien ve costos), y las facturas de
 * proveedores que vencen esta semana (RF-M3-13).
 */
export function PanelControl({ usuarioId, verCostos, verPorPagar = false }: {
  usuarioId: string; verCostos: boolean;
  /** RF-M3-13 · admin y supervisor. */
  verPorPagar?: boolean;
}) {
  const { zonaHoraria, horasAvisoCaja } = useConfiguracion();
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [cajas, setCajas] = useState<CajaOlvidada[]>([]);
  const [merma, setMerma] = useState<{ perdida: number; movimientos: number } | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [facturas, setFacturas] = useState<Array<FacturaProveedor & { dias: number }>>([]);

  useEffect(() => {
    void avisosSinLeer().then(setAvisos).catch(() => setAvisos([]));
    void cajasOlvidadas(horasAvisoCaja).then(setCajas).catch(() => {});
    if (verPorPagar) void porVencer(zonaHoraria, 7).then(setFacturas).catch(() => {});
    if (verCostos) {
      const hoy = hoyLocal(zonaHoraria);
      void repoReportes().ajustes({ desde: `${hoy.slice(0, 8)}01`, hasta: hoy }).then((a) => setMerma({
        perdida: Math.abs(a.filter((x) => x.impacto < 0).reduce((s, x) => s + x.impacto, 0)),
        movimientos: a.filter((x) => x.cantidad < 0).length,
      })).catch(() => {});
    }
  }, [zonaHoraria, horasAvisoCaja, verCostos, verPorPagar]);

  async function marcarLeidos() {
    if (!avisos) return;
    setMarcando(true);
    try { await marcarAvisosLeidos(avisos.map((a) => a.id), usuarioId); setAvisos([]); }
    catch { /* quedan visibles; se reintenta */ }
    finally { setMarcando(false); }
  }

  const hayAlgo = (avisos?.length ?? 0) > 0 || cajas.length > 0 || (merma && merma.perdida > 0) || facturas.length > 0;
  if (!hayAlgo) return null;

  return (
    <section className="tarjeta p-4 space-y-3" aria-labelledby="t-control">
      <h2 id="t-control" className="font-semibold text-sm flex items-center gap-2">
        <Icono nombre="alerta" tamano={18} className="text-[var(--color-aviso)]" /> Para revisar
      </h2>

      {cajas.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[var(--texto-suave)] mb-1">Cajas abiertas hace más de {horasAvisoCaja} h</p>
          <ul className="space-y-1">
            {cajas.map((c) => (
              <li key={c.id} className="text-sm flex justify-between gap-2">
                <span><span className="insignia insignia-alerta">Abierta {c.horas} h</span> {c.nombre}</span>
                <Link href="/caja" prefetch={false} className="tap -my-2 inline-flex items-center text-xs text-marca-700 underline">Cerrarla</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* RF-M3-13 · lo que vence en los próximos 7 días (o ya venció). */}
      {facturas.length > 0 && (
        <div data-por-vencer>
          <p className="text-xs font-medium text-[var(--texto-suave)] mb-1">
            Facturas de proveedores por pagar esta semana ({formatCLP(facturas.reduce((s, f) => s + f.monto, 0))})
          </p>
          <ul className="space-y-1">
            {facturas.slice(0, 5).map((f) => (
              <li key={f.id} className="text-sm flex justify-between gap-2">
                <span className="min-w-0">
                  <span className={`insignia ${f.dias <= 0 ? 'insignia-alerta' : 'insignia-aviso'}`}>
                    {f.dias < 0 ? `Vencida hace ${-f.dias} d` : f.dias === 0 ? 'Vence hoy' : `En ${f.dias} d`}
                  </span>{' '}{f.proveedor} · N° {f.numero}
                </span>
                <span className="num shrink-0">{formatCLP(f.monto)}</span>
              </li>
            ))}
          </ul>
          <Link href="/proveedores?vista=pagar" prefetch={false} className="tap -my-1 inline-flex items-center text-xs text-marca-700 underline">
            Ver por pagar
          </Link>
        </div>
      )}

      {merma && merma.perdida > 0 && (
        <p className="text-sm flex justify-between gap-2">
          <span>Pérdidas por merma y ajustes este mes <span className="text-xs text-[var(--texto-suave)]">({merma.movimientos} {merma.movimientos === 1 ? 'movimiento' : 'movimientos'})</span></span>
          <Link href="/reportes?vista=ajustes" prefetch={false} className="num font-semibold text-[var(--color-alerta)] underline">{formatCLP(merma.perdida)}</Link>
        </p>
      )}

      {avisos && avisos.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="text-xs font-medium text-[var(--texto-suave)]">Avisos del sistema ({avisos.length})</p>
            <button onClick={() => void marcarLeidos()} disabled={marcando} className="tap -my-2 px-1 text-xs underline text-[var(--texto-suave)]">
              {marcando ? 'Marcando…' : 'Marcar como vistos'}
            </button>
          </div>
          <ul className="space-y-1">
            {avisos.slice(0, 6).map((a) => (
              <li key={a.id} className="text-sm flex gap-2">
                <span className={`insignia shrink-0 h-fit ${a.gravedad === 'critical' ? 'insignia-alerta' : 'insignia-aviso'}`}>
                  {a.gravedad === 'critical' ? 'Urgente' : 'Aviso'}
                </span>
                <span>{a.texto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
