'use client';

import { useEffect, useState } from 'react';
import { formatCLP } from '@rutaahorro/core';
import { repoVentas } from '@/lib/datos/ventas';
import { hoyLocal } from '@/lib/datos/reportes';
import { useConfiguracion } from '@/lib/datos/configuracion';

/**
 * "Vendido hoy" en la maqueta, sumado desde las ventas que de verdad se
 * hicieron en el POS de este navegador. Antes era un número fijo
 * ($187.450): se vendía y no se movía.
 */
export function VentasHoyDemo() {
  const { zonaHoraria } = useConfiguracion();
  const [r, setR] = useState<{ total: number; n: number } | null>(null);

  useEffect(() => {
    const hoy = hoyLocal(zonaHoraria);
    void repoVentas().listar({ desde: hoy, hasta: hoy, incluirAnuladas: false, limite: 1000 })
      .then((v) => setR({ total: v.reduce((s, x) => s + x.total, 0), n: v.length }));
  }, [zonaHoraria]);

  const total = r?.total ?? 0;
  const n = r?.n ?? 0;
  return (
    <div className="grid grid-cols-3 gap-2">
      <Tarjeta label="Vendido hoy" value={r ? formatCLP(total) : '…'} />
      <Tarjeta label="Ventas" value={r ? String(n) : '…'} />
      <Tarjeta label="Ticket prom." value={r ? formatCLP(n ? Math.round(total / n) : 0) : '…'} />
    </div>
  );
}

function Tarjeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="tarjeta px-3 py-3">
      <p className="num text-base font-bold truncate">{value}</p>
      <p className="text-[11px] text-[var(--texto-suave)] mt-0.5">{label}</p>
    </div>
  );
}
