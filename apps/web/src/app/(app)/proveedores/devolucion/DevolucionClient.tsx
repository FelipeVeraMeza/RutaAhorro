'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCLP, formatCantidad, toUserMessage, validarCantidadStock, textoVencimiento } from '@rutaahorro/core';
import { Encabezado, EstadoVacio } from '@/components/Encabezado';
import { Icono } from '@/components/Icono';
import { repoProveedores, buscarParaRecepcion, productoParaRecepcion, type Proveedor } from '@/lib/datos/proveedores';
import { repoInventario, type Lote } from '@/lib/datos/inventario';
import { repoDevoluciones, type DevolucionProveedor } from '@/lib/datos/devoluciones';
import { findByBarcode } from '@/lib/offline/catalog';
import { useScanner } from '@/lib/scanner/useScanner';
import { useFormatoFecha } from '@/lib/formatoFecha';

/**
 * Devolver mercadería al proveedor (RQ-35, 0035): vencida, dañada o mal
 * despachada. Antes había que hacerlo como un ajuste con motivo, que no decía
 * a quién se devolvió ni con qué documento.
 */
const MOTIVOS = ['Vencido o por vencer', 'Dañado', 'Mal despachado', 'Cambio acordado con el proveedor'];

interface Linea {
  productId: string;
  nombre: string;
  stock: number;
  perecible: boolean;
  costo: number;
  cantidad: string;
  /** '' = el que vence primero. */
  loteId: string;
}

