'use client';
import { Icono } from '@/components/Icono';
import { Encabezado } from '@/components/Encabezado';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatCLP, weightedAverageCost, costVariationPct, netAmount, ivaDeNeto,
  shouldWarnCostVariation, toUserMessage, diaLocal, sumarDias, diasEntre, textoVencimiento, formatPct, formatCantidad, validarCantidadStock, validarMonto
} from '@rutaahorro/core';
import { registrarFacturaProveedor, pagarFacturaProveedor } from '@/lib/datos/porPagar';
import { repoFacturacion } from '@/lib/datos/facturacion';
import { miCajaAbierta } from '@/lib/datos/cajaAbierta';
import {
  repoProveedores, buscarParaRecepcion, productoParaRecepcion,
  type Proveedor, type LineaRecepcion,
} from '@/lib/datos/proveedores';
import { findByBarcode } from '@/lib/offline/catalog';
import { useScanner } from '@/lib/scanner/useScanner';
import { configuracionLocal, CONFIGURACION_POR_OMISION, useConfiguracion } from '@/lib/datos/configuracion';
import { repoProductos, type Categoria } from '@/lib/productos';
import { FormularioProducto } from '../../productos/FormularioProducto';
import { FormProveedor } from '../FormProveedor';

const TIPOS = [
  { id: 'guia', label: 'Guía de despacho' },
  { id: 'factura', label: 'Factura' },
  { id: 'boleta', label: 'Boleta' },
  { id: 'sin_documento', label: 'Sin documento' },
];

/**
 * La recepción a medio cargar queda en la pestaña (sessionStorage), con dueño.
 * Veinte líneas con costos y vencimientos se perdían enteras al salir a
 * Productos a crear el que faltaba, o al tocar otra sección por error.
 */
const CLAVE_BORRADOR = 'recepcion:borrador';

interface Borrador {
  usuario: string;
  proveedorId: string;
  tipoDoc: string;
  documento: string;
  /** El vencimiento de la factura por pagar (antes se perdía al volver). */
  vence?: string;
  pago?: Pago;
  costosConIva?: boolean;
  totalDoc?: string;
  lineas: LineaRecepcion[];
}

/**
 * Cómo se le paga al proveedor. Antes solo existía "a crédito": si se pagaba
 * con la plata del cajón, la caja no se enteraba y el arqueo salía con
 * faltante.
 */
type Pago = 'transferencia' | 'efectivo_caja' | 'credito';

function leerBorrador(usuario: string): Borrador | null {
  try {
    const b = JSON.parse(sessionStorage.getItem(CLAVE_BORRADOR) ?? 'null') as Borrador | null;
    return b && b.usuario === usuario && Array.isArray(b.lineas) ? b : null;
  } catch {
    return null;
  }
}

function guardarBorrador(b: Borrador | null) {
  try {
    if (!b || b.lineas.length === 0) sessionStorage.removeItem(CLAVE_BORRADOR);
    else sessionStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b));
  } catch { /* sin almacenamiento, vive solo en memoria como antes */ }
}

