'use client';
import { Icono } from '@/components/Icono';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatCLP, formatCantidad, formatPct, toUserMessage, aCSV, nombreArchivoReporte, type ColumnaCSV,
  periodoAnterior, variacionPct, serieCompleta, diasEnRango, ventasPorHora, clasificacionABC,
} from '@rutaahorro/core';
import { useFormatoFecha } from '@/lib/formatoFecha';
import { GraficoVentas } from '@/components/GraficoVentas';
import { Variacion } from '@/components/Tendencia';
import {
  repoReportes, hoyLocal, hace,
  type RangoFechas, type VentaPorDia, type VentaPorProducto, type VentaPorUsuario,
  type FilaInventarioValorizado, type ProductoSinMovimiento, type Ajuste, type ControlAnulaciones,
} from '@/lib/datos/reportes';
import { ETIQUETA_MOVIMIENTO, type TipoMovimiento } from '@/lib/datos/inventario';
import { useConfiguracion } from '@/lib/datos/configuracion';
import { Encabezado } from '@/components/Encabezado';

type Vista = 'ventas' | 'horas' | 'productos' | 'usuarios' | 'control' | 'inventario' | 'dormido' | 'ajustes';

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
const VISTAS: readonly Vista[] = ['ventas', 'horas', 'productos', 'usuarios', 'control', 'inventario', 'dormido', 'ajustes'];

/**
 * Margen sobre la venta sin IVA. La utilidad ya viene neta (0033) y el costo
 * es neto, así que la venta sin IVA es utilidad + costo: dividir por lo cobrado
 * con IVA achicaba el margen en la misma proporción en que antes se inflaba.
 */
function margenSobreNeto(utilidad: number, costo: number): number {
  return (utilidad / (utilidad + costo)) * 100;
}

