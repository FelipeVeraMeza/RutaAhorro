'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  formatCLP, etiquetaSvg, generateInternalBarcode, toUserMessage,
} from '@rutaahorro/core';
import { repoProductos, type Producto } from '@/lib/productos';

/**
 * Impresión de etiquetas con código de barra (RF-M2-13).
 *
 * Sirve para dos cosas distintas que el local necesita:
 *
 *  1. Etiquetar lo que no trae código de fábrica —lo que se vende a granel, lo
 *     que arma el local, el envase que llegó con el código borrado—. Para eso
 *     se le asigna un código interno del rango 200-299, reservado por GS1
 *     justamente para uso del comercio: nunca va a chocar con el de un
 *     producto de fábrica.
 *  2. Reponer la etiqueta de un producto cuyo código quedó ilegible.
 *
 * El SVG lo dibuja `@rutaahorro/core`, en milímetros y no en píxeles: una
 * etiqueta escalada a píxeles se ve bien en pantalla y sale ilegible para el
 * lector.
 */

/** Anchos de módulo por tamaño. Bajo 0,26 mm el lector empieza a fallar. */
const TAMANIOS = [
  { id: 'chica',  label: 'Chica',   anchoModulo: 0.26, altoBarras: 12 },
  { id: 'normal', label: 'Normal',  anchoModulo: 0.33, altoBarras: 18 },
  { id: 'grande', label: 'Grande',  anchoModulo: 0.43, altoBarras: 24 },
] as const;

type TamanioId = typeof TAMANIOS[number]['id'];

