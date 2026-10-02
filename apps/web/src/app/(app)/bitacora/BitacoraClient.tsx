'use client';

import { useEffect, useState } from 'react';
import { toUserMessage } from '@rutaahorro/core';
import { leerBitacora, ACCIONES, type EntradaBitacora } from '@/lib/datos/bitacora';
import { hoyLocal, hace } from '@/lib/datos/reportes';
import { useConfiguracion } from '@/lib/datos/configuracion';
import { useFormatoFecha } from '@/lib/formatoFecha';
import { Encabezado, EstadoVacio } from '@/components/Encabezado';

/** La bitácora de auditoría, para leerla y filtrarla (RF-M9-11). */
export function BitacoraClient() {
  const { zonaHoraria: zona } = useConfiguracion();
  const { fechaHora } = useFormatoFecha();
  const [desde, setDesde] = useState(hace(6, zona));
  const [hasta, setHasta] = useState(hoyLocal(zona));
  useEffect(() => { setDesde(hace(6, zona)); setHasta(hoyLocal(zona)); }, [zona]);
  const [accion, setAccion] = useState('');
  const [filas, setFilas] = useState<EntradaBitacora[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setFilas(null);
    setError(null); // antes el error de una consulta quedaba pegado sobre las siguientes
    void leerBitacora(desde, hasta, accion || null)
      .then((f) => { if (vivo) setFilas(f); })
      .catch((e) => { if (vivo) { setError(toUserMessage(e)); setFilas([]); } });
    return () => { vivo = false; };
  }, [desde, hasta, accion]);

  return (
    <div className="px-4 py-5">
      <Encabezado
        titulo="Bitácora"
        icono="inventario"
        descripcion="Quién hizo qué y cuándo: cambios de precio, anulaciones, ajustes de stock, cierres de caja ajenos y cambios de cuentas. No se puede editar ni borrar."
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        <label className="text-xs text-[var(--texto-suave)]">Desde
          <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)}
            className="tap w-full mt-1 px-3 rounded-xl border border-[var(--borde)] bg-white text-sm num" />
        </label>
        <label className="text-xs text-[var(--texto-suave)]">Hasta
          <input type="date" value={hasta} min={desde} max={hoyLocal(zona)} onChange={(e) => setHasta(e.target.value)}
            className="tap w-full mt-1 px-3 rounded-xl border border-[var(--borde)] bg-white text-sm num" />
        </label>
        <label className="text-xs text-[var(--texto-suave)] col-span-2 sm:col-span-1">Qué
          <select value={accion} onChange={(e) => setAccion(e.target.value)}
            className="tap w-full mt-1 px-3 rounded-xl border border-[var(--borde)] bg-white text-sm">
            <option value="">Todo</option>
            {Object.entries(ACCIONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>}
      {filas === null ? (
        <p className="text-sm text-[var(--texto-suave)] text-center py-8">Cargando…</p>
      ) : filas.length === 0 ? (
        // Con error, "Nada registrado en estas fechas" decía algo falso: no se
        // sabe si hay o no. Queda solo el error.
        error ? null : desde > hasta ? (
          <p role="alert" className="text-sm text-[var(--color-alerta)]">La fecha de inicio es posterior a la de término.</p>
        ) : <EstadoVacio icono="inventario" titulo="Nada registrado en estas fechas" texto="Prueba con un rango más amplio o con otro tipo." />
      ) : (
        <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
          {filas.map((f) => (
            <li key={f.id} className="px-4 py-2.5">
              <p className="text-sm">
                <span className="insignia insignia-neutra mr-1.5">{f.nombre}</span>
                {f.texto}
              </p>
              <p className="text-xs text-[var(--texto-suave)] mt-0.5">{fechaHora(f.fecha)} · {f.quien ?? 'Sistema'}</p>
            </li>
          ))}
        </ul>
      )}
      {filas && filas.length >= 300 && (
        <p className="text-xs text-[var(--texto-suave)] mt-2">Se muestran los 300 más recientes: acota las fechas para ver el resto.</p>
      )}
    </div>
  );
}