export function ReportesClient({ verCostos, vistaInicial }: { verCostos: boolean; vistaInicial?: string }) {
  const { zonaHoraria: zona } = useConfiguracion();
  const [vista, setVista] = useState<Vista>(VISTAS.includes(vistaInicial as Vista) ? vistaInicial as Vista : 'ventas');
  const [desde, setDesde] = useState(hace(29, zona));
  const [hasta, setHasta] = useState(hoyLocal(zona));
  // Los valores de arriba se calculan con la zona por omisión; cuando llega
  // la del local se recalculan. Pasa una vez, al entrar.
  useEffect(() => { setDesde(hace(29, zona)); setHasta(hoyLocal(zona)); }, [zona]);
  const [diasDormido, setDiasDormido] = useState(30);

  const [ventas, setVentas] = useState<VentaPorDia[]>([]);
  // RF-M7-11 · lo mismo en el período anterior de igual largo.
  const [anterior, setAnterior] = useState<{ total: number; ventas: number; desde: string; hasta: string } | null>(null);
  const [productos, setProductos] = useState<VentaPorProducto[]>([]);
  const [usuarios, setUsuarios] = useState<VentaPorUsuario[]>([]);
  const [inventario, setInventario] = useState<FilaInventarioValorizado[]>([]);
  const [dormido, setDormido] = useState<ProductoSinMovimiento[]>([]);
  const [ajustes, setAjustes] = useState<Ajuste[]>([]);
  const [porHora, setPorHora] = useState<ReturnType<typeof ventasPorHora>>([]);
  const [control, setControl] = useState<ControlAnulaciones | null>(null);
  const [exportandoDetalle, setExportandoDetalle] = useState(false);
  const { fechaHora, fechaHoraPlanilla } = useFormatoFecha();

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
  // Cambiar de fecha o de pestaña rápido dejaba dos consultas en vuelo, y la
  // que llegaba última (la vieja, a veces) pisaba a la nueva: se veía el
  // reporte de otro período con las fechas del nuevo arriba.
  const pedido = useRef(0);
  const cargar = useCallback(async () => {
    if (rangoInvertido) return;
    const n = ++pedido.current;
    const vigente = () => n === pedido.current;
    setCargando(true);
    setError(null);
    try {
      const repo = repoReportes();
      if (vista === 'ventas') {
        const previo = periodoAnterior(rango.desde, rango.hasta);
        const [actual, antes] = await Promise.all([repo.ventasPorDia(rango), repo.ventasPorDia(previo)]);
        if (!vigente()) return;
        setVentas(actual);
        setAnterior({
          total: antes.reduce((s, d) => s + d.total, 0),
          ventas: antes.reduce((s, d) => s + d.ventas, 0),
          ...previo,
        });
      }
      if (vista === 'productos') { const r = await repo.ventasPorProducto(rango, verCostos); if (vigente()) setProductos(r); }
      if (vista === 'horas') { const r = ventasPorHora(await repo.ventasCrudas(rango), zona); if (vigente()) setPorHora(r); }
      if (vista === 'control') { const r = await repo.controlAnulaciones(rango); if (vigente()) setControl(r); }
      if (vista === 'usuarios') { const r = await repo.ventasPorUsuario(rango); if (vigente()) setUsuarios(r); }
      if (vista === 'inventario') { const r = await repo.inventarioValorizado(); if (vigente()) setInventario(r); }
      if (vista === 'dormido') { const r = await repo.sinMovimiento(diasDormido); if (vigente()) setDormido(r); }
      if (vista === 'ajustes') { const r = await repo.ajustes(rango); if (vigente()) setAjustes(r); }
    } catch (e) {
      if (vigente()) setError(toUserMessage(e));
    } finally {
      if (vigente()) setCargando(false);
    }
  }, [vista, rango, rangoInvertido, verCostos, diasDormido, zona]);

  /** RF-M7-16 · una fila por línea vendida: lo que pide el contador. */
  async function exportarDetalle() {
    setExportandoDetalle(true);
    try {
      const filas = await repoReportes().ventasDetalladas(rango);
      exportar('Ventas detalladas', filas, [
        { titulo: 'folio', valor: (f) => f.folio },
        { titulo: 'fecha', valor: (f) => fechaHoraPlanilla(f.fecha) },
        { titulo: 'estado', valor: (f) => f.estado },
        { titulo: 'documento', valor: (f) => f.documento },
        { titulo: 'vendedor', valor: (f) => f.vendedor ?? '' },
        { titulo: 'producto', valor: (f) => f.producto },
        { titulo: 'cantidad', valor: (f) => f.cantidad },
        { titulo: 'precio_unitario', valor: (f) => f.precioUnitario },
        { titulo: 'descuento', valor: (f) => f.descuento },
        { titulo: 'subtotal', valor: (f) => f.subtotal },
        { titulo: 'total_venta', valor: (f) => f.totalVenta },
        { titulo: 'medios_de_pago', valor: (f) => f.mediosDePago },
      ]);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setExportandoDetalle(false);
    }
  }

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
  const costoTotal = productos.reduce((s, p) => s + (p.costo ?? 0), 0);
  const ingresoTotal = productos.reduce((s, p) => s + p.ingresos, 0);

  // RF-M7-14 · A: el 80 % de lo vendido; B: el 15 % siguiente; C: el resto.
  const claseABC = useMemo(() => new Map(clasificacionABC(productos).map((p) => [p.productoId, p.clase])), [productos]);
  const productosOrdenados = useMemo(
    () => [...productos].sort((a, b) =>
      ordenProductos === 'monto' ? b.ingresos - a.ingresos : b.unidades - a.unidades),
    [productos, ordenProductos],
  );

  const PESTANAS: Array<[Vista, string]> = [
    ['ventas', 'Ventas'],
    ['horas', 'Por hora'],
    ['productos', 'Productos'],
    ['usuarios', 'Vendedores'],
    ['control', 'Anulaciones'],
    ['inventario', 'Inventario'],
    ['dormido', 'Sin vender'],
    ['ajustes', 'Mermas'],
  ];

  return (
    <div className="px-4 py-5">
      <Encabezado
        titulo="Reportes"
        icono="reportes"
        descripcion="Elige qué quieres saber y el período. Todo se puede bajar a Excel."
      />

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
              type="date" value={hasta} min={desde} max={hoyLocal(zona)}
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
              {anterior && (
                <p className="mb-3">
                  <Variacion pct={variacionPct(totalVendido, anterior.total)}
                    contra={`${fechaCorta(anterior.desde)} al ${fechaCorta(anterior.hasta)} (${formatCLP(anterior.total)})`} />
                </p>
              )}
              {diasEnRango(desde, hasta) <= 62 && (
                <div className="tarjeta p-4 mb-3">
                  <GraficoVentas puntos={serieCompleta(
                    ventas.map((d) => ({ fecha: d.fecha, total: d.total, ventas: d.ventas })), desde, hasta)}
                    ultimoEsHoy={hasta === hoyLocal(zona)} />
                </div>
              )}
              {/* Día por día, plegado cuando ya está el gráfico: repetía lo
                  mismo en 30 filas y empujaba "Exportar" al fondo. */}
              <details className="group" open={diasEnRango(desde, hasta) > 62}>
              <summary className="tap flex items-center cursor-pointer text-sm font-medium px-1 mb-2">
                Ver día por día ({ventas.length} {ventas.length === 1 ? 'día' : 'días'} con ventas)
              </summary>
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
              </details>
              <button onClick={() => void exportarDetalle()} disabled={exportandoDetalle} className="btn btn-secundario w-full mt-3">
                <Icono nombre="descargar" tamano={18} /> {exportandoDetalle ? 'Preparando…' : 'Exportar ventas línea por línea (para el contador)'}
              </button>
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
                  { titulo: 'utilidad_sin_iva', valor: (p: VentaPorProducto) => p.utilidad ?? 0 },
                ] : []),
              ])}
              resumen={verCostos ? [
                ['Ingresos', formatCLP(ingresoTotal)],
                ['Utilidad (sin IVA)', formatCLP(utilidadTotal)],
                ['Margen', utilidadTotal + costoTotal > 0 ? formatPct(margenSobreNeto(utilidadTotal, costoTotal), 0) : '—'],
              ] : [['Ingresos', formatCLP(ingresoTotal)]]}
            >
              <p className="text-xs text-[var(--texto-suave)] mb-2">
                <span className="insignia insignia-ok">A</span> {[...claseABC.values()].filter((c) => c === 'A').length} productos hacen el 80 % de lo
                vendido: que nunca falten. <span className="insignia insignia-neutra">C</span> {[...claseABC.values()].filter((c) => c === 'C').length} juntan
                solo el último 5 %.
              </p>
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
                      <p className="text-sm truncate">
                        <span className={`insignia mr-1.5 ${claseABC.get(p.productoId) === 'A' ? 'insignia-ok' : 'insignia-neutra'}`}
                              title="A: el 80 % de lo vendido · B: el 15 % siguiente · C: el resto">{claseABC.get(p.productoId)}</span>
                        {p.nombre}
                      </p>
                      <p className="text-xs text-[var(--texto-suave)] num">
                        {formatCantidad(p.unidades)} {p.unidades === 1 ? 'vendida' : 'vendidas'}
                        {verCostos && typeof p.utilidad === 'number' && p.utilidad + (p.costo ?? 0) > 0 && (
                          <> · margen {formatPct(margenSobreNeto(p.utilidad, p.costo ?? 0), 0)}</>
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

          {/* ---------------------------------------------------- POR HORA */}
          {vista === 'horas' && (
            <Reporte
              vacio={porHora.every((h) => h.ventas === 0)}
              mensajeVacio="No hay ventas en este período."
              onExportar={() => exportar('Ventas por hora', porHora, [
                { titulo: 'hora', valor: (h) => `${String(h.hora).padStart(2, '0')}:00` },
                { titulo: 'ventas', valor: (h) => h.ventas },
                { titulo: 'total', valor: (h) => h.total },
              ])}
              resumen={(() => {
                const pico = [...porHora].sort((a, b) => b.total - a.total)[0];
                return pico ? [['Hora de más venta', `${String(pico.hora).padStart(2, '0')}:00 a ${String(pico.hora + 1).padStart(2, '0')}:00`], ['Vendido en esa hora', formatCLP(pico.total)]] : [];
              })() as Array<[string, string]>}
            >
              {/* RF-M7-13 · para saber cuándo reforzar el mostrador. */}
              <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
                {porHora.filter((h) => h.ventas > 0).map((h) => {
                  const maximo = Math.max(...porHora.map((x) => x.total), 1);
                  return (
                    <li key={h.hora} className="px-4 py-2">
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="num">{String(h.hora).padStart(2, '0')}:00</span>
                        <span className="num font-semibold">{formatCLP(h.total)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-[var(--fondo)] overflow-hidden">
                        <div className="h-full bg-marca-500" style={{ width: `${Math.round((h.total / maximo) * 100)}%` }} />
                      </div>
                      <p className="text-[11px] text-[var(--texto-suave)] num mt-0.5">{h.ventas} {h.ventas === 1 ? 'venta' : 'ventas'}</p>
                    </li>
                  );
                })}
              </ul>
            </Reporte>
          )}

          {/* ------------------------------------------------ ANULACIONES */}
          {vista === 'control' && control && (
            <Reporte
              vacio={control.anulaciones.length === 0 && control.devoluciones.length === 0}
              mensajeVacio="No hubo anulaciones ni devoluciones en este período."
              onExportar={() => exportar('Anulaciones y devoluciones', [
                ...control.anulaciones.map((a) => ({ tipo: 'anulación', n: a.folio, fecha: a.fecha, monto: a.total, motivo: a.motivo ?? '', quien: a.anulo ?? '', vendio: a.vendio ?? '' })),
                ...control.devoluciones.map((d) => ({ tipo: 'devolución', n: d.folio ?? d.numero, fecha: d.fecha, monto: d.monto, motivo: d.motivo, quien: d.hizo ?? '', vendio: '' })),
              ], [
                { titulo: 'tipo', valor: (f) => f.tipo },
                { titulo: 'folio', valor: (f) => f.n },
                { titulo: 'fecha', valor: (f) => fechaHoraPlanilla(f.fecha) },
                { titulo: 'monto', valor: (f) => f.monto },
                { titulo: 'motivo', valor: (f) => f.motivo },
                { titulo: 'hecha_por', valor: (f) => f.quien },
                { titulo: 'vendida_por', valor: (f) => f.vendio },
              ])}
              resumen={[
                ['Anulado', formatCLP(control.anulaciones.reduce((s, a) => s + a.total, 0))],
                ['Devuelto', formatCLP(control.devoluciones.reduce((s, d) => s + d.monto, 0))],
              ]}
            >
              {/* RF-M7-15 · muchas anulaciones de la misma persona son la primera señal de un problema de caja. */}
              {(() => {
                const porPersona = new Map<string, number>();
                for (const a of control.anulaciones) porPersona.set(a.anulo ?? 'Sin nombre', (porPersona.get(a.anulo ?? 'Sin nombre') ?? 0) + 1);
                for (const d of control.devoluciones) porPersona.set(d.hizo ?? 'Sin nombre', (porPersona.get(d.hizo ?? 'Sin nombre') ?? 0) + 1);
                return (
                  <p className="text-xs text-[var(--texto-suave)] mb-2">
                    Por persona: {[...porPersona.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(' · ')}
                  </p>
                );
              })()}
              <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
                {control.anulaciones.map((a) => (
                  <li key={`a-${a.folio}`} className="px-4 py-2.5 flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm"><span className="insignia insignia-alerta">Anulada</span> Folio <span className="num">{a.folio}</span></p>
                      <p className="text-xs text-[var(--texto-suave)]">{fechaHora(a.fecha)} · anuló {a.anulo ?? '—'}{a.vendio ? ` · vendió ${a.vendio}` : ''}</p>
                      {a.motivo && <p className="text-xs italic text-[var(--texto-suave)] truncate">{a.motivo}</p>}
                    </div>
                    <p className="num font-semibold text-sm shrink-0">{formatCLP(a.total)}</p>
                  </li>
                ))}
                {control.devoluciones.map((d) => (
                  <li key={`d-${d.numero}`} className="px-4 py-2.5 flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm"><span className="insignia insignia-aviso">Devolución</span> N° <span className="num">{d.numero}</span>{d.folio ? ` · venta ${d.folio}` : ''}</p>
                      <p className="text-xs text-[var(--texto-suave)]">{fechaHora(d.fecha)} · hizo {d.hizo ?? '—'}</p>
                      <p className="text-xs italic text-[var(--texto-suave)] truncate">{d.motivo}</p>
                    </div>
                    <p className="num font-semibold text-sm shrink-0">{formatCLP(d.monto)}</p>
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
                        {formatCantidad(p.cantidad)} en existencia
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
                        {formatCantidad(p.cantidad)} en existencia · {p.diasSinVender} días sin venderse
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
                          {a.cantidad > 0 ? '+' : ''}{formatCantidad(a.cantidad)}
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
        // Con tres cifras, en el celular la primera (la plata) va sola arriba:
        // en un tercio de 360 px "$4.948.687" se cortaba en "$4.948…".
        <div className={`grid gap-2 mb-3 ${resumen.length >= 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
          {resumen.map(([label, valor], i) => (
            <div key={label} className={`tarjeta p-3 ${resumen.length >= 3 && i === 0 ? 'col-span-2 sm:col-span-1' : ''}`}>
              <p className="num text-base font-bold truncate">{valor}</p>
              <p className="text-[11px] text-[var(--texto-suave)] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}
      {children}
      <button
        onClick={onExportar}
        className="btn btn-secundario w-full mt-3"
      >
        <Icono nombre="descargar" tamano={18} /> Exportar a Excel
      </button>
    </>
  );
}

/** 'AAAA-MM-DD' (o una fecha con hora) como 'DD-MM', sin pasar por Date (regla 17). */
const fechaCorta = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return d && m ? `${d}-${m}` : a;
};

function etiquetaTipo(tipo: string): string {
  return ETIQUETA_MOVIMIENTO[tipo as TipoMovimiento] ?? tipo;
}