export function EtiquetasClient({ puedeVerCostos }: { puedeVerCostos: boolean }) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [generando, setGenerando] = useState<string | null>(null);

  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [tamanio, setTamanio] = useState<TamanioId>('normal');
  const [conPrecio, setConPrecio] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setProductos(await repoProductos().listar({ busqueda, soloActivos: true }, puedeVerCostos));
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setCargando(false);
    }
  }, [busqueda, puedeVerCostos]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 200);
    return () => clearTimeout(t);
  }, [cargar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const conCodigo = productos.filter((p) => p.codigos.length > 0);
  const sinCodigo = productos.filter((p) => p.codigos.length === 0);

  /**
   * Asigna un código interno al producto.
   *
   * El correlativo sale del catálogo ya cargado y no de una consulta: se busca
   * el mayor código interno existente y se suma uno. Preguntarle a la base por
   * cada código libre sería una consulta por intento, y el rango es del local:
   * nadie más lo escribe.
   */
  async function generarCodigo(p: Producto) {
    setGenerando(p.id);
    setError(null);
    try {
      const usados = productos
        .flatMap((x) => x.codigos)
        .filter((c) => /^200\d{10}$/.test(c))
        .map((c) => Number(c.slice(3, 12)));
      const siguiente = (usados.length > 0 ? Math.max(...usados) : 0) + 1;

      let codigo = generateInternalBarcode(siguiente);
      // Red de seguridad por si otro usuario asignó uno en paralelo.
      if (await repoProductos().codigoEnUso(codigo, p.id)) {
        codigo = generateInternalBarcode(siguiente + Math.floor(Math.random() * 500) + 1);
      }

      await repoProductos().actualizar(p.id, {
        nombre: p.nombre,
        descripcion: p.descripcion,
        sku: p.sku,
        categoriaId: p.categoriaId,
        unidad: p.unidad,
        precioVenta: p.precioVenta,
        stockMinimo: p.stockMinimo,
        perecible: p.perecible,
        diasAlerta: p.diasAlerta,
        codigos: [...p.codigos, codigo],
      });
      setAviso(`${p.nombre} quedó con el código ${codigo}`);
      setCantidades((c) => ({ ...c, [p.id]: c[p.id] ?? 1 }));
      await cargar();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGenerando(null);
    }
  }

  const opciones = TAMANIOS.find((t) => t.id === tamanio)!;

  /** Una entrada por etiqueta a imprimir: un producto repetido N veces. */
  const aImprimir = useMemo(() => {
    const salida: Array<{ clave: string; svg: string }> = [];
    for (const p of conCodigo) {
      const n = cantidades[p.id] ?? 0;
      if (n <= 0) continue;
      const svg = etiquetaSvg(p.codigos[0], {
        anchoModulo: opciones.anchoModulo,
        altoBarras: opciones.altoBarras,
        titulo: p.nombre,
        pie: conPrecio ? formatCLP(p.precioVenta) : undefined,
      });
      if (!svg) continue;   // código no imprimible: se omite, no se rompe la hoja
      for (let i = 0; i < n; i++) salida.push({ clave: `${p.id}-${i}`, svg });
    }
    return salida;
  }, [conCodigo, cantidades, opciones, conPrecio]);

  const noImprimibles = conCodigo.filter(
    (p) => (cantidades[p.id] ?? 0) > 0 && !etiquetaSvg(p.codigos[0]),
  );

  function cambiarCantidad(id: string, delta: number) {
    setCantidades((c) => ({ ...c, [id]: Math.max((c[id] ?? 0) + delta, 0) }));
  }

  return (
    <div className="px-4 py-5">
      <div className="flex items-center gap-3 mb-1 no-imprimir">
        <Link href="/productos" className="tap text-sm text-[var(--texto-suave)]">← Productos</Link>
        <h1 className="text-lg font-semibold">Etiquetas</h1>
      </div>
      <p className="text-sm text-[var(--texto-suave)] mb-4 no-imprimir">
        Imprime códigos de barra para los productos que no traen uno de fábrica.
        Se lee con el mismo escáner del punto de venta.
      </p>

      {aviso && (
        <p role="status" className="text-sm bg-marca-50 text-marca-900 px-3 py-2 rounded-lg mb-3 no-imprimir">
          ✅ {aviso}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3 no-imprimir">
          {error}
        </p>
      )}

      {/* Opciones de impresión */}
      <div className="tarjeta p-4 mb-3 no-imprimir">
        <p className="text-sm font-medium mb-2">Tamaño de la etiqueta</p>
        <div className="flex gap-2 mb-3">
          {TAMANIOS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTamanio(t.id)}
              aria-pressed={tamanio === t.id}
              className={`tap flex-1 py-2 rounded-lg text-sm border ${
                tamanio === t.id
                  ? 'border-marca-500 bg-marca-50 text-marca-900 font-medium'
                  : 'border-[var(--borde)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox" checked={conPrecio} onChange={(e) => setConPrecio(e.target.checked)}
            className="w-5 h-5 accent-[var(--color-marca-500)]"
          />
          Imprimir el precio en la etiqueta
        </label>
      </div>

      <input
        type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar producto…"
        aria-label="Buscar producto para etiquetar"
        className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white mb-3 no-imprimir"
      />

      {/* Sin código: hay que asignarles uno antes de poder etiquetar */}
      {!cargando && sinCodigo.length > 0 && (
        <div className="tarjeta p-4 mb-3 no-imprimir">
          <h2 className="font-semibold text-sm mb-1">
            Sin código de barra · {sinCodigo.length}
          </h2>
          <p className="text-xs text-[var(--texto-suave)] mb-3">
            Estos productos no se pueden escanear todavía. El código interno usa
            un rango reservado para el comercio, así que nunca choca con el de
            un producto de fábrica.
          </p>
          <ul className="divide-y divide-[var(--borde)]">
            {sinCodigo.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-sm min-w-0 truncate">{p.nombre}</span>
                <button
                  onClick={() => void generarCodigo(p)}
                  disabled={generando === p.id}
                  className="tap px-3 py-1.5 text-xs rounded-lg border border-[var(--borde)] shrink-0 disabled:opacity-50"
                >
                  {generando === p.id ? 'Generando…' : 'Generar código'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Con código: elegir cuántas etiquetas */}
      <div className="tarjeta overflow-hidden mb-3 no-imprimir">
        <h2 className="font-semibold text-sm px-4 pt-4 pb-2">
          Cuántas etiquetas de cada uno
        </h2>
        {cargando ? (
          <p className="text-sm text-[var(--texto-suave)] text-center py-6">Cargando…</p>
        ) : conCodigo.length === 0 ? (
          <p className="text-sm text-[var(--texto-suave)] text-center py-6 px-4">
            Ningún producto con código de barra coincide con la búsqueda.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--borde)]">
            {conCodigo.map((p) => {
              const n = cantidades[p.id] ?? 0;
              return (
                <li key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{p.nombre}</p>
                    <p className="text-xs text-[var(--texto-suave)] num">
                      {p.codigos[0]} · {formatCLP(p.precioVenta)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => cambiarCantidad(p.id, -1)}
                      disabled={n === 0}
                      aria-label={`Una etiqueta menos de ${p.nombre}`}
                      className="tap w-9 h-9 rounded-lg border border-[var(--borde)] disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="num w-8 text-center text-sm font-medium">{n}</span>
                    <button
                      onClick={() => cambiarCantidad(p.id, 1)}
                      aria-label={`Una etiqueta más de ${p.nombre}`}
                      className="tap w-9 h-9 rounded-lg border border-[var(--borde)]"
                    >
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {noImprimibles.length > 0 && (
        <p className="text-xs text-[var(--color-aviso)] bg-amber-50 px-3 py-2 rounded-lg mb-3 no-imprimir">
          {noImprimibles.length}{' '}
          {noImprimibles.length === 1 ? 'producto tiene un código' : 'productos tienen códigos'}{' '}
          que no corresponden a un EAN-13 y no se pueden dibujar:{' '}
          {noImprimibles.map((p) => p.nombre).join(', ')}
        </p>
      )}

      {/* Hoja de etiquetas: es lo único que se imprime */}
      {aImprimir.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2 no-imprimir">
            <p className="text-sm font-medium">
              Vista previa · {aImprimir.length}{' '}
              {aImprimir.length === 1 ? 'etiqueta' : 'etiquetas'}
            </p>
            <button
              onClick={() => setCantidades({})}
              className="tap px-3 py-1.5 text-xs rounded-lg border border-[var(--borde)]"
            >
              Vaciar
            </button>
          </div>

          <div id="hoja-etiquetas" className="flex flex-wrap gap-2 bg-white p-3 rounded-xl border border-[var(--borde)]">
            {aImprimir.map((e) => (
              <div
                key={e.clave}
                className="etiqueta"
                dangerouslySetInnerHTML={{ __html: e.svg }}
              />
            ))}
          </div>

          <div className="sticky bottom-20 lg:bottom-4 mt-3 no-imprimir">
            <button
              onClick={() => window.print()}
              className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold shadow-lg"
            >
              Imprimir {aImprimir.length}{' '}
              {aImprimir.length === 1 ? 'etiqueta' : 'etiquetas'}
            </button>
            <p className="text-[11px] text-[var(--texto-suave)] text-center mt-2">
              Imprime al 100 %, sin «ajustar a la página»: si la impresora
              escala la hoja, el lector deja de reconocer el código.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
