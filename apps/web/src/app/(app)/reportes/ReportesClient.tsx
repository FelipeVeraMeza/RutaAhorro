'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatCLP, toUserMessage, aCSV, nombreArchivoReporte, type ColumnaCSV,
} from '@rutaahorro/core';
import {
  repoReportes, hoyChile, hace,
  type RangoFechas, type VentaPorDia, type VentaPorProducto, type VentaPorUsuario,
  type FilaInventarioValorizado, type ProductoSinMovimiento, type Ajuste,
} from '@/lib/datos/reportes';
import { ETIQUETA_MOVIMIENTO, type TipoMovimiento } from '@/lib/datos/inventario';

type Vista = 'ventas' | 'productos' | 'usuarios' | 'inventario' | 'dormido' | 'ajustes';

/**
 * Reportes del negocio (módulo M7).
 *
 * Las siete vistas que alimentan esta pantalla existen desde la migración
 * 0005 y hasta hoy no las leía nadie. El dueño no tenía forma de responder las
 * preguntas por las que se compra un sistema como este: qué se vende, qué deja
 * margen, quién vende, cuánta plata hay dormida en la bodega y en qué se fue
 * la que falta.
 *
 * Sobre los permisos (RF-M7-12): el costo y el margen son solo para `admin`.
 * No es un detalle de interfaz — el dato no se pide siquiera, igual que en el
 * repositorio de productos, porque un dato que no viaja no se puede filtrar
 * mal después.
 */
