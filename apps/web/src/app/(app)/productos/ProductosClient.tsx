'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCLP, formatCantidad, marginPct, toUserMessage, cantidadConUnidad } from '@rutaahorro/core';
import { repoProductos, type Categoria, type Producto } from '@/lib/productos';
import { Modal } from '@/components/Modal';
import { FormularioProducto } from './FormularioProducto';
import { Encabezado, EstadoVacio } from '@/components/Encabezado';
import { Icono } from '@/components/Icono';

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
  puedeVerCostos, puedeEditar, puedeEliminar, puedeEditarPrecios = false, esAdmin = false, codigoNuevo = null,
}: {
  /** Vino desde Vender o Consultar precio con un código que no existe: abrir el alta con él. */
  codigoNuevo?: string | null;
  puedeVerCostos: boolean;
  puedeEditar: boolean;
  puedeEliminar: boolean;
  puedeEditarPrecios?: boolean;
  esAdmin?: boolean;
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
  const [plantilla, setPlantilla] = useState<Producto | null>(null);
  const [codigoInicial, setCodigoInicial] = useState<string | null>(puedeEditar ? codigoNuevo : null);
  const [confirmando, setConfirmando] = useState<Producto | null>(null);
  const [puedeBorrarDef, setPuedeBorrarDef] = useState(false);
  const [consultandoHistorial, setConsultandoHistorial] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);
  // Lo que se acaba de guardar. Antes el formulario se cerraba sin decir nada
  // y el producto nuevo quedaba perdido en la lista.
  const [aviso, setAviso] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  // El código vino en la dirección: se abre el alta una vez y se limpia, para
  // que recargar la página no vuelva a abrirla.
  // Se abre en un efecto y no de entrada: un diálogo no se dibuja en el
  // servidor (va en un portal a <body>).
  useEffect(() => {
    if (!codigoNuevo) return;
    window.history.replaceState(null, '', '/productos');
    if (puedeEditar) setCreando(true);
  }, [codigoNuevo, puedeEditar]);

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
      <Encabezado
        titulo="Productos"
        icono="productos"
        descripcion={puedeEditar
          ? 'El catálogo: precios, códigos de barra y stock. Toca Editar para cambiar un producto.'
          : 'El catálogo con sus precios y cuánto queda.'}
        detalle={cargando ? 'Cargando…' : `${productos.length} ${productos.length === 1 ? 'producto' : 'productos'}`}
        acciones={puedeEditar && (
          <>
            <Link href="/productos/etiquetas" prefetch={false} className="btn btn-secundario btn-chico" title="Imprimir etiquetas con código de barra">
              <Icono nombre="precio" tamano={16} /> Etiquetas
            </Link>
            {puedeEditarPrecios && (
              <Link href="/productos/ofertas" prefetch={false} className="btn btn-secundario btn-chico" title="Una oferta a varios productos a la vez">
                <span aria-hidden className="font-bold">%</span> Ofertas
              </Link>
            )}
            <Link href="/productos/importar" prefetch={false} className="btn btn-secundario btn-chico" title="Cargar productos desde Excel">
              <Icono nombre="subir" tamano={16} /> Importar
            </Link>
            <button onClick={() => setCreando(true)} className="btn btn-primario btn-chico">
              <Icono nombre="agregar" tamano={16} /> Nuevo producto
            </button>
          </>
        )}
      />

      {aviso && (
        <p role="status" className="mb-3 text-sm px-3 py-2 rounded-lg bg-marca-100 text-marca-900 flex items-center justify-between gap-2">
          <span>✓ {aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="tap -my-2 -mr-2 font-bold">×</button>
        </p>
      )}

      {/* Filtros */}
      <div className="space-y-2 mb-4">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, SKU o código…"
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
        <EstadoVacio
          icono="productos"
          titulo={busqueda || categoriaId || estado !== 'todos' ? 'Ningún producto coincide con el filtro' : 'Aún no hay productos cargados'}
          texto={busqueda || categoriaId || estado !== 'todos'
            ? 'Prueba con otra palabra o quita los filtros.'
            : puedeEditar ? 'Crea uno por uno, o sube tu planilla de Excel con todos de una vez.' : 'Pídele al administrador que cargue el catálogo.'}
        >
          {puedeEditar && !busqueda && (
            <>
              <Link href="/productos/importar" className="btn btn-secundario">Importar desde Excel</Link>
              <button onClick={() => setCreando(true)} className="btn btn-primario">Crear el primero</button>
            </>
          )}
        </EstadoVacio>
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
                    {est.icono} {est.texto} · {cantidadConUnidad(p.stock, p.unidad)}
                    {p.stockMinimo > 0 && ` (mín. ${p.stockMinimo})`}
                    {` · a la vista ${formatCantidad(p.stockSala)} · en bodega ${formatCantidad(p.stockBodega)}`}
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
                          alerta, que queda reservado para quitar (docs/21 B-1).
                          Desactivar es solo del administrador (matriz del doc
                          02); antes lo veían también supervisor y bodega. */}
                      {puedeEliminar && (
                      <button
                        onClick={() => void abrirConfirmacion(p)}
                        className={`tap px-3 py-1.5 text-xs rounded-lg border border-[var(--borde)] ${
                          p.activo ? 'text-[var(--color-alerta)]' : 'text-marca-700'
                        }`}
                      >
                        {p.activo ? 'Quitar' : 'Reactivar'}
                      </button>
                      )}
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
          puedeEditarPrecios={puedeEditarPrecios}
          esAdmin={esAdmin}
          key={formKey}
          plantilla={creando ? plantilla : null}
          codigoInicial={creando ? codigoInicial : null}
          onDuplicar={(p) => { setEditando(null); setPlantilla(p); setCodigoInicial(null); setCreando(true); setFormKey((k) => k + 1); }}
          onGuardado={(r) => {
            setCreando(false);
            setEditando(null);
            setPlantilla(null);
            setCodigoInicial(null);
            if (r.nuevo) {
              const total = r.sala + r.bodega;
              setAviso(total > 0
                ? `${r.nombre} creado: ${formatCantidad(r.sala)} a la vista (listo para vender)${r.bodega ? ` y ${formatCantidad(r.bodega)} en bodega` : ''}`
                : `${r.nombre} creado, sin stock. Para cargarle unidades: Inventario → Ajustar, o Proveedores → Recepción`);
              // Se muestra el recién creado: sin esto quedaba perdido en la lista.
              // Los demás filtros se sueltan: con "🟠 Bajo" o una categoría
              // elegidos, el producto nuevo no aparecía aunque se buscara.
              setBusqueda(r.nombre);
              setCategoriaId('');
              setEstado('todos');
              setVerInactivos(false);
            } else {
              setAviso(`${r.nombre} guardado`);
              void cargar();
            }
          }}
          onCancelar={() => { setCreando(false); setEditando(null); setPlantilla(null); setCodigoInicial(null); }}
          onRecargar={editando ? async () => {
            const fresco = await repoProductos().obtener(editando.id, puedeVerCostos);
            if (fresco) { setEditando(fresco); setFormKey((k) => k + 1); }
          } : undefined}
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
