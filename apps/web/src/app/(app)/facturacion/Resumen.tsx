'use client';
import { Icono } from '@/components/Icono';

import { useEffect, useState } from 'react';
import { formatCLP, toUserMessage, aCSV, nombreArchivoReporte, type ColumnaCSV } from '@rutaahorro/core';
import { repoFacturacion, type ResumenMes } from '@/lib/datos/facturacion';

const nombreMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  return new Date(a, m - 1, 15).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
};

/**
 * Compras y ventas por mes (0026): neto, IVA y total, y la diferencia entre
 * el IVA de las ventas (débito) y el de las compras (crédito), que es lo que
 * se paga en el F29. Es una estimación para conversar con el contador: el F29
 * lo declara él, con PPM, remanentes y todo lo que esto no sabe.
 */
export function Resumen() {
  const [meses, setMeses] = useState<ResumenMes[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void repoFacturacion().resumen(12).then(setMeses).catch((e) => setError(toUserMessage(e)));
  }, []);

  function exportar() {
    if (!meses) return;
    const columnas: ReadonlyArray<ColumnaCSV<ResumenMes>> = [
      { titulo: 'Mes', valor: (m) => m.mes.slice(0, 7) },
      { titulo: 'Boletas', valor: (m) => m.ventas.boletas },
      { titulo: 'Facturas emitidas', valor: (m) => m.ventas.facturas },
      { titulo: 'Notas de crédito', valor: (m) => m.ventas.notas },
      { titulo: 'Ventas con voucher', valor: (m) => m.ventas.voucher },
      { titulo: 'Ventas neto', valor: (m) => m.ventas.neto },
      { titulo: 'Ventas IVA (débito)', valor: (m) => m.ventas.iva },
      { titulo: 'Ventas impuestos adicionales', valor: (m) => m.ventas.adicionales },
      { titulo: 'Ventas total', valor: (m) => m.ventas.total },
      { titulo: 'Compras documentos', valor: (m) => m.compras.documentos },
      { titulo: 'Compras neto', valor: (m) => m.compras.neto },
      { titulo: 'Compras IVA (crédito)', valor: (m) => m.compras.iva },
      { titulo: 'Compras otros impuestos', valor: (m) => m.compras.otros },
      { titulo: 'Compras total', valor: (m) => m.compras.total },
      { titulo: 'IVA débito - crédito', valor: (m) => m.ventas.iva - m.compras.iva },
      { titulo: 'Incluye documentos simulados', valor: (m) => (m.ventas.simulados ? 'sí' : 'no') },
    ];
    const url = URL.createObjectURL(new Blob([aCSV(meses, columnas)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivoReporte('Compras y ventas por mes');
    // Como en Reportes: revocar la URL en la misma vuelta que el clic
    // cancela la descarga en Safari de iPhone.
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (error) return <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>;
  if (!meses) return <p className="text-sm text-[var(--texto-suave)] py-8 text-center" aria-busy="true">Cargando…</p>;
  if (meses.length === 0) return <p className="text-sm text-[var(--texto-suave)] py-10 text-center">Todavía no hay ventas ni compras con documento.</p>;

  return (
    <>
      <p className="text-xs text-[var(--texto-suave)] mb-3">
        Ventas: boletas y facturas (del POS y manuales) menos notas de crédito, más lo cobrado con voucher de la máquina.
        Compras: las facturas recibidas registradas. El F29 lo declara el contador; esto sirve para revisarlo.
      </p>
      <ul className="space-y-3">
        {meses.map((m) => {
          const pagar = m.ventas.iva - m.compras.iva;
          return (
            <li key={m.mes} className="tarjeta p-3">
              <p className="font-semibold capitalize mb-2">{nombreMes(m.mes)}</p>
              {m.ventas.simulados && (
                <p className="text-xs bg-amber-50 text-amber-900 px-2 py-1 rounded mb-2">
                  Incluye documentos simulados: no son ventas declaradas al SII.
                </p>
              )}
              <table className="w-full text-sm num">
                <caption className="sr-only">Ventas y compras de {nombreMes(m.mes)}</caption>
                <thead>
                  <tr className="text-xs text-[var(--texto-suave)]">
                    <th className="text-left font-normal" />
                    <th className="text-right font-normal">Neto</th>
                    <th className="text-right font-normal">IVA</th>
                    <th className="text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className="text-left font-medium">Ventas</th>
                    <td className="text-right">{formatCLP(m.ventas.neto)}</td>
                    <td className="text-right">{formatCLP(m.ventas.iva)}</td>
                    <td className="text-right">{formatCLP(m.ventas.total)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-left font-medium">Compras</th>
                    <td className="text-right">{formatCLP(m.compras.neto)}</td>
                    <td className="text-right">{formatCLP(m.compras.iva)}</td>
                    <td className="text-right">{formatCLP(m.compras.total)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-[var(--texto-suave)] mt-2">
                {m.ventas.boletas} boletas · {m.ventas.facturas} facturas · {m.ventas.notas} notas de crédito
                · {m.ventas.voucher} con voucher · {m.compras.documentos} documentos de compra
                {m.ventas.adicionales > 0 && ` · impuestos adicionales ${formatCLP(m.ventas.adicionales)}`}
              </p>
              <p className="text-sm mt-2 flex justify-between gap-2 border-t border-[var(--borde)] pt-2">
                <span>{pagar >= 0 ? 'IVA a pagar (estimado)' : 'Remanente de IVA (estimado)'}</span>
                <strong className="num">{formatCLP(Math.abs(pagar))}</strong>
              </p>
            </li>
          );
        })}
      </ul>
      <button onClick={exportar} className="btn btn-secundario w-full mt-3">
        <Icono nombre="descargar" tamano={18} /> Exportar a Excel
      </button>
    </>
  );
}