export function ReportesClient({ verCostos }: { verCostos: boolean }) {
  const [vista, setVista] = useState<Vista>('ventas');
  const [desde, setDesde] = useState(hace(29));
  const [hasta, setHasta] = useState(hoyChile());
  const [diasDormido, setDiasDormido] = useState(30);

  const [ventas, setVentas] = useState<VentaPorDia[]>([]);
  const [productos, setProductos] = useState<VentaPorProducto[]>([]);
  const [usuarios, setUsuarios] = useState<VentaPorUsuario[]>([]);
  const [inventario, setInventario] = useState<FilaInventarioValorizado[]>([]);
  const [dormido, setDormido] = useState<ProductoSinMovimiento[]>([]);
  const [ajustes, setAjustes] = useState<Ajuste[]>([]);

  const [ordenProductos, setOrdenProductos] = useState<'monto' | 'unidades'>('monto');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rango: RangoFechas = useMemo(() => ({ desde, hasta }), [desde, hasta]);
  const rangoInvertido = desde > hasta;

  /**
   * Se carga solo la pestaña visible.
   *
   * Traer los seis reportes de una vez son seis consultas por cada cambio de
   * fecha, y el dueño mira uno a la vez. En un celular con datos móviles la
   * diferencia se siente.
   */
  const cargar = useCallback(async () => {
    if (rangoInvertido) return;
    setCargando(true);
    setError(null);
    try {
      const repo = repoReportes();
      if (vista === 'ventas') setVentas(await repo.ventasPorDia(rango));
      if (vista === 'productos') setProductos(await repo.ventasPorProducto(rango, verCostos));
      if (vista === 'usuarios') setUsuarios(await repo.ventasPorUsuario(rango));
      if (vista === 'inventario') setInventario(await repo.inventarioValorizado());
      if (vista === 'dormido') setDormido(await repo.sinMovimiento(diasDormido));
      if (vista === 'ajustes') setAjustes(await repo.ajustes(rango));
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setCargando(false);
    }
  }, [vista, rango, rangoInvertido, verCostos, diasDormido]);

  useEffect(() => { void cargar(); }, [cargar]);

  function exportar<T>(titulo: string, filas: readonly T[], columnas: ReadonlyArray<ColumnaCSV<T>>) {
    const blob = new Blob([aCSV(filas, columnas)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivoReporte(titulo, desde, hasta);
    // Anclar al documento y liberar la URL en el siguiente ciclo: revocarla en
    // la misma vuelta que el clic cancela la descarga en Safari de iPhone.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const totalVendido = ventas.reduce((s, d) => s + d.total, 0);
  const totalTransacciones = ventas.reduce((s, d) => s + d.ventas, 0);
  const utilidadTotal = productos.reduce((s, p) => s + (p.utilidad ?? 0), 0);
  const ingresoTotal = productos.reduce((s, p) => s + p.ingresos, 0);

  const productosOrdenados = useMemo(
    () => [...productos].sort((a, b) =>
      ordenProductos === 'monto' ? b.ingresos - a.ingresos : b.unidades - a.unidades),
    [productos, ordenProductos],
  );

  const PESTANAS: Array<[Vista, string]> = [
    ['ventas', 'Ventas'],
    ['productos', 'Productos'],
    ['usuarios', 'Vendedores'],
    ['inventario', 'Inventario'],
    ['dormido', 'Sin vender'],
    ['ajustes', 'Mermas'],
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg font-semibold mb-3">Reportes</h1>

      <div className="flex gap-2 mb-4 overflow-x-auto sin-scrollbar" role="tablist">
        {PESTANAS.map(([id, label]) => (
          <button
            key={id} role="tab" aria-selected={vista === id}
            onClick={() => setVista(id)}
            className={`tap px-4 py-2 rounded-lg text-sm border shrink-0 ${
              vista === id
                ? 'border-marca-500 bg-marca-50 text-marca-900 font-medium'
                : 'border-[var(--borde)] bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* El inventario valorizado es una foto de ahora, no de un período: no
          tiene sentido preguntarle por fechas. */}
      {vista !== 'inventario' && vista !== 'dormido' && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <label className="text-xs text-[var(--texto-suave)]">
            Desde
            <input
              type="date" value={desde} max={hasta}
              onChange={(e) => setDesde(e.target.value)}
              className="tap w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white text-sm num"
            />
          </label>
          <label className="text-xs text-[var(--texto-suave)]">
            Hasta
            <input
              type="date" value={hasta} min={desde} max={hoyChile()}
              onChange={(e) => setHasta(e.target.value)}
              className="tap w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white text-sm num"
            />
          </label>
        </div>
      )}

      {vista === 'dormido' && (
        <label className="block text-xs text-[var(--texto-suave)] mb-3">
          Sin venderse hace al menos
          <select
            value={diasDormido}
            onChange={(e) => setDiasDormido(Number(e.target.value))}
            className="tap w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white text-sm"
          >
            <option value={15}>15 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
        </label>
      )}

      {rangoInvertido && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3">
          La fecha de inicio es posterior a la de término.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="text-sm text-[var(--texto-suave)] text-center py-8">Cargando…</p>
      ) : (
        <>
          {/* --------------------------------------------------- VENTAS */}
          {vista === 'ventas' && (
            <Reporte
              vacio={ventas.length === 0}
              mensajeVacio="No hay ventas en este período."
              onExportar={() => exportar('Ventas por periodo', ventas, [
                { titulo: 'fecha', valor: (d) => d.fecha },
                { titulo: 'ventas', valor: (d) => d.ventas },
                { titulo: 'total', valor: (d) => d.total },
                { titulo: 'ticket_promedio', valor: (d) => d.ticketPromedio },
              ])}
              resumen={[
                ['Vendido', formatCLP(totalVendido)],
                ['Ventas', String(totalTransacciones)],
                ['Ticket prom.', formatCLP(totalTransacciones > 0 ? Math.round(totalVendido / totalTransacciones) : 0)],
              ]}
            >
              {/* Barras proporcionales al mejor día: un gráfico de verdad
                  pediría una biblioteca, y esto responde la misma pregunta —
                  qué días se vende más— sin sumar peso a la descarga. */}
              <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
                {ventas.map((d) => {
                  const maximo = Math.max(...ventas.map((x) => x.total), 1);
                  return (
                    <li key={d.fecha} className="px-4 py-2.5">
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="num">{fechaCorta(d.fecha)}</span>
                        <span className="num font-semibold">{formatCLP(d.total)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-[var(--fondo)] overflow-hidden">
                        <div
                          className="h-full bg-marca-500"
                          style={{ width: `${Math.round((d.total / maximo) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-[var(--texto-suave)] num mt-0.5">
                        {d.ventas} {d.ventas === 1 ? 'venta' : 'ventas'} · ticket {formatCLP(d.ticketPromedio)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Reporte>
          )}

          {/* ------------------------------------------------ PRODUCTOS */}
          {vista === 'productos' && (
            <Reporte
              vacio={productos.length === 0}
              mensajeVacio="No hay ventas de productos en este período."
              onExportar={() => exportar('Ventas por producto', productosOrdenados, [
                { titulo: 'producto', valor: (p) => p.nombre },
                { titulo: 'unidades', valor: (p) => p.unidades },
                { titulo: 'ingresos', valor: (p) => p.ingresos },
                ...(verCostos ? [
                  { titulo: 'costo', valor: (p: VentaPorProducto) => p.costo ?? 0 },
                  { titulo: 'utilidad', valor: (p: VentaPorProducto) => p.utilidad ?? 0 },
                ] : []),
              ])}
              resumen={verCostos ? [
                ['Ingresos', formatCLP(ingresoTotal)],
                ['Utilidad', formatCLP(utilidadTotal)],
                ['Margen', ingresoTotal > 0 ? `${Math.round((utilidadTotal / ingresoTotal) * 100)}%` : '—'],
              ] : [['Ingresos', formatCLP(ingresoTotal)]]}
            >
              <div className="flex gap-2 mb-2">
                {(['monto', 'unidades'] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => setOrdenProductos(o)}
                    aria-pressed={ordenProductos === o}
                    className={`tap px-3 py-1.5 rounded-lg text-xs border ${
                      ordenProductos === o ? 'border-marca-500 bg-marca-50' : 'border-[var(--borde)] bg-white'
                    }`}
                  >
                    Ordenar por {o === 'monto' ? 'monto' : 'unidades'}
                  </button>
                ))}
              </div>
              <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
                {productosOrdenados.map((p) => (
                  <li key={p.productoId} className="px-4 py-2.5 flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{p.nombre}</p>
                      <p className="text-xs text-[var(--texto-suave)] num">
                        {p.unidades} vendidas
                        {verCostos && typeof p.utilidad === 'number' && p.ingresos > 0 && (
                          <> · margen {Math.round((p.utilidad / p.ingresos) * 100)}%</>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="num font-semibold text-sm">{formatCLP(p.ingresos)}</p>
                      {verCostos && typeof p.utilidad === 'number' && (
                        <p className="text-[11px] num text-[var(--texto-suave)]">
                          util. {formatCLP(p.utilidad)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Reporte>
          )}

          {/* ------------------------------------------------- USUARIOS */}
          {vista === 'usuarios' && (
            <Reporte
              vacio={usuarios.length === 0}
              mensajeVacio="No hay ventas en este período."
              onExportar={() => exportar('Ventas por vendedor', usuarios, [
                { titulo: 'vendedor', valor: (u) => u.nombre },
                { titulo: 'ventas', valor: (u) => u.ventas },
                { titulo: 'total', valor: (u) => u.total },
              ])}
            >
              <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
                {usuarios.map((u) => (
                  <li key={u.usuarioId} className="px-4 py-3 flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{u.nombre}</p>
                      <p className="text-xs text-[var(--texto-suave)] num">
                        {u.ventas} {u.ventas === 1 ? 'venta' : 'ventas'}
                        {u.ventas > 0 && ` · ticket ${formatCLP(Math.round(u.total / u.ventas))}`}
                      </p>
                    </div>
                    <p className="num font-semibold text-sm shrink-0">{formatCLP(u.total)}</p>
                  </li>
                ))}
              </ul>
            </Reporte>
          )}

          {/* ----------------------------------------------- INVENTARIO */}
          {vista === 'inventario' && (
            <Reporte
              vacio={inventario.length === 0}
              mensajeVacio="No hay productos con existencia."
              onExportar={() => exportar('Inventario valorizado', inventario, [
                { titulo: 'producto', valor: (p) => p.nombre },
                { titulo: 'categoria', valor: (p) => p.categoria },
                { titulo: 'cantidad', valor: (p) => p.cantidad },
                ...(verCostos ? [
                  { titulo: 'costo_unitario', valor: (p: FilaInventarioValorizado) => p.costoUnitario },
                  { titulo: 'valor_al_costo', valor: (p: FilaInventarioValorizado) => p.valorCosto },
                ] : []),
                { titulo: 'valor_de_venta', valor: (p) => p.valorVenta },
              ])}
              resumen={verCostos ? [
                ['Al costo', formatCLP(inventario.reduce((s, p) => s + p.valorCosto, 0))],
                ['A precio de venta', formatCLP(inventario.reduce((s, p) => s + p.valorVenta, 0))],
              ] : [['A precio de venta', formatCLP(inventario.reduce((s, p) => s + p.valorVenta, 0))]]}
            >
              <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
                {inventario.map((p) => (
                  <li key={p.productoId} className="px-4 py-2.5 flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{p.nombre}</p>
                      <p className="text-xs text-[var(--texto-suave)] num">
                        {p.cantidad} en existencia
                        {p.categoria && ` · ${p.categoria}`}
                      </p>
                    </div>
                    <p className="num font-semibold text-sm shrink-0">
                      {formatCLP(verCostos ? p.valorCosto : p.valorVenta)}
                    </p>
                  </li>
                ))}
              </ul>
            </Reporte>
          )}

          {/* -------------------------------------------------- DORMIDO */}
          {vista === 'dormido' && (
            <Reporte
              vacio={dormido.length === 0}
              mensajeVacio={`Todo se ha vendido en los últimos ${diasDormido} días.`}
              onExportar={() => exportar('Productos sin vender', dormido, [
                { titulo: 'producto', valor: (p) => p.nombre },
                { titulo: 'cantidad', valor: (p) => p.cantidad },
                { titulo: 'dias_sin_vender', valor: (p) => p.diasSinVender },
                ...(verCostos ? [
                  { titulo: 'valor_al_costo', valor: (p: ProductoSinMovimiento) => p.valorCosto },
                ] : []),
              ])}
              resumen={verCostos ? [
                ['Capital dormido', formatCLP(dormido.reduce((s, p) => s + p.valorCosto, 0))],
                ['Productos', String(dormido.length)],
              ] : [['Productos', String(dormido.length)]]}
            >
              <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
                {dormido.map((p) => (
                  <li key={p.productoId} className="px-4 py-2.5 flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{p.nombre}</p>
                      <p className="text-xs text-[var(--texto-suave)] num">
                        {p.cantidad} en existencia · {p.diasSinVender} días sin venderse
                      </p>
                    </div>
                    {verCostos && (
                      <p className="num font-semibold text-sm shrink-0">{formatCLP(p.valorCosto)}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Reporte>
          )}

          {/* --------------------------------------------------- AJUSTES */}
          {vista === 'ajustes' && (
            <Reporte
              vacio={ajustes.length === 0}
              mensajeVacio="No hay mermas ni ajustes en este período."
              onExportar={() => exportar('Mermas y ajustes', ajustes, [
                { titulo: 'fecha', valor: (a) => a.fecha },
                { titulo: 'tipo', valor: (a) => etiquetaTipo(a.tipo) },
                { titulo: 'producto', valor: (a) => a.productoNombre },
                { titulo: 'cantidad', valor: (a) => a.cantidad },
                { titulo: 'motivo', valor: (a) => a.motivo },
                { titulo: 'usuario', valor: (a) => a.usuario },
                ...(verCostos ? [
                  { titulo: 'impacto', valor: (a: Ajuste) => a.impacto },
                ] : []),
              ])}
              resumen={verCostos ? [
                ['Pérdida', formatCLP(Math.abs(ajustes.filter((a) => a.impacto < 0).reduce((s, a) => s + a.impacto, 0)))],
                ['Movimientos', String(ajustes.length)],
              ] : [['Movimientos', String(ajustes.length)]]}
            >
              <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
                {ajustes.map((a, i) => (
                  <li key={`${a.fecha}-${a.productoNombre}-${i}`} className="px-4 py-2.5">
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{a.productoNombre}</p>
                        <p className="text-xs text-[var(--texto-suave)]">
                          {etiquetaTipo(a.tipo)} · {fechaCorta(a.fecha)}
                          {a.usuario && ` · ${a.usuario}`}
                        </p>
                        {a.motivo && (
                          <p className="text-xs text-[var(--texto-suave)] italic truncate">{a.motivo}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`num font-semibold text-sm ${
                          a.cantidad < 0 ? 'text-[var(--color-alerta)]' : 'text-marca-700'
                        }`}>
                          {a.cantidad > 0 ? '+' : ''}{a.cantidad}
                        </p>
                        {verCostos && (
                          <p className="text-[11px] num text-[var(--texto-suave)]">
                            {formatCLP(a.impacto)}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Reporte>
          )}
        </>
      )}
    </div>
  );
}

/** Envoltura común: tarjetas de resumen, botón de exportar y estado vacío. */
function Reporte({
  vacio, mensajeVacio, onExportar, resumen, children,
}: {
  vacio: boolean;
  mensajeVacio: string;
  onExportar: () => void;
  resumen?: Array<[string, string]>;
  children: React.ReactNode;
}) {
  if (vacio) {
    return <p className="text-center text-sm text-[var(--texto-suave)] py-10">{mensajeVacio}</p>;
  }
  return (
    <>
      {resumen && resumen.length > 0 && (
        <div className={`grid gap-2 mb-3 ${resumen.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {resumen.map(([label, valor]) => (
            <div key={label} className="tarjeta p-3">
              <p className="num text-base font-bold truncate">{valor}</p>
              <p className="text-[11px] text-[var(--texto-suave)] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}
      {children}
      <button
        onClick={onExportar}
        className="tap w-full mt-3 py-3 rounded-xl border border-[var(--borde)] font-medium text-sm"
      >
        ⬇ Exportar a Excel
      </button>
    </>
  );
}

const fechaCorta = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit',
  });

function etiquetaTipo(tipo: string): string {
  return ETIQUETA_MOVIMIENTO[tipo as TipoMovimiento] ?? tipo;
}
