'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  formatCLP, parseCLP, validarCantidad, weightedAverageCost, costVariationPct,
  shouldWarnCostVariation, toUserMessage,
} from '@rutaahorro/core';
import {
  repoProveedores, buscarParaRecepcion, productoParaRecepcion,
  type Proveedor, type LineaRecepcion,
} from '@/lib/datos/proveedores';
import { findByBarcode } from '@/lib/offline/catalog';
import { useScanner } from '@/lib/scanner/useScanner';

const TIPOS = [
  { id: 'guia', label: 'Guía de despacho' },
  { id: 'factura', label: 'Factura' },
  { id: 'boleta', label: 'Boleta' },
  { id: 'sin_documento', label: 'Sin documento' },
];

const hoy = () => new Date().toISOString().slice(0, 10);

export function RecepcionClient() {
  const router = useRouter();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState('');
  const [tipoDoc, setTipoDoc] = useState('guia');
  const [documento, setDocumento] = useState('');

  const [lineas, setLineas] = useState<LineaRecepcion[]>([]);
  /**
   * Lo que el usuario tiene escrito en el campo de cantidad, por producto.
   *
   * La línea guarda `cantidad` como número, y el campo mostraba ese número
   * directamente. Escribir "1,5" —la coma decimal de Chile— pasaba por
   * `Number("1,")`, que es NaN, y el campo saltaba a 0 en mitad del tecleo: no
   * había forma de escribir media unidad. El texto crudo vive acá y el número
   * se deriva con `validarCantidad`, que sí entiende la coma.
   */
  const [cantidadTexto, setCantidadTexto] = useState<Record<string, string>>({});
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Awaited<ReturnType<typeof buscarParaRecepcion>>>([]);
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const agregar = useCallback((p: {
    productId: string; nombre: string; perecible: boolean;
    costoAnterior: number; stock: number;
  }) => {
    setLineas((prev) => {
      if (prev.some((l) => l.productId === p.productId)) {
        setAviso(`${p.nombre} ya está en la lista`);
        return prev;
      }
      return [...prev, {
        productId: p.productId,
        nombre: p.nombre,
        cantidad: 1,
        costoUnitario: p.costoAnterior,
        costoAnterior: p.costoAnterior,
        stock: p.stock,
        perecible: p.perecible,
        lote: '',
        vencimiento: '',
      }];
    });
    setBusqueda(''); setResultados([]);
  }, []);

  const { videoRef, start, stop, error: errorCamara } = useScanner({
    enabled: escaneando,
    onScan: async (code) => {
      const prod = await findByBarcode(code);
      if (!prod) {
        setAviso(`El código ${code} no está en el catálogo. Créalo primero en Productos.`);
        return;
      }
      // El lector solo entrega el código: el costo anterior y el stock hay que
      // buscarlos aparte. Antes se agregaba con costo 0 y eso apagaba el aviso
      // de variación (RF-M3-08) en toda línea escaneada.
      const datos = await productoParaRecepcion(prod.id, prod.name);
      agregar(datos ?? {
        productId: prod.id, nombre: prod.name,
        perecible: prod.tracksExpiry, costoAnterior: 0, stock: 0,
      });
    },
  });

  useEffect(() => { if (escaneando) void start(); else stop(); }, [escaneando, start, stop]);

  useEffect(() => {
    void repoProveedores().listar().then(setProveedores).catch(() => {});
  }, []);

  useEffect(() => {
    if (busqueda.trim().length < 2) { setResultados([]); return; }
    let vivo = true;
    void buscarParaRecepcion(busqueda).then((r) => { if (vivo) setResultados(r); });
    return () => { vivo = false; };
  }, [busqueda]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  function actualizar(id: string, cambios: Partial<LineaRecepcion>) {
    setLineas((prev) => prev.map((l) => (l.productId === id ? { ...l, ...cambios } : l)));
  }

  const total = lineas.reduce((s, l) => s + Math.round(l.cantidad * l.costoUnitario), 0);

  // Un perecible sin fecha no se puede recibir: sin ella no hay FEFO ni alerta
  const faltanVencimientos = lineas.filter((l) => l.perecible && !l.vencimiento);
  const puedeConfirmar =
    lineas.length > 0 &&
    lineas.every((l) => l.cantidad > 0 && l.costoUnitario >= 0) &&
    faltanVencimientos.length === 0;

  async function confirmar() {
    setError(null);
    setGuardando(true);
    try {
      const r = await repoProveedores().confirmarRecepcion({
        proveedorId: proveedorId || null,
        tipoDocumento: tipoDoc,
        documento: documento.trim() || null,
        lineas,
      });
      router.push(`/proveedores?recibido=${r.id}`);
      router.refresh();
    } catch (e) {
      setError(toUserMessage(e));
      setGuardando(false);
    }
  }

  return (
    <div className="px-4 py-5 pb-40">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/proveedores" className="tap text-sm text-[var(--texto-suave)]">← Compras</Link>
        <h1 className="text-lg font-semibold">Recibir mercadería</h1>
      </div>

      {/* Documento */}
      <section className="tarjeta p-4 mb-3 space-y-3">
        <div>
          <label htmlFor="prov" className="block text-sm font-medium mb-1.5">Proveedor</label>
          <select
            id="prov" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
            className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white"
          >
            <option value="">Sin especificar</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tipo" className="block text-sm font-medium mb-1.5">Documento</label>
            <select
              id="tipo" value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)}
              className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white"
            >
              {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="num" className="block text-sm font-medium mb-1.5">N°</label>
            <input
              id="num" value={documento} onChange={(e) => setDocumento(e.target.value)}
              inputMode="numeric" placeholder="12345"
              className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
            />
          </div>
        </div>
      </section>

      {/* Agregar productos */}
      <section className="tarjeta p-4 mb-3">
        <h2 className="font-semibold text-sm mb-2">Agregar productos</h2>

        <div className="flex gap-2">
          <input
            type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o SKU…"
            className="tap flex-1 px-3 py-2.5 rounded-xl border border-[var(--borde)]"
          />
          <button
            onClick={() => setEscaneando((v) => !v)}
            aria-label="Escanear producto"
            className={`tap px-4 rounded-xl font-medium ${
              escaneando ? 'border border-[var(--borde)]' : 'bg-marca-500 text-white'
            }`}
          >
            📷
          </button>
        </div>

        {escaneando && (
          <div className="relative mt-2 h-40 rounded-xl overflow-hidden bg-black">
            <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover" />
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="w-4/5 h-16 border-2 border-white/80 rounded-lg" />
            </div>
          </div>
        )}
        {errorCamara && <p className="text-xs text-[var(--color-alerta)] mt-1">{errorCamara}</p>}

        {resultados.length > 0 && (
          <ul className="mt-2 divide-y divide-[var(--borde)] border border-[var(--borde)] rounded-xl overflow-hidden">
            {resultados.map((r) => (
              <li key={r.productId}>
                <button
                  onClick={() => agregar(r)}
                  className="tap w-full px-3 py-2.5 flex justify-between gap-2 text-left active:bg-marca-50"
                >
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{r.nombre}</span>
                    <span className="block text-xs text-[var(--texto-suave)] num">
                      stock {r.stock}{r.perecible && ' · perecible'}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--texto-suave)] num whitespace-nowrap">
                    costo {formatCLP(r.costoAnterior)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {aviso && (
          <p role="status" className="text-xs text-[var(--color-aviso)] bg-amber-50 px-3 py-2 rounded-lg mt-2">
            {aviso}
          </p>
        )}
      </section>

      {/* Líneas */}
      {lineas.length === 0 ? (
        <p className="text-center text-sm text-[var(--texto-suave)] py-8">
          Busca o escanea los productos que llegaron
        </p>
      ) : (
        <ul className="space-y-2">
          {lineas.map((l) => {
            const nuevoPromedio = weightedAverageCost({
              currentStock: l.stock, currentAvgCost: l.costoAnterior,
              incomingQty: l.cantidad, incomingUnitCost: l.costoUnitario,
            });
            const variacion = costVariationPct(l.costoAnterior, l.costoUnitario);
            const alerta = shouldWarnCostVariation(l.costoAnterior, l.costoUnitario);

            return (
              <li key={l.productId} className="tarjeta p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-medium min-w-0 truncate">{l.nombre}</p>
                  <button
                    onClick={() => setLineas((p) => p.filter((x) => x.productId !== l.productId))}
                    className="tap px-2 text-sm text-[var(--color-alerta)] shrink-0"
                    aria-label={`Quitar ${l.nombre}`}
                  >
                    Quitar
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    {/* La etiqueta se repite en cada línea, así que el nombre
                        accesible lleva el producto: tabulando por veinte filas,
                        "Cantidad" veinte veces no dice dónde está uno parado. */}
                    <span className="block text-[11px] text-[var(--texto-suave)] mb-1" aria-hidden>Cantidad</span>
                    <input
                      inputMode="decimal"
                      aria-label={`Cantidad recibida de ${l.nombre}`}
                      value={cantidadTexto[l.productId] ?? String(l.cantidad)}
                      onChange={(e) => {
                        const texto = e.target.value;
                        setCantidadTexto((p) => ({ ...p, [l.productId]: texto }));
                        actualizar(l.productId, {
                          cantidad: validarCantidad(texto, { permiteVacio: true, maximo: 1_000_000 }).valor,
                        });
                      }}
                      className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] num text-right"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] text-[var(--texto-suave)] mb-1" aria-hidden>Costo unitario</span>
                    <input
                      inputMode="numeric"
                      aria-label={`Costo unitario de ${l.nombre}`}
                      value={l.costoUnitario}
                      onChange={(e) => actualizar(l.productId, { costoUnitario: parseCLP(e.target.value) ?? 0 })}
                      className={`tap w-full px-3 py-2 rounded-lg border num text-right ${
                        l.costoUnitario === 0 ? 'border-[var(--color-aviso)]' : 'border-[var(--borde)]'
                      }`}
                    />
                  </div>
                </div>

                {/* M-6: confirmar con costo 0 deja el costo promedio, el margen
                    y el inventario valorizado en cero sin que nadie lo note. */}
                {l.costoUnitario === 0 && (
                  <p className="text-xs text-[var(--color-aviso)] bg-amber-50 px-2.5 py-1.5 rounded-lg mt-2">
                    ⚠ Costo en cero. Si confirmas así, este producto queda sin costo
                    y su margen y su valorización dejan de servir.
                  </p>
                )}

                {/* RF-M3-08: advertir variación de costo antes de confirmar */}
                {alerta && l.costoAnterior > 0 && (
                  <p className="text-xs text-[var(--color-aviso)] bg-amber-50 px-2.5 py-1.5 rounded-lg mt-2">
                    ⚠ El costo cambió {variacion > 0 ? '+' : ''}{variacion}% respecto de{' '}
                    {formatCLP(l.costoAnterior)}. Verifica que esté bien.
                  </p>
                )}

                {l.perecible && (
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-[var(--borde)]">
                    <div>
                      <span className="block text-[11px] text-[var(--texto-suave)] mb-1" aria-hidden>Lote</span>
                      <input
                        value={l.lote ?? ''}
                        aria-label={`Número de lote de ${l.nombre}`}
                        onChange={(e) => actualizar(l.productId, { lote: e.target.value })}
                        placeholder="Opcional"
                        className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] text-sm"
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] text-[var(--texto-suave)] mb-1" aria-hidden>
                        Vencimiento <span className="text-[var(--color-alerta)]">*</span>
                      </span>
                      <input
                        type="date" min={hoy()} value={l.vencimiento ?? ''}
                        aria-label={`Fecha de vencimiento de ${l.nombre} (obligatoria)`}
                        aria-invalid={l.vencimiento ? undefined : true}
                        onChange={(e) => actualizar(l.productId, { vencimiento: e.target.value })}
                        className={`tap w-full px-2 py-2 rounded-lg border text-sm ${
                          l.vencimiento ? 'border-[var(--borde)]' : 'border-[var(--color-alerta)]'
                        }`}
                      />
                    </div>
                  </div>
                )}

                <p className="text-xs text-[var(--texto-suave)] num mt-2 text-right">
                  Subtotal {formatCLP(Math.round(l.cantidad * l.costoUnitario))}
                  {l.costoAnterior > 0 && nuevoPromedio !== l.costoAnterior && (
                    <span> · nuevo costo prom. {formatCLP(nuevoPromedio)}</span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mt-3">
          {error}
        </p>
      )}

      {/* Confirmar */}
      {lineas.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 lg:left-60 bg-white border-t border-[var(--borde)] px-4 py-3 z-30"
             style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <div className="max-w-5xl mx-auto">
            {faltanVencimientos.length > 0 && (
              <p className="text-xs text-[var(--color-alerta)] mb-2">
                Falta la fecha de vencimiento en {faltanVencimientos.length}{' '}
                {faltanVencimientos.length === 1 ? 'producto perecible' : 'productos perecibles'}
              </p>
            )}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[var(--texto-suave)]">
                {lineas.length} {lineas.length === 1 ? 'producto' : 'productos'}
              </span>
              <span className="num text-xl font-bold">{formatCLP(total)}</span>
            </div>
            <button
              onClick={() => void confirmar()}
              disabled={!puedeConfirmar || guardando}
              className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-40"
            >
              {guardando ? 'Registrando…' : `Confirmar recepción · ${formatCLP(total)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
