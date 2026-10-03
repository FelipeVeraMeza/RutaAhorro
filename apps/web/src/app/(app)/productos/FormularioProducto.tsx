'use client';
import { Icono } from '@/components/Icono';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  formatCLP, margenNeto, margenNetoPct, formatPct, textoVencimiento, diasEntre, isValidEan, normalizeBarcode, toUserMessage,
  validarMonto, validarCantidad, cantidadConUnidad, diaLocal, precioConRedondeo, validarCantidadStock
} from '@rutaahorro/core';
import { repoProductos, type Categoria, type Producto, type CambioPrecio } from '@/lib/productos';
import { useFormatoFecha } from '@/lib/formatoFecha';
import { useScanner } from '@/lib/scanner/useScanner';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { repoPrecios, type ImpuestoAdicional } from '@/lib/datos/precios';
import { useConfiguracion } from '@/lib/datos/configuracion';
import { OfertasEImpuesto, filasDesdeTramos, tramosDesdeFilas, type FilaOferta } from './OfertasEImpuesto';


interface Props {
  producto: Producto | null;   // null = alta
  categorias: Categoria[];
  puedeVerCostos: boolean;
  /** Ofertas e impuesto adicional: admin y supervisor (fn_guardar_precios_producto, 0018). */
  puedeEditarPrecios?: boolean;
  esAdmin?: boolean;
  /** Al guardar, qué quedó: para decirlo en la lista y mostrar el producto. */
  onGuardado: (resumen: {
    id: string; nombre: string; nuevo: boolean; sala: number; bodega: number;
    unidad: string; perecible: boolean;
  }) => void;
  onCancelar: () => void;
  /** Otra persona lo cambió mientras se editaba (0020): volver a abrirlo con lo nuevo. */
  onRecargar?: () => void;
  /** Alta a partir de otro producto (RF-M2-15): mismos datos, sin códigos ni stock. */
  plantilla?: Producto | null;
  /** Alta desde un código escaneado que no existía (RF-M5-04, RF-M2-04). */
  codigoInicial?: string | null;
  /** Edición: abrir un alta copiando este producto. */
  onDuplicar?: (p: Producto) => void;
  /** Alta con el nombre que se buscó y no estaba (Recibir mercadería). */
  nombreInicial?: string | null;
  /**
   * Alta desde Recibir mercadería (T-55): el producto llegó en la factura y
   * todavía no estaba en el catálogo. Nace sin stock y sin costo, porque la
   * cantidad, el costo y el vencimiento se anotan en la línea de la
   * recepción; preguntarlos acá los sumaba dos veces.
   */
  desdeRecepcion?: boolean;
}

