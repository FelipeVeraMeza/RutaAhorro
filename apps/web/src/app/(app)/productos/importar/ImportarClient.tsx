'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  parsearProductos, plantillaCSV, formatCLP, COLUMNAS, COLUMNAS_OBLIGATORIAS,
  type ResultadoImportacion, toUserMessage,
} from '@rutaahorro/core';
import { repoProductos, type ResultadoLote } from '@/lib/productos';

type Paso = 'elegir' | 'revisar' | 'aplicando' | 'listo';

export function ImportarClient() {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>('elegir');
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [analisis, setAnalisis] = useState<ResultadoImportacion | null>(null);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const [error, setError] = useState<string | null>(null);

  function descargarPlantilla() {
    const blob = new Blob([plantillaCSV()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-productos-rutaahorro.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function elegirArchivo(file: File) {
    setError(null);
    setNombreArchivo(file.name);
    try {
      const texto = await file.text();
      setAnalisis(parsearProductos(texto));
      setPaso('revisar');
    } catch (e) {
      setError(toUserMessage(e));
    }
  }

  async function aplicar() {
    if (!analisis?.ok) return;
    setPaso('aplicando');
    setError(null);
    try {
      setResultado(await repoProductos().importarLote(analisis.filas));
      setPaso('listo');
    } catch (e) {
      setError(toUserMessage(e));
      setPaso('revisar');
    }
  }

  // ------------------------------------------------------------- paso 1
  if (paso === 'elegir') {
    return (
      <div className="px-4 py-5 space-y-4">
        <Cabecera />

        <section className="tarjeta p-4">
          <h2 className="font-semibold text-sm mb-1">1 · Descarga la plantilla</h2>
          <p className="text-sm text-[var(--texto-suave)] mb-3">
            Ábrela en Excel, reemplaza las filas de ejemplo por tus productos y guárdala como CSV.
          </p>
          <button
            onClick={descargarPlantilla}
            className="tap w-full py-3 rounded-xl border border-[var(--borde)] font-medium text-sm"
          >
            ⬇ Descargar plantilla CSV
          </button>

          <details className="mt-3">
            <summary className="text-sm font-medium cursor-pointer">Ver qué significa cada columna</summary>
            <ul className="mt-2 space-y-1 text-xs text-[var(--texto-suave)]">
              {COLUMNAS.map((c) => (
                <li key={c}>
                  <code className="font-medium text-[var(--texto)]">{c}</code>
                  {(COLUMNAS_OBLIGATORIAS as readonly string[]).includes(c) && (
                    <span className="text-[var(--color-alerta)]"> · obligatoria</span>
                  )}
                  {' — '}{DESCRIPCIONES[c]}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section className="tarjeta p-4">
          <h2 className="font-semibold text-sm mb-1">2 · Sube tu archivo</h2>
          <p className="text-sm text-[var(--texto-suave)] mb-3">
            Revisaremos todo antes de cargar nada. Si hay errores, te diremos en qué fila están.
          </p>
          <label className="tap flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-[var(--borde)] cursor-pointer">
            <span className="text-3xl" aria-hidden>📄</span>
            <span className="text-sm font-medium">Elegir archivo CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void elegirArchivo(f); }}
            />
          </label>
        </section>

        {error && (
          <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------- paso 2
  if (paso === 'revisar' && analisis) {
    const { ok, filas, errores, avisos, totalFilas } = analisis;

    return (
      <div className="px-4 py-5 space-y-4">
        <Cabecera />

        <div className={`tarjeta p-4 ${ok ? 'border-marca-300' : 'border-[var(--color-alerta)]'}`}>
          <p className="text-xs text-[var(--texto-suave)] truncate mb-1">{nombreArchivo}</p>
          {ok ? (
            <>
              <p className="text-lg font-semibold text-marca-700">
                ✅ {filas.length} {filas.length === 1 ? 'producto listo' : 'productos listos'} para cargar
              </p>
              <p className="text-sm text-[var(--texto-suave)]">
                Se revisaron {totalFilas} filas y todas están correctas.
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-[var(--color-alerta)]">
                ⛔ {errores.length} {errores.length === 1 ? 'error encontrado' : 'errores encontrados'}
              </p>
              <p className="text-sm text-[var(--texto-suave)]">
                <strong>No se cargó ningún producto.</strong> Corrige el archivo y vuelve a subirlo.
              </p>
            </>
          )}
        </div>

        {errores.length > 0 && (
          <section className="tarjeta p-4">
            <h2 className="font-semibold text-sm mb-2 text-[var(--color-alerta)]">
              Errores que debes corregir
            </h2>
            <ul className="divide-y divide-[var(--borde)] text-sm">
              {errores.slice(0, 50).map((e, i) => (
                <li key={i} className="py-2">
                  <p className="font-medium">
                    Fila {e.fila}
                    {e.columna && <span className="text-[var(--texto-suave)]"> · columna {e.columna}</span>}
                  </p>
                  <p className="text-[var(--color-alerta)]">{e.mensaje}</p>
                  {e.valor && (
                    <p className="text-xs text-[var(--texto-suave)]">
                      Valor encontrado: <code>{e.valor}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {errores.length > 50 && (
              <p className="text-xs text-[var(--texto-suave)] mt-2">
                …y {errores.length - 50} errores más.
              </p>
            )}
          </section>
        )}

        {avisos.length > 0 && (
          <section className="tarjeta p-4">
            <h2 className="font-semibold text-sm mb-1 text-[var(--color-aviso)]">
              Avisos ({avisos.length})
            </h2>
            <p className="text-xs text-[var(--texto-suave)] mb-2">
              No impiden la carga, pero conviene revisarlos.
            </p>
            <ul className="divide-y divide-[var(--borde)] text-sm">
              {avisos.slice(0, 20).map((a, i) => (
                <li key={i} className="py-2">
                  <span className="font-medium">Fila {a.fila}</span>
                  <span className="text-[var(--color-aviso)]"> · {a.mensaje}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {filas.length > 0 && (
          <section className="tarjeta p-4">
            <h2 className="font-semibold text-sm mb-2">
              Vista previa {!ok && <span className="font-normal text-[var(--texto-suave)]">(no se cargará)</span>}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--texto-suave)] border-b border-[var(--borde)]">
                    <th className="py-2 pr-3 font-medium">Producto</th>
                    <th className="py-2 px-3 font-medium text-right">Precio</th>
                    <th className="py-2 px-3 font-medium text-right">Costo</th>
                    <th className="py-2 pl-3 font-medium text-right">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.slice(0, 15).map((f, i) => (
                    <tr key={i} className="border-b border-[var(--borde)] last:border-0">
                      <td className="py-2 pr-3">
                        <span className="block truncate max-w-[14rem]">{f.nombre}</span>
                        <span className="text-xs text-[var(--texto-suave)]">
                          {f.sku ?? 'sin SKU'}{f.perecible && ' · perecible'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right num">{formatCLP(f.precio_venta)}</td>
                      <td className="py-2 px-3 text-right num text-[var(--texto-suave)]">
                        {formatCLP(f.costo)}
                      </td>
                      <td className="py-2 pl-3 text-right num">{f.stock_inicial}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filas.length > 15 && (
              <p className="text-xs text-[var(--texto-suave)] mt-2">
                …y {filas.length - 15} productos más.
              </p>
            )}
          </section>
        )}

        {error && (
          <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => { setPaso('elegir'); setAnalisis(null); }}
            className="tap px-4 py-3.5 rounded-xl border border-[var(--borde)] font-medium"
          >
            Volver
          </button>
          <button
            onClick={() => void aplicar()}
            disabled={!ok}
            className="tap flex-1 py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-40"
          >
            {ok ? `Cargar ${filas.length} productos` : 'Corrige los errores primero'}
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- paso 3
  if (paso === 'aplicando') {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-4xl mb-3 animate-pulse" aria-hidden>📦</p>
        <p className="font-medium">Cargando productos…</p>
        <p className="text-sm text-[var(--texto-suave)]">No cierres esta pantalla.</p>
      </div>
    );
  }

  // ------------------------------------------------------------- paso 4
  return (
    <div className="px-4 py-5 space-y-4">
      <Cabecera />
      <div className="tarjeta p-5 text-center">
        <p className="text-4xl mb-3" aria-hidden>🎉</p>
        <h2 className="text-lg font-semibold mb-1">Carga completada</h2>
        <p className="text-sm text-[var(--texto-suave)] mb-4">
          {resultado?.creados ?? 0} creados
          {(resultado?.actualizados ?? 0) > 0 && ` · ${resultado?.actualizados} actualizados`}
          {(resultado?.errores.length ?? 0) > 0 && ` · ${resultado?.errores.length} con problemas`}
        </p>

        {(resultado?.errores.length ?? 0) > 0 && (
          <ul className="text-left text-sm border-t border-[var(--borde)] pt-3 mb-4 space-y-1">
            {resultado!.errores.slice(0, 10).map((e, i) => (
              <li key={i}>
                <span className="font-medium">Fila {e.fila}</span> · {e.nombre}
                <span className="block text-xs text-[var(--color-alerta)]">{e.mensaje}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => { setPaso('elegir'); setAnalisis(null); setResultado(null); }}
            className="tap flex-1 py-3 rounded-xl border border-[var(--borde)] font-medium"
          >
            Cargar otro archivo
          </button>
          <button
            onClick={() => router.push('/productos')}
            className="tap flex-1 py-3 rounded-xl bg-marca-500 text-white font-semibold"
          >
            Ver productos
          </button>
        </div>
      </div>
    </div>
  );
}

function Cabecera() {
  return (
    <div className="flex items-center gap-3">
      <Link href="/productos" className="tap text-sm text-[var(--texto-suave)]">
        ← Productos
      </Link>
      <h1 className="text-lg font-semibold">Carga masiva</h1>
    </div>
  );
}

const DESCRIPCIONES: Record<string, string> = {
  nombre: 'cómo se llama el producto',
  sku: 'tu código interno; si se repite, el producto se actualiza en vez de duplicarse',
  codigo_barras: 'el código del envase',
  categoria: 'se crea sola si no existe',
  precio_venta: 'precio al público, con IVA incluido',
  costo: 'cuánto te cuesta a ti',
  unidad: 'unidad, kg, gramo, litro, ml, paquete o caja',
  stock_inicial: 'cuántas unidades tienes hoy',
  stock_minimo: 'bajo esta cantidad te avisamos',
  perecible: 'si o no; si es sí, se controla por lote y vencimiento',
  dias_alerta: 'cuántos días antes avisar el vencimiento',
};
