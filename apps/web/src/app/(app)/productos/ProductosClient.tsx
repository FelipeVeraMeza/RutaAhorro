'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCLP, marginPct, toUserMessage } from '@rutaahorro/core';
import { repoProductos, type Categoria, type Producto } from '@/lib/productos';
import { Modal } from '@/components/Modal';
import { FormularioProducto } from './FormularioProducto';

type Estado = 'todos' | 'normal' | 'bajo' | 'agotado';

const ESTADOS: Array<{ id: Estado; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'normal', label: '🟢 Normal' },
  { id: 'bajo', label: '🟠 Bajo' },
  { id: 'agotado', label: '🔴 Agotado' },
];

/** Estado del stock: color + texto, nunca solo color (RNF-46). */
function estadoStock(p: Producto): { icono: string; texto: string; clase: string } {
  if (p.stock <= 0) return { icono: '🔴', texto: 'Agotado', clase: 'text-[var(--color-alerta)]' };
  if (p.stockMinimo > 0 && p.stock <= p.stockMinimo) {
    return { icono: '🟠', texto: 'Bajo', clase: 'text-[var(--color-aviso)]' };
  }
  return { icono: '🟢', texto: 'Normal', clase: 'text-[var(--texto-suave)]' };
}

export function ProductosClient({
  puedeVerCostos, puedeEditar, puedeEliminar,
}: {
  puedeVerCostos: boolean;
  puedeEditar: boolean;
  puedeEliminar: boolean;
}) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [estado, setEstado] = useState<Estado>('todos');
  const [verInactivos, setVerInactivos] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editando, setEditando] = useState<Producto | null>(null);
  const [creando, setCreando] = useState(false);
  const [confirmando, setConfirmando] = useState<Producto | null>(null);
  const [puedeBorrarDef, setPuedeBorrarDef] = useState(false);
  const [consultandoHistorial, setConsultandoHistorial] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const repo = repoProductos();
      const [items, cats] = await Promise.all([
        repo.listar(
          { busqueda, categoriaId: categoriaId || undefined, estado, soloActivos: !verInactivos },
          puedeVerCostos,
        ),
        repo.categorias(),
      ]);
      setProductos(items);
      setCategorias(cats);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setCargando(false);
    }
  }, [busqueda, categoriaId, estado, verInactivos, puedeVerCostos]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 200);   // antirrebote al escribir
    return () => clearTimeout(t);
  }, [cargar]);

  async function abrirConfirmacion(p: Producto) {
    // `puedeBorrarDef` se baja antes de consultar. Si se conserva el valor del
    // producto anterior, el diálogo ofrece "Eliminar definitivamente" para un
    // producto que sí tiene ventas: la base lo rechaza, pero la pantalla ya
    // mintió. Ver docs/21, hallazgo B-4.
    setPuedeBorrarDef(false);
    setConsultandoHistorial(true);
    setConfirmando(p);
    try {
      setPuedeBorrarDef(!(await repoProductos().tieneMovimientos(p.id)));
    } catch {
      setPuedeBorrarDef(false);
    } finally {
      setConsultandoHistorial(false);
    }
  }

  async function ejecutar(accion: 'desactivar' | 'reactivar' | 'eliminar', p: Producto) {
    if (ejecutando) return;
    setEjecutando(true);
    try {
      const repo = repoProductos();
      if (accion === 'desactivar') await repo.desactivar(p.id);
      if (accion === 'reactivar') await repo.reactivar(p.id);
      if (accion === 'eliminar') await repo.eliminar(p.id);
      setConfirmando(null);
      await cargar();
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'TIENE_MOVIMIENTOS'
          ? 'Ese producto tiene ventas o movimientos: solo se puede desactivar, no eliminar.'
          : toUserMessage(e),
      );
      setConfirmando(null);
    } finally {
      setEjecutando(false);
    }
  }

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-semibold">Productos</h1>
          <p className="text-sm text-[var(--texto-suave)]">
            {cargando ? 'Cargando…' : `${productos.length} ${productos.length === 1 ? 'producto' : 'productos'}`}
          </p>
        </div>
        {puedeEditar && (
          <div className="flex gap-2">
            <Link
              href="/productos/etiquetas"
              title="Imprimir etiquetas con código de barra"
              className="tap inline-flex items-center px-3 py-2.5 rounded-xl border border-[var(--borde)] text-sm font-medium"
            >
              🏷️ <span className="hidden sm:inline ml-1.5">Etiquetas</span>
            </Link>
            <Link
              href="/productos/importar"
              className="tap inline-flex items-center px-3 py-2.5 rounded-xl border border-[var(--borde)] text-sm font-medium"
            >
              📥 <span className="hidden sm:inline ml-1.5">Importar</span>
            </Link>
            <button
              onClick={() => setCreando(true)}
              className="tap px-4 py-2.5 rounded-xl bg-marca-500 text-white text-sm font-semibold"
            >
              + Producto
            </button>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="space-y-2 mb-4">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o SKU…"
          className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white"
        />
        <div className="flex gap-2 overflow-x-auto sin-scrollbar pb-1">
          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="tap px-3 py-2 rounded-lg border border-[var(--borde)] bg-white text-sm shrink-0"
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>

          {ESTADOS.map((e) => (
            <button
              key={e.id}
              onClick={() => setEstado(e.id)}
              aria-pressed={estado === e.id}
              className={`tap px-3 py-2 rounded-lg text-sm shrink-0 border ${
                estado === e.id
                  ? 'border-marca-500 bg-marca-50 text-marca-900 font-medium'
                  : 'border-[var(--borde)] bg-white'
              }`}
            >
              {e.label}
            </button>
          ))}

          {puedeEditar && (
            <button
              onClick={() => setVerInactivos((v) => !v)}
              aria-pressed={verInactivos}
              className={`tap px-3 py-2 rounded-lg text-sm shrink-0 border ${
                verInactivos
                  ? 'border-marca-500 bg-marca-50 text-marca-900 font-medium'
                  : 'border-[var(--borde)] bg-white'
              }`}
            >
              Incluir desactivados
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3">
          {error}
        </p>
      )}

      {/* Lista */}
      {!cargando && productos.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-4xl mb-3" aria-hidden>📦</p>
          <p className="text-sm text-[var(--texto-suave)] mb-4">
            {busqueda || categoriaId || estado !== 'todos'
              ? 'Ningún producto coincide con el filtro'
              : 'Aún no hay productos cargados'}
          </p>
          {puedeEditar && !busqueda && (
            <div className="flex gap-2 justify-center">
              <Link href="/productos/importar" className="tap px-4 py-2.5 rounded-xl border border-[var(--borde)] text-sm font-medium">
                Importar desde Excel
              </Link>
              <button onClick={() => setCreando(true)} className="tap px-4 py-2.5 rounded-xl bg-marca-500 text-white text-sm font-semibold">
                Crear el primero
              </button>
            </div>
          )}
        </div>
      ) : (
        <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
          {productos.map((p) => {
            const est = estadoStock(p);
            return (
              <li key={p.id} className={`px-4 py-3 ${!p.activo ? 'opacity-55' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {p.nombre}
                      {!p.activo && <span className="ml-2 text-xs font-normal">· desactivado</span>}
                    </p>
                    <p className="text-xs text-[var(--texto-suave)] truncate">
                      {p.sku ?? 'sin SKU'}
                      {p.categoriaNombre && ` · ${p.categoriaNombre}`}
                      {p.perecible && ' · 🕒 perecible'}
                    </p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <p className="num font-semibold">{formatCLP(p.precioVenta)}</p>
                    {puedeVerCostos && typeof p.costoPromedio === 'number' && p.costoPromedio > 0 && (
                      <p className="text-xs text-[var(--texto-suave)] num">
                        costo {formatCLP(p.costoPromedio)} · {marginPct(p.precioVenta, p.costoPromedio)}%
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <p className={`text-xs num ${est.clase}`}>
                    {est.icono} {est.texto} · {p.stock} {p.unidad}
                    {p.stockMinimo > 0 && ` (mín. ${p.stockMinimo})`}
                  </p>

                  {puedeEditar && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => setEditando(p)}
                        className="tap px-3 py-1.5 text-xs rounded-lg border border-[var(--borde)]"
                      >
                        Editar
                      </button>
                      {/* Reactivar no es destructivo: no lleva el color de
                          alerta, que queda reservado para quitar (docs/21 B-1). */}
                      <button
                        onClick={() => void abrirConfirmacion(p)}
                        className={`tap px-3 py-1.5 text-xs rounded-lg border border-[var(--borde)] ${
                          p.activo ? 'text-[var(--color-alerta)]' : 'text-marca-700'
                        }`}
                      >
                        {p.activo ? 'Quitar' : 'Reactivar'}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!puedeVerCostos && productos.length > 0 && (
        <p className="text-[11px] text-[var(--texto-suave)] text-center mt-4">
          Tu rol no tiene acceso a costos ni márgenes.
        </p>
      )}

      {/* Alta / edición */}
      {(creando || editando) && (
        <FormularioProducto
          producto={editando}
          categorias={categorias}
          puedeVerCostos={puedeVerCostos}
          onGuardado={() => { setCreando(false); setEditando(null); void cargar(); }}
          onCancelar={() => { setCreando(false); setEditando(null); }}
        />
      )}

      {/* Confirmación de baja */}
      {confirmando && (
        <Modal
          titulo={confirmando.activo
            ? `Quitar ${confirmando.nombre}`
            : `Reactivar ${confirmando.nombre}`}
          onCerrar={() => setConfirmando(null)}
          bloqueado={ejecutando}
        >
          <div className="p-5">
            {confirmando.activo ? (
              <>
                <h2 className="font-semibold mb-2">Quitar &ldquo;{confirmando.nombre}&rdquo;</h2>
                <p className="text-sm text-[var(--texto-suave)] mb-4" aria-live="polite">
                  {consultandoHistorial
                    ? 'Revisando si este producto tiene ventas o movimientos…'
                    : puedeBorrarDef
                      ? 'Este producto no tiene ventas ni movimientos, así que puedes eliminarlo definitivamente o solo desactivarlo.'
                      : 'Este producto ya tiene historial. Se desactivará para que deje de venderse, pero se conserva para no perder la trazabilidad de sus ventas pasadas.'}
                </p>

                <div className="space-y-2">
                  <button
                    onClick={() => void ejecutar('desactivar', confirmando)}
                    disabled={ejecutando}
                    className="tap w-full py-3 rounded-xl bg-marca-500 text-white font-semibold disabled:opacity-50"
                  >
                    {ejecutando ? 'Guardando…' : 'Desactivar'}
                  </button>

                  {/* Solo aparece cuando la consulta terminó: ofrecerlo antes
                      es ofrecer algo que la base va a rechazar (docs/21 B-4). */}
                  {!consultandoHistorial && puedeBorrarDef && puedeEliminar && (
                    <button
                      onClick={() => void ejecutar('eliminar', confirmando)}
                      disabled={ejecutando}
                      className="tap w-full py-3 rounded-xl border border-[var(--color-alerta)] text-[var(--color-alerta)] font-semibold disabled:opacity-50"
                    >
                      Eliminar definitivamente
                    </button>
                  )}

                  <button
                    onClick={() => setConfirmando(null)}
                    disabled={ejecutando}
                    className="tap w-full py-3 rounded-xl border border-[var(--borde)] disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-semibold mb-2">Reactivar &ldquo;{confirmando.nombre}&rdquo;</h2>
                <p className="text-sm text-[var(--texto-suave)] mb-4">
                  Volverá a estar disponible para la venta.
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => void ejecutar('reactivar', confirmando)}
                    disabled={ejecutando}
                    className="tap w-full py-3 rounded-xl bg-marca-500 text-white font-semibold disabled:opacity-50"
                  >
                    {ejecutando ? 'Guardando…' : 'Reactivar'}
                  </button>
                  <button
                    onClick={() => setConfirmando(null)}
                    disabled={ejecutando}
                    className="tap w-full py-3 rounded-xl border border-[var(--borde)] disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