export function FormularioProducto({
  producto, categorias, puedeVerCostos, puedeEditarPrecios = false, esAdmin = false, onGuardado, onCancelar, onRecargar,
  plantilla = null, codigoInicial = null, onDuplicar, nombreInicial = null, desdeRecepcion = false,
}: Props) {
  // Lo que llena el formulario: el producto que se edita, o el que se duplica.
  const origen = producto ?? plantilla;
  const esEdicion = producto !== null;
  // Bodega edita productos "sin tocar precio de venta" (matriz del doc 02).
  // Al crear sí lo pone: un producto sin precio no se puede vender.
  const precioBloqueado = esEdicion && !puedeEditarPrecios;
  const { fechaHora, zona } = useFormatoFecha();
  const hoy = diaLocal(new Date(), zona);
  const [vencimiento, setVencimiento] = useState('');
  const [historialPrecios, setHistorialPrecios] = useState<CambioPrecio[]>([]);
  const [conflicto, setConflicto] = useState(false);
  useEffect(() => {
    if (!producto) return;
    let vivo = true;
    void repoProductos().historialPrecios(producto.id).then((h) => { if (vivo) setHistorialPrecios(h); }).catch(() => {});
    return () => { vivo = false; };
  }, [producto]);

  const [nombre, setNombre] = useState(producto?.nombre ?? (plantilla ? `${plantilla.nombre} (copia)` : (nombreInicial ?? '')));
  // El SKU no se copia: es el código interno de UN producto.
  const [sku, setSku] = useState(producto?.sku ?? '');
  const [descripcion, setDescripcion] = useState(origen?.descripcion ?? '');
  const [categoriaId, setCategoriaId] = useState(origen?.categoriaId ?? '');
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  // 0032 · Todo se vende y se cuenta por unidad: no hay kg, litro ni ml.
  const unidad = 'unidad';
  const { ivaPct } = useConfiguracion();
  const [precio, setPrecio] = useState(origen ? String(origen.precioVenta) : '');
  const [costo, setCosto] = useState(origen?.costoPromedio ? String(origen.costoPromedio) : '');
  const [stockMinimo, setStockMinimo] = useState(String(origen?.stockMinimo ?? 0));
  const [stockSala, setStockSala] = useState('0');
  // Respuesta 8 del cuestionario: «todos tienen fecha de vencimiento». Un
  // producto nuevo nace perecible; quien crea uno que no vence lo desmarca.
  const [perecible, setPerecible] = useState(origen?.perecible ?? true);
  // Los días de aviso ya no se preguntan: se cuentan desde la fecha de
  // vencimiento. El producto conserva los que tenía (30 por omisión).
  const diasAlerta = String(origen?.diasAlerta ?? 30);
  // Los códigos de barra no se copian: cada uno es de un solo producto.
  const [codigos, setCodigos] = useState<string[]>(producto?.codigos ?? (codigoInicial ? [codigoInicial] : []));
  const [codigoNuevo, setCodigoNuevo] = useState('');

  // Ofertas e impuesto (0018). Se cargan aparte porque no son del producto.
  const [filasOferta, setFilasOferta] = useState<FilaOferta[]>([]);
  const [impuestoId, setImpuestoId] = useState<string | null>(null);
  const [preciosIniciales, setPreciosIniciales] = useState<string>('');
  const [impuestos, setImpuestos] = useState<ImpuestoAdicional[]>([]);

  useEffect(() => {
    if (!puedeEditarPrecios) return;
    let vivo = true;
    void (async () => {
      try {
        const lista = await repoPrecios().impuestos();
        if (vivo) setImpuestos(lista);
        if (producto) {
          const p = await repoPrecios().preciosDe(producto.id);
          if (!vivo) return;
          setFilasOferta(filasDesdeTramos(p.tramos));
          setImpuestoId(p.impuestoId);
          setPreciosIniciales(JSON.stringify(p));
        }
      } catch (e) {
        if (vivo) setError(toUserMessage(e));
      }
    })();
    return () => { vivo = false; };
  }, [producto, puedeEditarPrecios]);

  const [escaneando, setEscaneando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // El producto nuevo que ya se creó en un intento anterior. Si después
  // fallaban las ofertas o el impuesto, el error decía "quedó guardado" pero el
  // formulario seguía en "Crear producto": tocarlo otra vez creaba un segundo
  // producto igual (y otra categoría nueva igual).
  const [creadoId, setCreadoId] = useState<string | null>(null);
  // Si la edición se guardó y fallaron las ofertas o el impuesto, el producto
  // ya tiene otra fecha de modificación (la nuestra): al tocar "Guardar" de
  // nuevo, la base decía "lo cambió <tu propio nombre> mientras editabas".
  const [yaEditado, setYaEditado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoCodigo, setAvisoCodigo] = useState<string | null>(null);
  // Otro producto que ya se llama igual: el catálogo se llenaba de "Arroz"
  // repetidos, uno con stock y otro sin código, y al vender se elegía mal.
  const [parecido, setParecido] = useState<string | null>(null);

  async function revisarNombre() {
    const n = nombre.trim();
    setParecido(null);
    if (n.length < 3 || (n.toLowerCase() === producto?.nombre.toLowerCase())) return;
    try {
      const iguales = (await repoProductos().listar({ busqueda: n, soloActivos: false, limite: 20 }, false))
        .filter((x) => x.id !== producto?.id && x.nombre.trim().toLowerCase() === n.toLowerCase());
      if (iguales.length) {
        setParecido(`Ya hay un producto llamado "${iguales[0].nombre}"${iguales[0].activo ? '' : ' (desactivado)'}. Si es el mismo, cancela y edita ese.`);
      }
    } catch { /* es solo un aviso */ }
  }

  const { videoRef, start, stop, error: errorCamara } = useScanner({
    enabled: escaneando,
    onScan: (code) => { void agregarCodigo(code); setEscaneando(false); },
  });

  useEffect(() => {
    if (escaneando) void start();
    else stop();
  }, [escaneando, start, stop]);

  // Precio y costo son dinero; el resto son cantidades. La distinción no es
  // cosmética: `parseCLP` borra todo lo que no sea dígito, así que un stock
  // mínimo de "1.5" kg se convertía en 15. Ver docs/21.
  const vPrecio = validarMonto(precio, { etiqueta: 'precio de venta', permiteCero: false, maximo: 50_000_000 });
  const vCosto = validarMonto(costo, { etiqueta: 'costo', permiteVacio: true, maximo: 50_000_000 });
  // Entero, como todo desde 0032: "2,5" de mínimo no significa nada en unidades.
  const vStockMinimo = validarCantidadStock(stockMinimo, unidad, { permiteVacio: true, maximo: 1_000_000 });
  const vStockSala = validarCantidadStock(stockSala, unidad, { permiteVacio: true, maximo: 1_000_000 });
  const vDiasAlerta = validarCantidad(diasAlerta, { permiteVacio: true, maximo: 3650 });

  const precioNum = vPrecio.valor;
  const costoNum = vCosto.valor;
  // El costo es neto (sin IVA) y el precio lo trae incluido: el margen se
  // calcula contra el precio sin IVA (docs/26 N° 13).
  const margen = precioNum > 0 && costoNum > 0 ? margenNetoPct(precioNum, costoNum, ivaPct) : null;
  // Cuántos días le quedan a lo que se carga: se calcula de la fecha, no se
  // pregunta (Felipe, 2026-10-01).
  const diasParaVencer = vencimiento ? diasEntre(hoy, vencimiento) : null;
  const pideVencimiento = !esEdicion && !desdeRecepcion && perecible && vStockSala.valor > 0;

  async function agregarCodigo(bruto: string) {
    const code = normalizeBarcode(bruto.trim());
    if (!code) return;
    setAvisoCodigo(null);

    if (codigos.includes(code)) {
      setAvisoCodigo('Ese código ya está en la lista');
      return;
    }
    // Verificación contra el catálogo: RF-M2-03
    const dueño = await repoProductos().codigoEnUso(code, producto?.id);
    if (dueño) {
      setAvisoCodigo(`Ese código ya pertenece a "${dueño}"`);
      return;
    }
    if (/^\d+$/.test(code) && [8, 12, 13].includes(code.length) && !isValidEan(code)) {
      setAvisoCodigo('Aviso: el dígito de control no cuadra. Verifica que esté bien copiado');
    }
    setCodigos((prev) => [...prev, code]);
    setCodigoNuevo('');
  }

  async function guardar() {
    setError(null);
    setConflicto(false);

    if (nombre.trim() === '') { setError('El nombre es obligatorio'); return; }
    for (const v of [vPrecio, vCosto, vStockMinimo, vStockSala, vDiasAlerta]) {
      if (!v.valido) { setError(v.error); return; }
    }
    // Un perecible con stock sin fecha quedaba "sin lote": fuera de las
    // alertas y del FEFO. Antes era solo un aviso.
    if (pideVencimiento && !vencimiento) {
      setError('Falta la fecha de vencimiento: es perecible y estás cargando stock');
      return;
    }
    // Las ofertas se revisan ANTES de guardar el producto: si no, quedaría
    // guardado a medias y con un error sobre algo que ya no se ve.
    const ofertas = puedeEditarPrecios ? tramosDesdeFilas(filasOferta, precioNum) : { tramos: [], error: null };
    if (ofertas.error) { setError(ofertas.error); return; }

    // Un código escrito y sin tocar "Agregar" se perdía en silencio al guardar:
    // el producto quedaba sin código y el lector no lo encontraba en la caja.
    let codigosFinales = codigos;
    const pendiente = normalizeBarcode(codigoNuevo.trim());
    if (pendiente && !codigos.includes(pendiente)) {
      const dueño = await repoProductos().codigoEnUso(pendiente, producto?.id).catch(() => null);
      if (dueño) {
        setError(`El código ${pendiente} que quedó escrito ya pertenece a "${dueño}". Bórralo o corrígelo.`);
        return;
      }
      codigosFinales = [...codigos, pendiente];
      setCodigos(codigosFinales);
      setCodigoNuevo('');
    }

    setGuardando(true);
    try {
      const repo = repoProductos();

      let catId: string | null = categoriaId || null;
      if (nuevaCategoria.trim()) {
        catId = (await repo.crearCategoria(nuevaCategoria.trim())).id;
        // Queda elegida: un reintento no la vuelve a crear.
        setCategoriaId(catId);
        setNuevaCategoria('');
      }

      const base = {
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || null,
        sku: sku.trim() || null,
        categoriaId: catId,
        unidad,
        precioVenta: precioNum,
        stockMinimo: vStockMinimo.valor,
        perecible,
        diasAlerta: vDiasAlerta.valor || 30,
        codigos: codigosFinales,
      };

      let idGuardado = producto?.id ?? null;
      if (esEdicion) {
        // El costo solo viaja si el usuario escribió algo. Con el campo en
        // blanco se mandaba 0, y `actualizar` lo escribe tal cual: editar el
        // nombre de un producto con el costo vacío le ponía el costo promedio
        // en cero, y con él el margen y el inventario valorizado.
        await repo.actualizar(producto.id, {
          ...base,
          esperadoEn: yaEditado ? null : producto.actualizadoEn,
          ...(puedeVerCostos && costo.trim() !== '' ? { costo: costoNum } : {}),
        });
        setYaEditado(true);
      } else if (creadoId) {
        idGuardado = creadoId;
      } else {
        idGuardado = (await repo.crear({
          ...base,
          costo: costoNum,
          // 0032 · Una sola bodega: todo entra al mismo lugar.
          stockInicialSala: vStockSala.valor,
          stockInicialBodega: 0,
          vencimientoInicial: perecible && vencimiento ? vencimiento : null,
        })).id;
        setCreadoId(idGuardado);
      }

      // Ofertas e impuesto: solo si cambiaron. Si fallan, el producto ya
      // quedó guardado, y el mensaje lo dice para que nadie lo cree dos veces.
      if (puedeEditarPrecios && idGuardado) {
        const ahora = { impuestoId, tramos: ofertas.tramos };
        const antes = preciosIniciales ? JSON.parse(preciosIniciales) : { impuestoId: null, tramos: [] };
        try {
          if (JSON.stringify(antes.tramos) !== JSON.stringify(ahora.tramos)) {
            await repoPrecios().guardarTramos(idGuardado, ahora.tramos);
          }
          if ((antes.impuestoId ?? null) !== impuestoId) {
            await repoPrecios().asignarImpuesto([idGuardado], impuestoId);
          }
        } catch (e) {
          setError(`El producto quedó guardado, pero no las ofertas o el impuesto: ${toUserMessage(e)}`);
          return;
        }
      }
      onGuardado({
        id: idGuardado!, nombre: base.nombre, nuevo: !esEdicion,
        sala: vStockSala.valor, bodega: 0, unidad, perecible,
      });
    } catch (e) {
      setConflicto(String((e as { message?: string })?.message ?? '').includes('PRODUCTO_CAMBIO_MIENTRAS_EDITABAS'));
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? 'Editar producto' : plantilla ? 'Nuevo producto (copia)' : 'Nuevo producto'}
      ancho="lg"
      encabezado="visible"
      onCerrar={onCancelar}
      bloqueado={guardando}
    >
      <>
          <div className="p-4 space-y-4">
            {plantilla && (
              <p className="text-sm bg-marca-50 text-marca-900 px-3 py-2 rounded-lg">
                Copia de <strong>{plantilla.nombre}</strong>: cambia lo que sea distinto (el nombre, el precio)
                y agrega su código de barras. El stock parte en lo que pongas abajo.
              </p>
            )}
            {desdeRecepcion && (
              <p className="text-sm bg-marca-50 text-marca-900 px-3 py-2 rounded-lg">
                Queda en el catálogo y se agrega a esta recepción. La cantidad, el costo
                y el vencimiento los anotas en su línea, como los demás.
              </p>
            )}
            {codigoInicial && !esEdicion && (
              <p className="text-sm bg-marca-50 text-marca-900 px-3 py-2 rounded-lg">
                El código <strong className="num">{codigoInicial}</strong> no estaba en el catálogo: ya quedó puesto abajo.
              </p>
            )}
            {/* Edición: cuánto hay y quién lo tocó. La cantidad no se cambia acá:
                cada cambio de stock queda en el kardex con su motivo. Antes el
                formulario no lo decía y no se entendía dónde se cambiaba. */}
            {esEdicion && producto && (
              <div className="rounded-xl bg-[var(--fondo)] p-3 space-y-2">
                <p className="text-sm">
                  <span className="text-[var(--texto-suave)]">Stock ahora: </span>
                  <strong className="num">{cantidadConUnidad(producto.stock, 'unidad')}</strong>
                  <span className="text-[var(--texto-suave)]"> en bodega</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/inventario?ajustar=${producto.id}`}
                        className="tap inline-flex items-center px-3 rounded-lg border border-[var(--borde)] bg-white text-sm font-medium">
                    Ajustar stock
                  </Link>
                  <Link href="/proveedores/recepcion"
                        className="tap inline-flex items-center px-3 rounded-lg border border-[var(--borde)] bg-white text-sm font-medium">
                    Ingresar mercadería
                  </Link>
                  {onDuplicar && (
                    <button type="button" onClick={() => onDuplicar(producto)}
                            className="tap inline-flex items-center gap-1.5 px-3 rounded-lg border border-[var(--borde)] bg-white text-sm font-medium">
                      <Icono nombre="copiar" tamano={16} /> Duplicar
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--texto-suave)]">
                  Última modificación: {producto.actualizadoPor ?? 'sin registro'} · {fechaHora(producto.actualizadoEn)}
                </p>
              </div>
            )}
            <Campo etiqueta="Nombre" obligatorio>
              {(p) => (
                <input
                  {...p}
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  onBlur={() => void revisarNombre()}
                  placeholder="Ej: Arroz grado 1 · 1 kg"
                  className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
                  autoFocus
                />
              )}
            </Campo>

            {parecido && (
              <p role="status" className="-mt-2 text-xs text-[var(--color-aviso)] bg-amber-50 px-3 py-2 rounded-lg">⚠ {parecido}</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              {/* El error se muestra apenas el campo tiene algo escrito: esperar
                  a "Guardar" obliga a recorrer el formulario hacia atrás. */}
              <Campo
                etiqueta="Precio de venta" obligatorio
                ayuda={precioBloqueado ? 'Lo cambia el administrador o un supervisor' : undefined}
                error={precio !== '' ? vPrecio.error : null}
              >
                {(p) => (
                  <input
                    {...p}
                    inputMode="numeric" value={precio}
                    onChange={(e) => setPrecio(e.target.value)}
                    onBlur={() => { if (vPrecio.valido && vPrecio.valor > 0) setPrecio(vPrecio.valor.toLocaleString('es-CL')); }}
                    readOnly={precioBloqueado}
                    placeholder="0"
                    className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num text-right read-only:bg-[var(--fondo)]"
                  />
                )}
              </Campo>

              {puedeVerCostos && !desdeRecepcion && (
                <Campo etiqueta="Costo neto" ayuda="Sin IVA, como en la factura del proveedor"
                       error={costo !== '' ? vCosto.error : null}>
                  {(p) => (
                    <input
                      {...p}
                      inputMode="numeric" value={costo}
                      onChange={(e) => setCosto(e.target.value)}
                      placeholder="0"
                      className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num text-right"
                    />
                  )}
                </Campo>
              )}
            </div>

            {/* RF-M2-21 · un precio que no termina en 0 obliga a redondear en efectivo. */}
            {vPrecio.valido && precioConRedondeo(precioNum) && (
              <p className="-mt-2 text-xs text-[var(--color-aviso)]">
                No termina en 0: al pagar en efectivo habrá que redondear (Ley 20.956).
              </p>
            )}

            {margen !== null && (
              <p className={`text-sm px-3 py-2 rounded-lg ${
                margen < 0 ? 'bg-red-50 text-red-900' : 'bg-marca-50 text-marca-900'
              }`}>
                Margen sin IVA: <strong className="num">{formatCLP(margenNeto(precioNum, costoNum, ivaPct))}</strong>
                {' '}({formatPct(margen)})
                {margen < 0 && ' · estás vendiendo bajo el costo'}
              </p>
            )}

            {/* Perecible: activa el control por lote y FEFO (ADR-007). Va antes
                de la cantidad: si es perecible, la fecha se pide junto a ella. */}
            <div className="rounded-xl border border-[var(--borde)] p-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox" checked={perecible}
                  onChange={(e) => setPerecible(e.target.checked)}
                  className="mt-0.5 w-5 h-5 accent-[var(--color-marca-500)]"
                />
                <span className="text-sm">
                  <strong className="block">Producto perecible</strong>
                  <span className="text-[var(--texto-suave)]">
                    Lleva fecha de vencimiento. El sistema cuenta los días que le quedan
                    y al vender sale primero lo que vence antes.
                  </span>
                </span>
              </label>
            </div>

            {/* 0032 · Una sola bodega: antes eran dos casillas, sala y bodega, y
                había que acordarse de "reponer". */}
            {!esEdicion && !desdeRecepcion && (
              <div className="rounded-xl border border-[var(--borde)] p-3 space-y-3">
                <Campo
                  etiqueta="¿Cuántos tienes hoy en la bodega?"
                  ayuda="En unidades. Puede quedar en 0 y entrar después con Recibir mercadería."
                  error={stockSala !== '' ? vStockSala.error : null}
                >
                  {(p) => (
                    <input
                      {...p}
                      inputMode="numeric" value={stockSala}
                      onChange={(e) => setStockSala(e.target.value)}
                      className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num text-right"
                    />
                  )}
                </Campo>
                {pideVencimiento && (
                  <div>
                    <Campo etiqueta="¿Cuándo vence?" obligatorio
                           ayuda="Si hay fechas distintas, pon la más próxima.">
                      {(p) => (
                        <input
                          {...p}
                          type="date" value={vencimiento} min={hoy}
                          onChange={(e) => setVencimiento(e.target.value)}
                          className={`tap w-full px-3 py-2.5 rounded-xl border bg-white ${vencimiento ? 'border-[var(--borde)]' : 'border-[var(--color-alerta)]'}`}
                        />
                      )}
                    </Campo>
                    <p role="status" className={`text-xs mt-1 ${diasParaVencer === null ? 'text-[var(--color-alerta)]' : 'text-[var(--texto-suave)]'}`}>
                      {diasParaVencer === null
                        ? 'Falta la fecha: sin ella no se puede guardar.'
                        : `Desde hoy, ${textoVencimiento(diasParaVencer)}.`}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Códigos de barras: RF-M2-02 permite varios por producto */}
            <Campo etiqueta="Códigos de barras">
              {(p) => (
                <>
              {codigos.length > 0 && (
                <ul className="flex flex-wrap gap-2 mb-2">
                  {codigos.map((c) => (
                    <li key={c} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--fondo)] text-sm num">
                      {c}
                      <button
                        onClick={() => setCodigos((p) => p.filter((x) => x !== c))}
                        aria-label={`Quitar código ${c}`}
                        className="tap -my-1.5 -mr-1.5 text-[var(--color-alerta)] font-bold"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <input
                  {...p}
                  inputMode="numeric" value={codigoNuevo}
                  onChange={(e) => setCodigoNuevo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregarCodigo(codigoNuevo); } }}
                  placeholder="Escribe o escanea"
                  className="tap flex-1 px-3 py-2.5 rounded-xl border border-[var(--borde)] num"
                />
                <button
                  onClick={() => void agregarCodigo(codigoNuevo)}
                  className="tap px-4 rounded-xl border border-[var(--borde)] text-sm font-medium"
                >
                  Agregar
                </button>
                <button
                  onClick={() => setEscaneando((v) => !v)}
                  aria-label="Escanear código con la cámara"
                  className="tap px-4 rounded-xl bg-marca-500 text-white"
                >
                  <Icono nombre="escanear" tamano={20} />
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
              {avisoCodigo && (
                <p role="status" className={`text-xs mt-1.5 ${
                  avisoCodigo.startsWith('Aviso') ? 'text-[var(--color-aviso)]' : 'text-[var(--color-alerta)]'
                }`}>
                  {avisoCodigo}
                </p>
              )}
                </>
              )}
            </Campo>

            {/* Lo opcional, plegado: en el celular el formulario era tan largo que
                "¿Cuántos tienes hoy?" quedaba al fondo y nadie lo encontraba. */}
            <details className="rounded-xl border border-[var(--borde)] p-3" open={esEdicion && Boolean(descripcion || sku || categoriaId)}>
              <summary className="text-sm font-semibold cursor-pointer min-h-[44px] py-2.5 -my-2.5">
                Más datos (opcional): descripción, categoría, stock mínimo
              </summary>
              <div className="mt-3 space-y-4">
                <Campo
                  etiqueta="Descripción"
                  ayuda="Qué es, en palabras. Aparece al escanear el producto en la caja."
                >
                  {(p) => (
                    <input
                      {...p}
                      value={descripcion}
                      onChange={(e) => setDescripcion(e.target.value)}
                      placeholder="Ej: Arroz grado 1, bolsa de 1 kilo"
                      className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
                    />
                  )}
                </Campo>

                <Campo etiqueta="SKU / código interno" ayuda="Opcional: un código tuyo, si usas uno.">
                  {(p) => (
                    <input
                      {...p}
                      value={sku} onChange={(e) => setSku(e.target.value)}
                      placeholder="Opcional"
                      className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
                    />
                  )}
                </Campo>
                <Campo etiqueta="Categoría">
                  {(p) => (
                    <>
                      <select
                        {...p}
                        value={categoriaId}
                        onChange={(e) => { setCategoriaId(e.target.value); setNuevaCategoria(''); }}
                        className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white"
                      >
                        <option value="">Sin categoría</option>
                        {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                      <input
                        value={nuevaCategoria}
                        onChange={(e) => { setNuevaCategoria(e.target.value); setCategoriaId(''); }}
                        aria-label="Nombre de una categoría nueva"
                        placeholder="…o escribe una categoría nueva"
                        className="tap w-full mt-2 px-3 py-2.5 rounded-xl border border-dashed border-[var(--borde)] text-sm"
                      />
                    </>
                  )}
                </Campo>

                <div className="grid grid-cols-2 gap-3">
                  <Campo
                    etiqueta="Stock mínimo"
                    ayuda="Con menos que esto, avisa que hay que reponer"
                    error={stockMinimo !== '' ? vStockMinimo.error : null}
                  >
                    {(p) => (
                      <input
                        {...p}
                        inputMode="numeric" value={stockMinimo}
                        onChange={(e) => setStockMinimo(e.target.value)}
                        className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num text-right"
                      />
                    )}
                  </Campo>
                </div>

              </div>
            </details>
            {esEdicion && historialPrecios.length > 0 && (
              <details className="rounded-xl border border-[var(--borde)] p-3">
                <summary className="text-sm font-semibold cursor-pointer min-h-[44px] py-2.5 -my-2.5">
                  Historial de precios ({historialPrecios.length})
                </summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {historialPrecios.map((h) => (
                    <li key={h.fecha} className="flex justify-between gap-2">
                      <span className="text-[var(--texto-suave)]">{fechaHora(h.fecha)}{h.quien ? ` · ${h.quien}` : ''}</span>
                      <span className="num whitespace-nowrap">{formatCLP(h.anterior)} → <strong>{formatCLP(h.nuevo)}</strong></span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {puedeEditarPrecios && (
              <details className="rounded-xl border border-[var(--borde)] p-3" open={filasOferta.length > 0 || impuestoId != null}>
                <summary className="text-sm font-semibold cursor-pointer min-h-[44px] py-2.5 -my-2.5">
                  Precio por mayor, ofertas e impuesto (opcional)
                </summary>
                <div className="mt-3 space-y-4">
                  <OfertasEImpuesto
                    filas={filasOferta}
                    onFilas={setFilasOferta}
                    precioLista={precioNum}
                    impuestos={impuestos}
                    impuestoId={impuestoId}
                    onImpuesto={setImpuestoId}
                    esAdmin={esAdmin}
                  />
                </div>
              </details>
            )}

            {error && (
              <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}
            {conflicto && onRecargar && (
              <button onClick={onRecargar}
                      className="tap w-full rounded-xl border border-[var(--borde)] text-sm font-medium">
                Recargar el producto (se pierden tus cambios sin guardar)
              </button>
            )}
          </div>

          <footer
            className="sticky bottom-0 bg-white border-t border-[var(--borde)] p-4 flex gap-2"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            {/* Mientras guarda no se cancela: cerrar a medias no cancela nada en
                la base, solo esconde si quedó guardado o no. */}
            <button
              onClick={onCancelar}
              disabled={guardando}
              className="tap px-4 py-3 rounded-xl border border-[var(--borde)] font-medium disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => void guardar()}
              disabled={guardando}
              className="tap flex-1 py-3 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : desdeRecepcion ? 'Crear y agregar' : 'Crear producto'}
            </button>
          </footer>
      </>
    </Modal>
  );
}