export function DevolucionClient({ verCostos = false }: { verCostos?: boolean }) {
  const { fechaHora } = useFormatoFecha();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState('');
  const [documento, setDocumento] = useState('');
  const [motivo, setMotivo] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Awaited<ReturnType<typeof buscarParaRecepcion>>>([]);
  const [escaneando, setEscaneando] = useState(false);
  const [historial, setHistorial] = useState<DevolucionProveedor[]>([]);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    // Antes cada lectura caía en silencio a una lista vacía: sin red, la
    // pantalla decía "Elige a quién se devuelve" con ningún proveedor y nada
    // explicaba por qué.
    let fallo: unknown = null;
    const nada = <T,>(e: unknown): T[] => { fallo ??= e; return []; };
    const [ps, ls, hs] = await Promise.all([
      repoProveedores().listar().catch((e) => nada<Proveedor>(e)),
      repoInventario().lotes().catch((e) => nada<Lote>(e)),
      repoDevoluciones().listar().catch((e) => nada<DevolucionProveedor>(e)),
    ]);
    setProveedores(ps); setLotes(ls); setHistorial(hs);
    if (fallo) setAviso({ tipo: 'error', texto: toUserMessage(fallo) });
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    if (busqueda.trim().length < 2) { setResultados([]); return; }
    let vivo = true;
    void buscarParaRecepcion(busqueda).then((r) => { if (vivo) setResultados(r); });
    return () => { vivo = false; };
  }, [busqueda]);

  const agregar = useCallback((p: { productId: string; nombre: string; stock: number; perecible: boolean; costoAnterior: number }) => {
    setLineas((prev) => (prev.some((l) => l.productId === p.productId) ? prev : [...prev, {
      productId: p.productId, nombre: p.nombre, stock: p.stock, perecible: p.perecible,
      costo: p.costoAnterior, cantidad: '1', loteId: '',
    }]));
    setBusqueda(''); setResultados([]);
  }, []);

  const { videoRef, start, stop, error: errorCamara } = useScanner({
    enabled: escaneando,
    onScan: async (code) => {
      const prod = await findByBarcode(code);
      if (!prod) { setAviso({ tipo: 'error', texto: `El código ${code} no está en el catálogo` }); return; }
      // Antes se buscaba por nombre entre los 12 primeros: un "Pan" escaneado
      // podía no estar entre ellos y la cámara se cerraba sin agregar nada.
      const r = await productoParaRecepcion(prod.id, prod.name);
      if (r) agregar(r);
      else setAviso({ tipo: 'error', texto: `${prod.name} no está activo en el catálogo` });
      setEscaneando(false);
    },
  });
  useEffect(() => { if (escaneando) void start(); else stop(); }, [escaneando, start, stop]);

  const validadas = lineas.map((l) => ({ l, v: validarCantidadStock(l.cantidad, 'unidad', { maximo: Math.max(l.stock, 0) }) }));
  const malas = validadas.filter(({ v }) => !v.valido || v.valor <= 0);
  const totalCosto = validadas.reduce((s, { l, v }) => s + (v.valido ? Math.round(v.valor * l.costo) : 0), 0);
  const puede = proveedorId && motivo.trim() && lineas.length > 0 && malas.length === 0 && !guardando;

  async function confirmar() {
    if (!puede) return;
    setGuardando(true); setAviso(null);
    try {
      const r = await repoDevoluciones().devolver({
        proveedorId, documento: documento.trim() || null, motivo: motivo.trim(),
        items: validadas.map(({ l, v }) => ({ productId: l.productId, nombre: l.nombre, cantidad: v.valor, loteId: l.loteId || null })),
      });
      const prov = proveedores.find((p) => p.id === proveedorId)?.nombre ?? 'el proveedor';
      setAviso({ tipo: 'ok', texto: `Devolución a ${prov} registrada: ${lineas.length} ${lineas.length === 1 ? 'producto salió' : 'productos salieron'} de la bodega`
        + `${verCostos ? ` (${formatCLP(r.totalCosto)} al costo)` : ''}. Pide la nota de crédito y regístrala en Facturación → Recibidas.` });
      setLineas([]); setDocumento(''); setMotivo('');
      await cargar();
    } catch (e) {
      setAviso({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="px-4 py-5 pb-48 lg:pb-32">
      <Encabezado
        titulo="Devolver a proveedor"
        volver={{ href: '/proveedores', texto: 'Compras' }}
        descripcion="Lo vencido, dañado o mal despachado que vuelve al proveedor: sale de la bodega con su motivo y documento."
      />

      {aviso && (
        <p role={aviso.tipo === 'error' ? 'alert' : 'status'}
           className={`text-sm px-3 py-2 rounded-lg mb-3 ${aviso.tipo === 'error' ? 'bg-red-50 text-red-900' : 'bg-marca-50 text-marca-900'}`}>
          {aviso.texto}
        </p>
      )}

      <section className="tarjeta p-4 mb-3 space-y-3">
        <div>
          <label htmlFor="prov" className="block text-sm font-medium mb-1.5">Proveedor <span className="text-[var(--color-alerta)]">*</span></label>
          <select id="prov" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
                  className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white">
            <option value="">Elige a quién se devuelve</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="motivo" className="block text-sm font-medium mb-1.5">Motivo <span className="text-[var(--color-alerta)]">*</span></label>
          <div className="flex flex-wrap gap-2 mb-2">
            {MOTIVOS.map((m) => (
              <button key={m} type="button" onClick={() => setMotivo(m)} aria-pressed={motivo === m}
                      className={`btn btn-chico ${motivo === m ? 'btn-primario' : 'btn-secundario'}`}>{m}</button>
            ))}
          </div>
          <input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="O escríbelo"
                 className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />
        </div>
        <div>
          <label htmlFor="doc" className="block text-sm font-medium mb-1.5">Guía de devolución o nota de crédito (opcional)</label>
          <input id="doc" value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="N°"
                 className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />
        </div>
      </section>

      <section className="tarjeta p-4 mb-3">
        <h2 className="font-semibold text-sm mb-2">Qué se devuelve</h2>
        <div className="flex gap-2">
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                 placeholder="Buscar por nombre o SKU…" aria-label="Buscar producto para devolver"
                 className="tap flex-1 px-3 py-2.5 rounded-xl border border-[var(--borde)]" />
          <button onClick={() => setEscaneando((x) => !x)} aria-label="Escanear producto"
                  className={`tap px-4 rounded-xl font-medium ${escaneando ? 'border border-[var(--borde)]' : 'bg-marca-500 text-white'}`}>
            <Icono nombre="escanear" tamano={20} />
          </button>
        </div>
        {escaneando && (
          <div className="relative mt-2 h-40 rounded-xl overflow-hidden bg-black">
            <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover" />
          </div>
        )}
        {errorCamara && <p className="text-xs text-[var(--color-alerta)] mt-1">{errorCamara}</p>}
        {resultados.length > 0 && (
          <ul className="mt-2 divide-y divide-[var(--borde)] border border-[var(--borde)] rounded-xl overflow-hidden">
            {resultados.map((r) => (
              <li key={r.productId}>
                <button onClick={() => agregar(r)} className="tap w-full px-3 py-2.5 flex justify-between gap-2 text-left active:bg-marca-50">
                  <span className="text-sm truncate">{r.nombre}</span>
                  <span className="text-xs text-[var(--texto-suave)] num whitespace-nowrap">en bodega {formatCantidad(r.stock)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {lineas.length === 0 ? (
        <p className="text-center text-sm text-[var(--texto-suave)] py-6">Busca o escanea lo que vuelve al proveedor</p>
      ) : (
        <ul className="space-y-2">
          {validadas.map(({ l, v }) => {
            const suyos = lotes.filter((x) => x.productoId === l.productId && x.cantidad > 0);
            return (
              <li key={l.productId} className="tarjeta p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-medium min-w-0">{l.nombre}
                    <span className="block text-xs text-[var(--texto-suave)] num">en bodega {formatCantidad(l.stock)}</span>
                  </p>
                  <button onClick={() => setLineas((p) => p.filter((x) => x.productId !== l.productId))}
                          className="tap px-2 text-sm text-[var(--color-alerta)] shrink-0" aria-label={`Quitar ${l.nombre}`}>Quitar</button>
                </div>
                <label className="block">
                  <span className="block text-[11px] text-[var(--texto-suave)] mb-1">Cantidad</span>
                  <input inputMode="numeric" value={l.cantidad} aria-label={`Cantidad a devolver de ${l.nombre}`}
                         onChange={(e) => setLineas((p) => p.map((x) => (x.productId === l.productId ? { ...x, cantidad: e.target.value } : x)))}
                         className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] num text-right" />
                </label>
                {!v.valido && <p role="alert" className="text-xs text-[var(--color-alerta)] mt-1">{v.error}</p>}
                {l.perecible && suyos.length > 0 && (
                  <label className="block mt-2">
                    <span className="block text-[11px] text-[var(--texto-suave)] mb-1">De qué lote</span>
                    <select value={l.loteId} aria-label={`Lote de ${l.nombre}`}
                            onChange={(e) => setLineas((p) => p.map((x) => (x.productId === l.productId ? { ...x, loteId: e.target.value } : x)))}
                            className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] bg-white text-sm">
                      <option value="">El que vence primero</option>
                      {suyos.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.codigo ? `${x.codigo} · ` : ''}{textoVencimiento(x.diasParaVencer)} · quedan {formatCantidad(x.cantidad)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-6">
        <h2 className="font-semibold text-sm mb-2">Últimas devoluciones</h2>
        {historial.length === 0 ? (
          <EstadoVacio icono="proveedores" titulo="Sin devoluciones" texto="Lo que devuelvas a un proveedor aparece acá." />
        ) : (
          <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
            {historial.map((h) => (
              <li key={h.id} className="px-3 py-2.5 text-sm">
                <p className="font-medium">{h.proveedor}{h.documento ? ` · N° ${h.documento}` : ''}</p>
                <p className="text-xs text-[var(--texto-suave)]">
                  {fechaHora(h.fecha)} · {h.productos} {h.productos === 1 ? 'producto' : 'productos'} · {h.motivo}
                  {verCostos && <span className="num"> · {formatCLP(h.totalCosto)} al costo</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {lineas.length > 0 && (
        <div className="fixed inset-x-0 lg:left-60 bottom-[calc(60px+env(safe-area-inset-bottom))] lg:bottom-0 bg-white border-t border-[var(--borde)] px-4 py-3 z-30">
          <div className="max-w-5xl mx-auto">
            {!proveedorId && <p className="text-xs text-[var(--color-alerta)] mb-1">Falta elegir el proveedor</p>}
            {proveedorId && !motivo.trim() && <p className="text-xs text-[var(--color-alerta)] mb-1">Falta el motivo</p>}
            {verCostos && <p className="text-xs text-[var(--texto-suave)] num mb-1">Valor al costo: {formatCLP(totalCosto)}</p>}
            <button onClick={() => void confirmar()} disabled={!puede}
                    className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-40">
              {guardando ? 'Registrando…' : `Devolver ${lineas.length} ${lineas.length === 1 ? 'producto' : 'productos'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