export function RecepcionClient({ usuarioId = '', puedePagar = false }: {
  usuarioId?: string;
  /** Admin y supervisor: pagar con la caja y anotar en el libro de compras. */
  puedePagar?: boolean;
}) {
  const router = useRouter();
  // El día del local, no el de UTC: con toISOString, después de las 20:00 o
  // 21:00 "hoy" ya era mañana y no se podía elegir un vencimiento de hoy.
  const { zonaHoraria, ivaPct } = useConfiguracion();
  const hoy = () => diaLocal(new Date(), zonaHoraria);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  // El umbral de aviso de variación de costo lo fija el local (RF-M9-08). El
  // 20 % que traía shouldWarnCostVariation por omisión era el único que se
  // aplicaba, aunque tenants.settings dijera otra cosa.
  const [umbralVariacion, setUmbralVariacion] = useState(CONFIGURACION_POR_OMISION.variacionCostoPct);
  const [proveedorId, setProveedorId] = useState('');
  const [tipoDoc, setTipoDoc] = useState('guia');
  const [documento, setDocumento] = useState('');
  // RF-M3-13 · con factura a crédito, cuándo vence.
  const [vence, setVence] = useState('');
  const [pago, setPago] = useState<Pago>('transferencia');
  /**
   * Los costos se guardan NETOS (docs/26 N° 13, decidido el 2026-10-01). La
   * factura del proveedor trae el neto por línea; una boleta, el precio con
   * IVA. Se anota como viene en el papel y el sistema convierte.
   */
  const [costosConIva, setCostosConIva] = useState(false);
  // El total que dice el papel, para revisar que lo anotado cuadre.
  const [totalDoc, setTotalDoc] = useState('');

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
  // El costo como se escribió: con parseCLP "1990,5" se leía 19905 (regla 9),
  // y un costo 10 veces mayor arrastraba el costo promedio sin aviso.
  const [costoTexto, setCostoTexto] = useState<Record<string, string>>({});
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Awaited<ReturnType<typeof buscarParaRecepcion>>>([]);
  // El término de los resultados que se ven: mientras llega la respuesta de
  // otro, no se dice "no está en el catálogo" por algo que sí está.
  const [buscado, setBuscado] = useState('');
  // T-55 · lo que llegó en la factura y no está en el catálogo se crea acá
  // mismo. Antes había que salir a Productos y volver.
  const [codigoSinProducto, setCodigoSinProducto] = useState<string | null>(null);
  const [nuevoProducto, setNuevoProducto] = useState<{ nombre: string | null; codigo: string | null } | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Restaurar el borrador una vez, y guardar cada cambio desde entonces.
  const [restaurado, setRestaurado] = useState(false);
  useEffect(() => {
    const b = leerBorrador(usuarioId);
    if (b) {
      setProveedorId(b.proveedorId); setTipoDoc(b.tipoDoc); setDocumento(b.documento); setVence(b.vence ?? '');
      setPago(b.pago ?? (b.vence ? 'credito' : 'transferencia'));
      setCostosConIva(b.costosConIva ?? false); setTotalDoc(b.totalDoc ?? '');
      setLineas(b.lineas);
      setAviso(`Se recuperó la recepción que estabas cargando (${b.lineas.length} ${b.lineas.length === 1 ? 'producto' : 'productos'})`);
    }
    setRestaurado(true);
  }, [usuarioId]);
  useEffect(() => {
    if (restaurado) guardarBorrador({ usuario: usuarioId, proveedorId, tipoDoc, documento, vence, pago, costosConIva, totalDoc, lineas });
  }, [restaurado, usuarioId, proveedorId, tipoDoc, documento, vence, pago, costosConIva, totalDoc, lineas]);

  const agregar = useCallback((p: {
    productId: string; nombre: string; perecible: boolean;
    costoAnterior: number; stock: number; unidad?: string;
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
        unidad: p.unidad,
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
        setEscaneando(false);
        setCodigoSinProducto(code);
        return;
      }
      setCodigoSinProducto(null);
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

  useEffect(() => {
    void configuracionLocal().then((c) => setUmbralVariacion(c.variacionCostoPct));
  }, []);

  useEffect(() => { if (escaneando) void start(); else stop(); }, [escaneando, start, stop]);

  useEffect(() => {
    void repoProveedores().listar().then(setProveedores).catch(() => {});
  }, []);

  useEffect(() => {
    if (busqueda.trim().length < 2) { setResultados([]); setBuscado(''); return; }
    let vivo = true;
    void buscarParaRecepcion(busqueda).then((r) => { if (vivo) { setResultados(r); setBuscado(busqueda); } });
    return () => { vivo = false; };
  }, [busqueda]);

  function abrirNuevoProducto(datos: { nombre: string | null; codigo: string | null }) {
    setEscaneando(false);
    setNuevoProducto(datos);
    if (categorias.length === 0) void repoProductos().categorias().then(setCategorias).catch(() => {});
  }

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  function actualizar(id: string, cambios: Partial<LineaRecepcion>) {
    setLineas((prev) => prev.map((l) => (l.productId === id ? { ...l, ...cambios } : l)));
  }

  // Lo que se guarda es el costo neto; lo escrito puede venir con IVA.
  const netoDe = (costo: number) => (costosConIva ? netAmount(costo, ivaPct) : costo);
  const totalEscrito = lineas.reduce((s, l) => s + Math.round(l.cantidad * l.costoUnitario), 0);
  const totalNeto = lineas.reduce((s, l) => s + Math.round(l.cantidad * netoDe(l.costoUnitario)), 0);
  // Con costos con IVA, el IVA es lo que el papel trae de más; con costos
  // netos, el 19 % del neto, como lo calcula el SII en una factura (0027).
  const totalIva = costosConIva ? totalEscrito - totalNeto : ivaDeNeto(totalNeto, ivaPct);
  const totalConIva = totalNeto + totalIva;
  const total = totalConIva;

  // El total del papel contra lo anotado. Se tolera $1 por línea: el
  // redondeo de cada costo no tiene por qué coincidir con el del proveedor.
  const vTotalDoc = validarMonto(totalDoc, { etiqueta: 'total del documento', permiteVacio: true, maximo: 500_000_000 });
  const diferenciaDoc = totalDoc.trim() && vTotalDoc.valido ? vTotalDoc.valor - totalConIva : 0;
  const cuadraDoc = Math.abs(diferenciaDoc) <= Math.max(1, lineas.length);

  // Un perecible sin fecha no se puede recibir: sin ella no hay FEFO ni alerta
  const faltanVencimientos = lineas.filter((l) => l.perecible && !l.vencimiento);
  const puedeConfirmar =
    lineas.length > 0 &&
    lineas.every((l) => l.cantidad > 0 && l.costoUnitario >= 0) &&
    faltanVencimientos.length === 0;

  async function confirmar() {
    setError(null);
    // Antes se confirmaba y recién después decía que la factura no quedó por
    // pagar: con la mercadería ya ingresada, no había cómo corregirlo acá.
    if (pago === 'credito' && (!proveedorId || !documento.trim() || !vence)) {
      setError('Para dejar la factura por pagar: elige el proveedor, escribe el N° de la factura y cuándo vence.');
      return;
    }
    if (pago === 'efectivo_caja') {
      if (!proveedorId) { setError('Para pagar con la caja, elige el proveedor.'); return; }
      // Se mira antes de recibir: después, la mercadería ya entró y el pago
      // quedaría a medias.
      if (!(await miCajaAbierta().catch(() => null))) {
        setError('No tienes la caja abierta: ábrela en Caja, o elige otra forma de pago.');
        return;
      }
    }
    if (!vTotalDoc.valido) { setError(vTotalDoc.error); return; }
    if (totalDoc.trim() && !cuadraDoc && !window.confirm(
      `El documento dice ${formatCLP(vTotalDoc.valor)} y lo anotado suma ${formatCLP(totalConIva)} `
      + `(${diferenciaDoc > 0 ? 'faltan' : 'sobran'} ${formatCLP(Math.abs(diferenciaDoc))}). ¿Recibir igual?`)) {
      return;
    }
    setGuardando(true);
    try {
      const r = await repoProveedores().confirmarRecepcion({
        proveedorId: proveedorId || null,
        tipoDocumento: tipoDoc,
        documento: documento.trim() || null,
        lineas: lineas.map((l) => ({ ...l, costoUnitario: netoDe(l.costoUnitario) })),
      });
      guardarBorrador(null);
      // La mercadería ya entró: si algo de lo que sigue falla, no se reintenta
      // la recepción (la duplicaría). Se dice qué quedó pendiente y dónde
      // hacerlo a mano.
      const hecho: string[] = ['Mercadería recibida.'];
      const pendiente: string[] = [];
      // Lo que se le debe al proveedor es lo que dice el papel (con IVA). Antes
      // se anotaba la suma de los costos: la deuda quedaba un 19 % corta.
      const monto = totalDoc.trim() && vTotalDoc.valido ? vTotalDoc.valor : totalConIva;
      const numero = documento.trim() || `S/N ${r.id.slice(0, 8)}`;

      if (pago === 'credito') {
        try {
          await registrarFacturaProveedor({ receiptId: r.id, proveedorId, numero, monto, vence });
          hecho.push('La factura quedó en Por pagar con su vencimiento.');
        } catch (e) {
          pendiente.push(`La factura no quedó en Por pagar (${toUserMessage(e)}): regístrala en Compras → Por pagar.`);
        }
      } else if (pago === 'efectivo_caja') {
        let id: string | null = null;
        try {
          id = await registrarFacturaProveedor({ receiptId: r.id, proveedorId, numero, monto, vence: hoy() });
          await pagarFacturaProveedor(id, 'efectivo_caja');
          hecho.push(`Se registró la salida de ${formatCLP(monto)} de tu caja.`);
        } catch (e) {
          pendiente.push(id
            ? `El pago no salió de la caja (${toUserMessage(e)}): quedó en Compras → Por pagar para marcarlo pagado.`
            : `El pago no se registró (${toUserMessage(e)}): anótalo en Caja como egreso.`);
        }
      }

      // El libro de compras (IVA crédito del resumen mensual). Antes una
      // factura recibida acá había que anotarla otra vez en Facturación.
      if (tipoDoc === 'factura' && puedePagar) {
        const prov = proveedores.find((p) => p.id === proveedorId);
        // "12.345" (con punto de miles, como se lee en el papel) es un número:
        // antes no quedaba en el libro de compras por "no ser un número".
        const folio = Number(documento.trim().replace(/[.\s]/g, ''));
        if (!prov?.rut) {
          pendiente.push('No quedó en el libro de compras: el proveedor no tiene RUT. Agrégalo en Compras y regístrala en Facturación → Recibidas.');
        } else if (!Number.isInteger(folio) || folio <= 0) {
          pendiente.push('No quedó en el libro de compras: el N° de la factura no es un número. Regístrala en Facturación → Recibidas.');
        } else {
          try {
            await repoFacturacion().registrarRecibida({
              supplierId: prov.id, rutEmisor: prov.rut, razonSocial: prov.nombre, tipo: 33, folio,
              fechaEmision: hoy(), neto: totalNeto, exento: 0, iva: totalIva, otrosImpuestos: 0,
              notas: 'Desde Recibir mercadería', receiptId: r.id,
            });
            hecho.push('Quedó en el libro de compras.');
          } catch (e) {
            if (!/DUPLICAD/.test(String((e as { message?: string })?.message ?? e))) {
              pendiente.push(`No quedó en el libro de compras (${toUserMessage(e)}): regístrala en Facturación → Recibidas.`);
            }
          }
        }
      }

      const texto = [...hecho, ...pendiente].join(' ');
      router.push(`/proveedores?recibido=${r.id}&aviso=${pendiente.length ? 'recibida_pendiente' : 'recibida'}`
        + `&detalle=${encodeURIComponent(texto)}`);
      router.refresh();
    } catch (e) {
      setError(toUserMessage(e));
      setGuardando(false);
    }
  }

  return (
    <div className="px-4 py-5 pb-56 lg:pb-40">
      <Encabezado
        titulo="Recibir mercadería"
        volver={{ href: '/proveedores', texto: 'Compras' }}
        descripcion="Lo que llegó del proveedor: entra a la bodega, recalcula el costo y registra cómo se pagó. Los perecibles piden su vencimiento."
      />

      {/* Documento */}
      <section className="tarjeta p-4 mb-3 space-y-3">
        <div>
          <label htmlFor="prov" className="block text-sm font-medium mb-1.5">Proveedor</label>
          <div className="flex gap-2">
            <select
              id="prov" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
              className="tap flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white"
            >
              <option value="">Sin especificar</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <button type="button" onClick={() => setNuevoProveedor(true)} className="btn btn-secundario shrink-0">
              + Nuevo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tipo" className="block text-sm font-medium mb-1.5">Documento</label>
            <select
              id="tipo" value={tipoDoc} onChange={(e) => {
                const t = e.target.value;
                setTipoDoc(t);
                // La boleta trae precios con IVA; la factura, netos.
                if (t === 'boleta') setCostosConIva(true);
                if (t === 'factura') setCostosConIva(false);
                if (t !== 'factura' && pago === 'credito') setPago('transferencia');
              }}
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

        {/* Cómo se paga. "Efectivo de la caja" deja el egreso en la caja abierta
            (antes el arqueo salía con faltante); "A crédito" queda en Por pagar. */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1.5">¿Cómo se paga?</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup">
            {([
              ['transferencia', 'Transferencia u otro', 'Ya se pagó, sin tocar la caja'],
              ['efectivo_caja', 'Efectivo de la caja', puedePagar ? 'Sale de tu caja abierta' : 'Lo registra un supervisor'],
              ['credito', 'A crédito', tipoDoc === 'factura' ? 'Queda en Por pagar' : 'Solo con factura'],
            ] as const).map(([id, titulo, ayuda]) => {
              const deshabilitado = (id === 'efectivo_caja' && !puedePagar) || (id === 'credito' && tipoDoc !== 'factura');
              return (
                <button key={id} type="button" role="radio" aria-checked={pago === id} disabled={deshabilitado}
                        onClick={() => setPago(id)}
                        className={`tap px-3 py-2 rounded-xl border text-left disabled:opacity-50 ${
                          pago === id ? 'border-marca-500 bg-marca-50' : 'border-[var(--borde)] bg-white'}`}>
                  <span className="block text-sm font-medium">{titulo}</span>
                  <span className="block text-xs text-[var(--texto-suave)]">{ayuda}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* RF-M3-13 · Factura a crédito: queda en Compras → Por pagar. */}
        {pago === 'credito' && (
          <div>
            <label htmlFor="vence" className="block text-sm font-medium mb-1.5">Vence el</label>
            <div className="flex flex-wrap gap-2 items-center">
              <input id="vence" type="date" value={vence} min={hoy()} onChange={(e) => setVence(e.target.value)}
                     className="tap px-3 py-2 rounded-xl border border-[var(--borde)]" />
              {[30, 60].map((d) => (
                <button key={d} type="button" onClick={() => setVence(sumarDias(hoy(), d))} className="btn btn-secundario btn-chico">
                  {d} días
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--texto-suave)] mt-1">El Inicio avisa una semana antes de que venza.</p>
          </div>
        )}

        {/* Neto o con IVA: el costo se guarda neto (docs/26 N° 13). */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1.5">Los costos que vas a anotar son</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {([[false, 'Netos (sin IVA)', 'Como en la factura'], [true, 'Con IVA', 'Como en una boleta']] as const).map(([conIva, titulo, ayuda]) => (
              <button key={titulo} type="button" role="radio" aria-checked={costosConIva === conIva}
                      onClick={() => setCostosConIva(conIva)}
                      className={`tap px-3 py-2 rounded-xl border text-left ${
                        costosConIva === conIva ? 'border-marca-500 bg-marca-50' : 'border-[var(--borde)] bg-white'}`}>
                <span className="block text-sm font-medium">{titulo}</span>
                <span className="block text-xs text-[var(--texto-suave)]">{ayuda}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {tipoDoc !== 'sin_documento' && (
          <div>
            <label htmlFor="total-doc" className="block text-sm font-medium mb-1.5">Total del documento, con IVA (opcional)</label>
            <input id="total-doc" inputMode="numeric" value={totalDoc} onChange={(e) => setTotalDoc(e.target.value)}
                   placeholder="Para revisar que lo anotado cuadre"
                   className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num text-right" />
            {totalDoc.trim() !== '' && (
              !vTotalDoc.valido
                ? <p role="alert" className="text-xs text-[var(--color-alerta)] mt-1">{vTotalDoc.error}</p>
                : lineas.length === 0
                  ? null
                  : cuadraDoc
                    ? <p role="status" className="text-xs text-marca-700 mt-1">✓ Cuadra con lo anotado</p>
                    : <p role="status" className="text-xs text-[var(--color-aviso)] bg-amber-50 px-2.5 py-1.5 rounded-lg mt-1">
                        ⚠ No cuadra: lo anotado suma {formatCLP(totalConIva)}, {diferenciaDoc > 0 ? 'faltan' : 'sobran'} {formatCLP(Math.abs(diferenciaDoc))}.
                        Revisa cantidades y costos.
                      </p>
            )}
          </div>
        )}
      </section>

      {/* Agregar productos */}
      <section className="tarjeta p-4 mb-3">
        <h2 className="font-semibold text-sm mb-2">Agregar productos</h2>

        <div className="flex gap-2">
          <input
            type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o SKU…"
            aria-label="Buscar producto por nombre o SKU"
            className="tap flex-1 px-3 py-2.5 rounded-xl border border-[var(--borde)]"
          />
          <button
            onClick={() => setEscaneando((v) => !v)}
            aria-label="Escanear producto"
            className={`tap px-4 rounded-xl font-medium ${
              escaneando ? 'border border-[var(--borde)]' : 'bg-marca-500 text-white'
            }`}
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

        {codigoSinProducto && (
          <div role="status" className="mt-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm">
            <p>El código <strong className="num">{codigoSinProducto}</strong> no está en el catálogo.</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <button type="button" className="btn btn-primario btn-chico"
                      onClick={() => abrirNuevoProducto({ nombre: null, codigo: codigoSinProducto })}>
                Crear producto con este código
              </button>
              <button type="button" className="btn btn-secundario btn-chico" onClick={() => setCodigoSinProducto(null)}>
                Descartar
              </button>
            </div>
          </div>
        )}

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
                      stock {formatCantidad(r.stock)}{r.perecible && ' · perecible'}
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

        {/* Con resultados también: "jalea" puede traer la jalea sin azúcar y
            la que llegó es otra. */}
        {buscado && buscado === busqueda && (
          <div className="mt-2">
            {resultados.length === 0 && (
              <p className="text-sm text-[var(--texto-suave)] mb-1.5">«{busqueda.trim()}» no está en el catálogo.</p>
            )}
            <button type="button" className="btn btn-secundario btn-chico"
                    onClick={() => abrirNuevoProducto({ nombre: busqueda.trim(), codigo: null })}>
              + Crear «{busqueda.trim()}» como producto nuevo
            </button>
          </div>
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
              incomingQty: l.cantidad, incomingUnitCost: netoDe(l.costoUnitario),
            });
            // El costo anterior es neto: se compara con el neto de lo que llega.
            const variacion = costVariationPct(l.costoAnterior, netoDe(l.costoUnitario));
            const alerta = shouldWarnCostVariation(l.costoAnterior, netoDe(l.costoUnitario), umbralVariacion);

            return (
              <li key={l.productId} className="tarjeta p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-medium min-w-0 truncate">{l.nombre}</p>
                  <button
                    onClick={() => {
                      // El texto escrito se olvida con la línea: al volver a
                      // agregarla mostraba la cantidad vieja pero contaba 1.
                      setLineas((p) => p.filter((x) => x.productId !== l.productId));
                      setCantidadTexto(({ [l.productId]: _c, ...resto }) => resto);
                      setCostoTexto(({ [l.productId]: _k, ...resto }) => resto);
                    }}
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
                      inputMode="numeric"
                      aria-label={`Cantidad recibida de ${l.nombre}`}
                      value={cantidadTexto[l.productId] ?? String(l.cantidad)}
                      onChange={(e) => {
                        const texto = e.target.value;
                        setCantidadTexto((p) => ({ ...p, [l.productId]: texto }));
                        const v = validarCantidadStock(texto, l.unidad, { permiteVacio: true, maximo: 1_000_000 });
                        actualizar(l.productId, { cantidad: v.valido ? v.valor : 0 });
                      }}
                      className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] num text-right"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] text-[var(--texto-suave)] mb-1" aria-hidden>Costo unitario {costosConIva ? 'con IVA' : 'neto'}</span>
                    <input
                      inputMode="numeric"
                      aria-label={`Costo unitario de ${l.nombre}`}
                      value={costoTexto[l.productId] ?? String(l.costoUnitario)}
                      onChange={(e) => {
                        const texto = e.target.value;
                        setCostoTexto((p) => ({ ...p, [l.productId]: texto }));
                        const v = validarMonto(texto, { etiqueta: 'costo', maximo: 50_000_000 });
                        // Inválido queda en −1: no se puede confirmar y se dice por qué.
                        actualizar(l.productId, { costoUnitario: v.valido ? v.valor : -1 });
                      }}
                      className={`tap w-full px-3 py-2 rounded-lg border num text-right ${
                        l.costoUnitario === 0 ? 'border-[var(--color-aviso)]' : 'border-[var(--borde)]'
                      }`}
                    />
                  </div>
                </div>

                {(() => {
                  const vc = validarCantidadStock(cantidadTexto[l.productId] ?? String(l.cantidad), l.unidad, { maximo: 1_000_000 });
                  const vm = validarMonto(costoTexto[l.productId] ?? String(l.costoUnitario), { etiqueta: 'costo', maximo: 50_000_000 });
                  const msg = !vc.valido ? `Cantidad: ${vc.error}` : vc.valor <= 0 ? 'La cantidad tiene que ser mayor que cero' : !vm.valido ? vm.error : null;
                  return msg ? <p role="alert" className="text-xs text-[var(--color-alerta)] mt-2">{msg}</p> : null;
                })()}

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
                    ⚠ El costo cambió {variacion > 0 ? '+' : ''}{formatPct(variacion)} respecto de{' '}
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
                      {/* Los días se cuentan desde hoy, que es cuando llega. */}
                      {l.vencimiento && (
                        <span className="block text-[11px] text-[var(--texto-suave)] mt-1">
                          {textoVencimiento(diasEntre(hoy(), l.vencimiento))}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <p className="text-xs text-[var(--texto-suave)] num mt-2 text-right">
                  Subtotal {formatCLP(Math.round(l.cantidad * l.costoUnitario))}{costosConIva && ' con IVA'}
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
        // Sobre la barra de navegación del celular (60 px, lg:hidden), no
        // debajo: antes era bottom-0 y la barra (z-40) tapaba "Confirmar
        // recepción". Igual que Nueva factura y Ofertas.
        <div data-acciones className="fixed inset-x-0 lg:left-60 bottom-[calc(60px+env(safe-area-inset-bottom))] lg:bottom-0 bg-white border-t border-[var(--borde)] px-4 py-3 z-30">
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
                <button type="button" onClick={() => { if (window.confirm('¿Quitar todos los productos de esta recepción?')) { setLineas([]); setCantidadTexto({}); setCostoTexto({}); } }}
                  className="tap ml-2 px-2 text-xs underline">Vaciar</button>
              </span>
              <span className="num text-right">
                <span className="block text-xl font-bold">{formatCLP(total)}</span>
                <span className="block text-[11px] text-[var(--texto-suave)]">neto {formatCLP(totalNeto)} + IVA {formatCLP(totalIva)}</span>
              </span>
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

      {nuevoProducto && (
        <FormularioProducto
          producto={null}
          categorias={categorias}
          puedeVerCostos={false}
          desdeRecepcion
          nombreInicial={nuevoProducto.nombre}
          codigoInicial={nuevoProducto.codigo}
          onCancelar={() => setNuevoProducto(null)}
          onGuardado={(p) => {
            setNuevoProducto(null);
            setCodigoSinProducto(null);
            agregar({ productId: p.id, nombre: p.nombre, perecible: p.perecible, costoAnterior: 0, stock: 0, unidad: p.unidad });
            setAviso(`✓ ${p.nombre} quedó en el catálogo: anota cuántos llegaron y a qué costo`);
          }}
        />
      )}

      {nuevoProveedor && (
        <FormProveedor
          proveedor={null}
          onCancelar={() => setNuevoProveedor(false)}
          onGuardado={(id) => {
            setNuevoProveedor(false);
            setProveedorId(id);
            void repoProveedores().listar().then(setProveedores).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
