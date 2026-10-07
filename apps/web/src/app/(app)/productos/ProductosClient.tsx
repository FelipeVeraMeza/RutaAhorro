'use client';

import { configuracionLocal, useConfiguracion } from '@/lib/datos/configuracion';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  formatCLP, formatCantidad, margenNetoPct, formatPct, toUserMessage, cantidadConUnidad, aCSV,
  calidadCatalogo, TEXTO_PROBLEMA, precioConRedondeo, validarMonto, type ProblemaCatalogo, diaLocal
} from '@rutaahorro/core';
import { repoProductos, type Categoria, type Producto } from '@/lib/productos';
import { Modal } from '@/components/Modal';
import { FormularioProducto } from './FormularioProducto';
import { Encabezado, EstadoVacio } from '@/components/Encabezado';
import { Icono } from '@/components/Icono';

type Estado = 'todos' | 'normal' | 'bajo' | 'agotado';

/** RF-M2-16 · cómo ordenar la lista. */
type Orden = 'nombre' | 'precio_menor' | 'precio_mayor' | 'stock_menor' | 'recientes';
const ORDENES: Array<[Orden, string]> = [
  ['nombre', 'Nombre (A-Z)'],
  ['precio_menor', 'Precio: menor primero'],
  ['precio_mayor', 'Precio: mayor primero'],
  ['stock_menor', 'Stock: menos primero'],
  ['recientes', 'Modificados hace poco'],
];

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
  editarId = null,
}: {
  /** Vino desde Vender o Consultar precio con un código que no existe: abrir el alta con él. */
  codigoNuevo?: string | null;
  /** Viene de otra pantalla (ej. un lote por vencer) a editar este producto. */
  editarId?: string | null;
  puedeVerCostos: boolean;
  puedeEditar: boolean;
  puedeEliminar: boolean;
  puedeEditarPrecios?: boolean;
  esAdmin?: boolean;
}) {
  const { ivaPct } = useConfiguracion();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [estado, setEstado] = useState<Estado>('todos');
  const [verInactivos, setVerInactivos] = useState(false);
  const [orden, setOrden] = useState<Orden>('nombre');
  // RF-M2-18 · ver solo los que tienen datos por completar.
  const [revisando, setRevisando] = useState(false);
  const [cambiandoPrecio, setCambiandoPrecio] = useState<Producto | null>(null);
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

  useEffect(() => {
    if (!editarId || !puedeEditar) return;
    window.history.replaceState(null, '', '/productos');
    void repoProductos().obtener(editarId, puedeVerCostos).then((p) => { if (p) setEditando(p); }).catch(() => {});
  }, [editarId, puedeEditar, puedeVerCostos]);

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

  const calidad = useMemo(() => calidadCatalogo(productos.filter((p) => p.activo).map((p) => ({
    id: p.id, nombre: p.nombre, codigos: p.codigos, costo: p.costoPromedio, stockMinimo: p.stockMinimo,
    categoriaId: p.categoriaId, precio: p.precioVenta, perecible: p.perecible,
  })), puedeVerCostos), [productos, puedeVerCostos]);

  // De a 100 por página (Felipe, 2026-10-07: "poder seguir viendo, como
  // cambiar a la siguiente pestaña de la tabla"): con 700 tarjetas juntas el
  // celular se pone lento. El buscador y los filtros sí miran todo el catálogo.
  const POR_PAGINA = 100;
  const [pagina, setPagina] = useState(0);
  useEffect(() => { setPagina(0); }, [busqueda, categoriaId, estado, verInactivos, orden, revisando]);

  const visibles = useMemo(() => {
    const base = revisando ? productos.filter((p) => calidad.porProducto.has(p.id)) : productos;
    const orden2 = [...base];
    const porNombre = (a: Producto, b: Producto) => a.nombre.localeCompare(b.nombre, 'es');
    if (orden === 'nombre') orden2.sort(porNombre);
    if (orden === 'precio_menor') orden2.sort((a, b) => a.precioVenta - b.precioVenta || porNombre(a, b));
    if (orden === 'precio_mayor') orden2.sort((a, b) => b.precioVenta - a.precioVenta || porNombre(a, b));
    if (orden === 'stock_menor') orden2.sort((a, b) => a.stock - b.stock || porNombre(a, b));
    if (orden === 'recientes') orden2.sort((a, b) => b.actualizadoEn.localeCompare(a.actualizadoEn));
    return orden2;
  }, [productos, orden, revisando, calidad]);

  /** RF-M2-19 · el catálogo en Excel, con lo que la pantalla muestra. */
  async function exportar() {
    const csv = aCSV(visibles, [
      { titulo: 'nombre', valor: (p) => p.nombre },
      { titulo: 'codigo_interno', valor: (p) => p.sku ?? '' },
      { titulo: 'codigos_de_barra', valor: (p) => p.codigos.join(' ') },
      { titulo: 'categoria', valor: (p) => p.categoriaNombre ?? '' },
      { titulo: 'precio_venta', valor: (p) => p.precioVenta },
      ...(puedeVerCostos ? [{ titulo: 'costo_promedio', valor: (p: Producto) => p.costoPromedio ?? 0 }] : []),
      { titulo: 'stock_total', valor: (p) => p.stock },
      { titulo: 'stock_minimo', valor: (p) => p.stockMinimo },
      { titulo: 'perecible', valor: (p) => (p.perecible ? 'si' : 'no') },
      { titulo: 'activo', valor: (p) => (p.activo ? 'si' : 'no') },
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    // El día del local (regla 17): desde las 21:00 el archivo salía con la fecha de mañana.
    a.href = url; a.download = `catalogo-${diaLocal(new Date(), (await configuracionLocal()).zonaHoraria)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
          aria-label="Buscar producto por nombre, SKU o código"
          className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white"
        />
        <div className="flex gap-2 overflow-x-auto sin-scrollbar pb-1">
          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            aria-label="Filtrar por categoría"
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
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-[var(--texto-suave)] flex items-center gap-2 min-w-0 max-w-full">
            Ordenar
            <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}
              className="tap min-w-0 max-w-full px-3 py-2 rounded-lg border border-[var(--borde)] bg-white text-sm text-[var(--texto)]">
              {ORDENES.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
            </select>
          </label>
          {puedeEditar && productos.length > 0 && (
            <button onClick={() => setRevisando((v) => !v)} aria-pressed={revisando}
              className={`tap px-3 rounded-lg text-sm border ${revisando ? 'border-marca-500 bg-marca-50 text-marca-900 font-medium' : 'border-[var(--borde)] bg-white'}`}>
              {calidad.porProducto.size === 0 ? '✓ Datos completos' : `Revisar datos (${calidad.porProducto.size})`}
            </button>
          )}
          {/* Exportar: no el vendedor (matriz del doc 02). */}
          {puedeEditar && productos.length > 0 && (
            <button onClick={exportar} className="btn btn-secundario btn-chico ml-auto">
              <Icono nombre="descargar" tamano={16} /> Exportar
            </button>
          )}
        </div>
        {revisando && calidad.porProducto.size > 0 && (
          <p className="text-xs text-[var(--texto-suave)] bg-[var(--superficie)] border border-[var(--borde)] rounded-lg px-3 py-2">
            {(Object.entries(calidad.conteo) as Array<[ProblemaCatalogo, number]>).filter(([, n]) => n > 0)
              .map(([k, n]) => `${n} ${TEXTO_PROBLEMA[k].split(':')[0].toLowerCase()}`).join(' · ')}.
            Toca Editar para completarlos.
          </p>
        )}
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
          {visibles.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA).map((p) => {
            const est = estadoStock(p);
            const problemas = revisando ? calidad.porProducto.get(p.id) ?? [] : [];
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
                    {/* RF-M2-17 · el precio se cambia tocándolo, sin abrir todo el formulario. */}
                    {puedeEditarPrecios && p.activo ? (
                      <button onClick={() => setCambiandoPrecio(p)} title="Cambiar el precio"
                        aria-label={`Cambiar el precio de ${p.nombre}, ahora ${formatCLP(p.precioVenta)}`}
                        className="tap -my-2 -mr-2 px-2 num font-semibold underline decoration-dotted underline-offset-4">
                        {formatCLP(p.precioVenta)}
                      </button>
                    ) : (
                      <p className="num font-semibold">{formatCLP(p.precioVenta)}</p>
                    )}
                    {puedeVerCostos && typeof p.costoPromedio === 'number' && p.costoPromedio > 0 && (
                      <p className="text-xs text-[var(--texto-suave)] num">
                        costo {formatCLP(p.costoPromedio)} · margen {formatPct(margenNetoPct(p.precioVenta, p.costoPromedio, ivaPct))}
                      </p>
                    )}
                  </div>
                </div>

                {problemas.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {problemas.map((x) => <li key={x} className="insignia insignia-aviso">{TEXTO_PROBLEMA[x].split(':')[0]}</li>)}
                  </ul>
                )}
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <p className={`text-xs num ${est.clase}`}>
                    {est.icono} {est.texto} · {cantidadConUnidad(p.stock, 'unidad')} en bodega
                    {p.stockMinimo > 0 && ` (mín. ${formatCantidad(p.stockMinimo)})`}
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

      {/* Páginas: abajo, donde termina de leer. Al cambiar, vuelve arriba. */}
      {!cargando && visibles.length > POR_PAGINA && (() => {
        const total = Math.ceil(visibles.length / POR_PAGINA);
        const ir = (n: number) => { setPagina(n); window.scrollTo({ top: 0 }); };
        return (
          <nav aria-label="Páginas de productos" className="flex items-center justify-between gap-2 mt-3">
            <button onClick={() => ir(pagina - 1)} disabled={pagina === 0} className="btn btn-secundario">
              ← Anterior
            </button>
            <p className="text-sm text-center num">
              Página {pagina + 1} de {total}
              <span className="block text-xs text-[var(--texto-suave)]">
                {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, visibles.length)} de {visibles.length}
              </span>
            </p>
            <button onClick={() => ir(pagina + 1)} disabled={pagina >= total - 1} className="btn btn-secundario">
              Siguiente →
            </button>
          </nav>
        );
      })()}

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
                ? `${r.nombre} creado con ${cantidadConUnidad(total, 'unidad')} en bodega`
                : `${r.nombre} creado, sin stock. Para cargarle unidades: Compras → Recibir mercadería, o Inventario → Ajustar`);
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

      {cambiandoPrecio && (
        <CambiarPrecio
          producto={cambiandoPrecio}
          onCerrar={() => setCambiandoPrecio(null)}
          onGuardado={(texto) => { setCambiandoPrecio(null); setAviso(texto); void cargar(); }}
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

/**
 * Cambio rápido de precio (RF-M2-17). Pasa por la misma función que el
 * formulario, así que queda en el historial de precios y en la bitácora, y
 * avisa si otra persona cambió el producto entremedio.
 */
function CambiarPrecio({ producto, onCerrar, onGuardado }: {
  producto: Producto;
  onCerrar: () => void;
  onGuardado: (texto: string) => void;
}) {
  const [precio, setPrecio] = useState(producto.precioVenta.toLocaleString('es-CL'));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const v = validarMonto(precio, { etiqueta: 'precio', permiteCero: false, maximo: 50_000_000 });
  const variacion = v.valido && producto.precioVenta > 0
    ? Math.round(((v.valor - producto.precioVenta) / producto.precioVenta) * 100) : 0;

  async function guardar() {
    if (!v.valido) { setError(v.error); return; }
    if (v.valor === producto.precioVenta) { onCerrar(); return; }
    setGuardando(true);
    setError(null);
    try {
      await repoProductos().actualizar(producto.id, {
        nombre: producto.nombre, descripcion: producto.descripcion, sku: producto.sku,
        categoriaId: producto.categoriaId, unidad: producto.unidad, precioVenta: v.valor,
        stockMinimo: producto.stockMinimo, perecible: producto.perecible, diasAlerta: producto.diasAlerta,
        esperadoEn: producto.actualizadoEn,
      });
      onGuardado(`${producto.nombre}: ${formatCLP(producto.precioVenta)} → ${formatCLP(v.valor)}`);
    } catch (e) {
      setError(toUserMessage(e));
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Precio de ${producto.nombre}`} encabezado="visible" onCerrar={onCerrar} bloqueado={guardando}>
      <form className="p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
        <p className="text-sm text-[var(--texto-suave)]">
          Ahora: <strong className="num text-[var(--texto)]">{formatCLP(producto.precioVenta)}</strong>. El cambio queda en el
          historial de precios con tu nombre, y los celulares lo reciben al actualizar el catálogo.
        </p>
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">Precio nuevo</span>
          <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="numeric" autoFocus
            onFocus={(e) => e.currentTarget.select()}
            className="tap w-full px-3 py-3 rounded-xl border border-[var(--borde)] num text-right text-lg" />
        </label>
        {v.valido && Math.abs(variacion) >= 30 && (
          <p className="text-xs text-[var(--color-aviso)] bg-amber-50 px-3 py-2 rounded-lg">
            ⚠ Es un cambio de {variacion > 0 ? '+' : ''}{formatPct(variacion)}. Revisa que no falte o sobre un cero.
          </p>
        )}
        {v.valido && precioConRedondeo(v.valor) && (
          <p className="text-xs text-[var(--color-aviso)] bg-amber-50 px-3 py-2 rounded-lg">
            No termina en 0: al pagar en efectivo habrá que redondear (Ley 20.956).
          </p>
        )}
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <button type="submit" disabled={guardando || !v.valido} className="btn btn-primario w-full">
          {guardando ? 'Guardando…' : 'Guardar precio'}
        </button>
      </form>
    </Modal>
  );
}
