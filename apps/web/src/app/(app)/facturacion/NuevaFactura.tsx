'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatCLP, formatCantidad, toUserMessage, validarMonto, validarCantidadVenta, isValidRut, formatRut,
  resumenFactura, precioConIva, cantidadConUnidad, type LineaFactura, coincide
} from '@rutaahorro/core';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { useConfiguracion } from '@/lib/datos/configuracion';
import { repoClientes, type Cliente } from '@/lib/datos/clientes';
import { repoProductos, type Producto } from '@/lib/productos';
import { db } from '@/lib/offline/db';
import { repoFacturacion, type Factura, type FormaPago, type Receptor } from '@/lib/datos/facturacion';

/** Con qué se abre el formulario: vacío, o una factura anterior "usada como base". */
export interface BaseFactura {
  clienteId: string | null;
  receptor: Receptor;
  formaPago: FormaPago;
  observaciones: string | null;
  lineas: Array<{ productId: string | null; nombre: string; descripcion: string | null; unidad: string | null;
                  cantidad: number; precio: number; descuento: number; tasa: number }>;
}

interface LineaForm {
  key: string;
  productId: string | null;
  nombre: string;
  descripcion: string;
  unidad: string | null;
  tasa: number;
  stock: number | null;
  cantidad: string;
  /** Lo escrito, en el modo de precio elegido (con IVA o neto). */
  precio: string;
  descuento: string;
}

type ModoPrecio = 'iva' | 'neto';

interface Borrador {
  usuario: string;
  clienteId: string | null;
  receptor: Receptor;
  formaPago: FormaPago;
  observaciones: string;
  modo: ModoPrecio;
  lineas: LineaForm[];
}

const CLAVE_BORRADOR = 'facturacion:borrador';
const RECEPTOR_VACIO: Receptor = { rut: '', razon_social: '', giro: '', direccion: '', comuna: '', ciudad: '', correo: '' };
const nuevaClave = () => Math.random().toString(36).slice(2);
const soloRut = (r: string | null | undefined) => (r ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/**
 * La cantidad de una línea. De catálogo: entera, salvo kg/gramo/litro/ml (lo
 * mismo que el POS y que la base). Libre: admite decimales (3 horas de
 * servicio técnico, 1,5 m³ de flete).
 */
const validarCantidadLinea = (l: LineaForm) =>
  validarCantidadVenta(l.cantidad, l.productId ? l.unidad : 'kg');

/**
 * Factura manual (0026). Editable hasta que se emite: cliente autocompletado
 * desde Clientes por RUT o nombre, líneas del catálogo (descuentan stock) y
 * líneas libres (no). El borrador vive en la pestaña: salir a mirar un precio
 * no borra lo escrito.
 */
export function NuevaFactura({ usuarioId, base, onEmitida }: {
  usuarioId: string;
  base: BaseFactura | null;
  onEmitida: (f: Factura) => void;
}) {
  const { ivaPct } = useConfiguracion();
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [receptor, setReceptor] = useState<Receptor>(RECEPTOR_VACIO);
  const [formaPago, setFormaPago] = useState<FormaPago>('contado');
  const [observaciones, setObservaciones] = useState('');
  const [modo, setModo] = useState<ModoPrecio>('iva');
  const [lineas, setLineas] = useState<LineaForm[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intentado, setIntentado] = useState(false);
  const [verDatosReceptor, setVerDatosReceptor] = useState(false);
  const listo = useRef(false);

  // Al abrir: la base elegida, o el borrador de esta pestaña.
  useEffect(() => {
    if (base) {
      setClienteId(base.clienteId);
      setReceptor({ ...RECEPTOR_VACIO, ...base.receptor });
      setFormaPago(base.formaPago);
      setObservaciones(base.observaciones ?? '');
      setModo('iva');
      setLineas(base.lineas.map((l) => ({
        key: nuevaClave(), productId: l.productId, nombre: l.nombre, descripcion: l.descripcion ?? '', unidad: l.unidad,
        tasa: l.tasa, stock: null, cantidad: formatCantidad(l.cantidad), precio: String(l.precio),
        descuento: l.descuento ? String(l.descuento) : '',
      })));
    } else {
      try {
        const b = JSON.parse(sessionStorage.getItem(CLAVE_BORRADOR) ?? 'null') as Borrador | null;
        if (b && b.usuario === usuarioId) {
          setClienteId(b.clienteId); setReceptor(b.receptor); setFormaPago(b.formaPago);
          setObservaciones(b.observaciones); setModo(b.modo); setLineas(b.lineas);
        }
      } catch { /* sin borrador */ }
    }
    listo.current = true;
    void repoClientes().listar().then((l) => setClientes(l.filter((c) => c.activo))).catch(() => {});
  }, [base, usuarioId]);

  useEffect(() => {
    if (!listo.current) return;
    try {
      sessionStorage.setItem(CLAVE_BORRADOR, JSON.stringify({
        usuario: usuarioId, clienteId, receptor, formaPago, observaciones, modo, lineas,
      } satisfies Borrador));
    } catch { /* sin almacenamiento: el borrador vive solo en memoria */ }
  }, [usuarioId, clienteId, receptor, formaPago, observaciones, modo, lineas]);

  // ------------------------------------------------------------ cálculos
  const calculadas = lineas.map((l) => {
    const cant = validarCantidadLinea(l);
    const pr = validarMonto(l.precio, { etiqueta: 'precio', permiteVacio: false, maximo: 500_000_000 });
    const desc = validarMonto(l.descuento, { etiqueta: 'descuento', permiteVacio: true, maximo: 500_000_000 });
    const precio = modo === 'neto' ? precioConIva(pr.valor, ivaPct, l.tasa) : pr.valor;
    const linea: LineaFactura = {
      productId: l.productId, nombre: l.nombre, cantidad: cant.valor, precio, descuento: desc.valor,
      tasaAdicional: l.tasa, nombreAdicional: l.tasa ? `Imp. adicional ${l.tasa}%` : null,
    };
    return { l, cant, pr, desc, precio, linea };
  });
  const resumen = resumenFactura(calculadas.map((c) => c.linea), ivaPct);

  const erroresReceptor = [
    !isValidRut(receptor.rut) && 'El RUT del cliente no es válido',
    !receptor.razon_social.trim() && 'Falta la razón social',
    !receptor.giro.trim() && 'Falta el giro (el SII lo exige)',
    !receptor.direccion.trim() && 'Falta la dirección',
    !receptor.comuna.trim() && 'Falta la comuna',
  ].filter(Boolean) as string[];
  const erroresLineas = calculadas.flatMap((c, i) => [
    !c.cant.valido && `Línea ${i + 1}: ${c.cant.error}`,
    !c.pr.valido && `Línea ${i + 1}: ${c.pr.error}`,
    !c.desc.valido && `Línea ${i + 1}: ${c.desc.error}`,
  ].filter(Boolean) as string[]);
  const errores = [...erroresReceptor, ...erroresLineas, ...resumen.errores];

  const sinStock = calculadas.filter((c) => c.l.productId && c.l.stock !== null && c.cant.valor > c.l.stock);
  const deCatalogo = calculadas.filter((c) => c.l.productId);

  // ------------------------------------------------------------ cliente
  function elegirCliente(c: Cliente) {
    setClienteId(c.id);
    setReceptor((r) => ({
      ...r, rut: c.rut ?? r.rut, razon_social: c.nombre, giro: c.giro ?? '', direccion: c.direccion ?? '',
      comuna: c.comuna ?? '', correo: c.email ?? '',
    }));
  }
  function alCambiarRut(texto: string) {
    setReceptor((r) => ({ ...r, rut: texto }));
    setClienteId(null);
    if (!isValidRut(texto)) return;
    const c = clientes.find((x) => soloRut(x.rut) === soloRut(texto));
    if (c) elegirCliente(c);
  }
  // La lista de clientes llega después de abrir el formulario. Un RUT escrito
  // antes (usuario rápido, celular lento, borrador, "usar como base") no se
  // reconocía nunca: se busca de nuevo cuando llega. Solo completa lo vacío.
  useEffect(() => {
    if (clienteId || !isValidRut(receptor.rut)) return;
    const c = clientes.find((x) => soloRut(x.rut) === soloRut(receptor.rut));
    if (!c) return;
    setClienteId(c.id);
    setReceptor((r) => ({
      ...r, razon_social: r.razon_social || c.nombre, giro: r.giro || (c.giro ?? ''),
      direccion: r.direccion || (c.direccion ?? ''), comuna: r.comuna || (c.comuna ?? ''), correo: r.correo || (c.email ?? ''),
    }));
  }, [clientes]); // eslint-disable-line react-hooks/exhaustive-deps -- solo cuando llega la lista
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const sugerencias = useMemo(() => {
    const q = busquedaCliente.trim().toLowerCase();
    if (q.length < 2) return [];
    const r = soloRut(q);
    return clientes.filter((c) => coincide(c.nombre, q) || (r.length >= 3 && soloRut(c.rut).includes(r))).slice(0, 6);
  }, [busquedaCliente, clientes]);

  // ------------------------------------------------------------ líneas
  const cambiar = (key: string, cambio: Partial<LineaForm>) =>
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambio } : l)));

  async function agregarProducto(p: Producto) {
    const local = await db().products.get(p.id).catch(() => undefined);
    const tasa = local?.tasaAdicional ?? 0;
    const precio = modo === 'neto' ? Math.round(p.precioVenta / (1 + ivaPct / 100 + tasa / 100)) : p.precioVenta;
    setLineas((ls) => [...ls, {
      key: nuevaClave(), productId: p.id, nombre: p.nombre, descripcion: '', unidad: p.unidad, tasa,
      stock: p.stockSala, cantidad: '1', precio: String(precio), descuento: '',
    }]);
    setBuscandoProducto(false);
  }
  function agregarLibre() {
    setLineas((ls) => [...ls, {
      key: nuevaClave(), productId: null, nombre: '', descripcion: '', unidad: null, tasa: 0, stock: null,
      cantidad: '1', precio: '', descuento: '',
    }]);
  }
  function cambiarModo(m: ModoPrecio) {
    if (m === modo) return;
    // Lo escrito se convierte, para que el total no cambie al cambiar de modo.
    setLineas((ls) => ls.map((l) => {
      const v = validarMonto(l.precio, { permiteVacio: true });
      if (!v.valido || !l.precio.trim()) return l;
      const nuevo = m === 'neto' ? Math.round(v.valor / (1 + ivaPct / 100 + l.tasa / 100)) : precioConIva(v.valor, ivaPct, l.tasa);
      return { ...l, precio: String(nuevo) };
    }));
    setModo(m);
  }

  // ------------------------------------------------------------ emitir
  function pedirConfirmacion() {
    setIntentado(true);
    setError(null);
    if (errores.length) { setError(errores[0]); return; }
    setConfirmando(true);
  }
  async function emitir() {
    setEmitiendo(true);
    setError(null);
    try {
      const f = await repoFacturacion().emitir({
        clientUuid, clienteId,
        receptor: { ...receptor, rut: formatRut(receptor.rut) },
        formaPago, observaciones: observaciones.trim() || null,
        lineas: calculadas.map((c) => ({
          productId: c.l.productId, nombre: c.l.nombre.trim(), descripcion: c.l.descripcion.trim() || null,
          cantidad: c.cant.valor, precio: c.precio, descuento: c.desc.valor,
        })),
      });
      try { sessionStorage.removeItem(CLAVE_BORRADOR); } catch { /* nada */ }
      setClientUuid(crypto.randomUUID());
      setConfirmando(false);
      onEmitida(f);
    } catch (e) {
      setConfirmando(false);
      setError(toUserMessage(e));
    } finally {
      setEmitiendo(false);
    }
  }

  const campoTexto = 'tap w-full px-3 rounded-xl border border-[var(--borde)] bg-white';
  const r = (k: keyof Receptor) => ({
    value: String(receptor[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setReceptor((x) => ({ ...x, [k]: e.target.value })),
  });

  return (
    <div className="space-y-4 pb-40">
      {/* ------------------------------------------------ cliente */}
      <section className="tarjeta p-3 space-y-3" aria-labelledby="t-cliente">
        <h2 id="t-cliente" className="font-semibold">Cliente</h2>
        {clientes.length > 0 && (
          <div>
            <input type="search" value={busquedaCliente} onChange={(e) => setBusquedaCliente(e.target.value)}
                   placeholder="Buscar en Clientes por nombre o RUT…" aria-label="Buscar cliente por nombre o RUT"
                   className={campoTexto} />
            {sugerencias.length > 0 && (
              <ul className="tarjeta mt-1 divide-y divide-[var(--borde)]">
                {sugerencias.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => { elegirCliente(c); setBusquedaCliente(''); }}
                            className="tap w-full px-3 py-2 text-left active:bg-marca-50">
                      <span className="block text-sm font-medium">{c.nombre}</span>
                      <span className="block text-xs text-[var(--texto-suave)]">{c.rut ?? 'sin RUT'}{c.giro ? ` · ${c.giro}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Campo etiqueta="RUT" obligatorio error={intentado && !isValidRut(receptor.rut) ? 'El RUT no es válido' : null}
               ayuda={clienteId ? '✓ Cliente guardado: los datos se completaron solos' : 'Si ya es cliente, se completa solo'}>
          {(p) => <input {...p} value={receptor.rut} onChange={(e) => alCambiarRut(e.target.value)}
                         onBlur={() => isValidRut(receptor.rut) && setReceptor((x) => ({ ...x, rut: formatRut(x.rut) }))}
                         placeholder="76.086.428-5" className={campoTexto} />}
        </Campo>
        {/* Pedido de Felipe (29-09): al poner el RUT de un cliente guardado, que se vea
            altiro a quién se le factura, no un formulario lleno. Los campos quedan
            plegados; se abren solos si al cliente le falta algo que el SII exige. */}
        {clienteId && (
          <div data-receptor className="rounded-xl border border-marca-500 bg-marca-50 p-3 text-marca-900">
            <p className="text-xs">Se factura a</p>
            <p className="font-semibold">{receptor.razon_social || 'Sin razón social'}</p>
            <p className="text-sm">RUT {formatRut(receptor.rut)}{receptor.giro ? ` · ${receptor.giro}` : ''}</p>
            <p className="text-sm">{[receptor.direccion, receptor.comuna, receptor.ciudad].filter(Boolean).join(', ')}</p>
            {receptor.correo && <p className="text-sm">{receptor.correo}</p>}
            {!verDatosReceptor && erroresReceptor.length === 0 && (
              <button onClick={() => setVerDatosReceptor(true)} className="tap -mb-2 text-sm underline">Corregir datos</button>
            )}
          </div>
        )}
        {(!clienteId || verDatosReceptor || erroresReceptor.length > 0) && (<>
        <Campo etiqueta="Razón social" obligatorio>{(p) => <input {...p} {...r('razon_social')} className={campoTexto} />}</Campo>
        <Campo etiqueta="Giro" obligatorio>{(p) => <input {...p} {...r('giro')} className={campoTexto} />}</Campo>
        <Campo etiqueta="Dirección" obligatorio>{(p) => <input {...p} {...r('direccion')} className={campoTexto} />}</Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Comuna" obligatorio>{(p) => <input {...p} {...r('comuna')} className={campoTexto} />}</Campo>
          <Campo etiqueta="Ciudad">{(p) => <input {...p} {...r('ciudad')} className={campoTexto} />}</Campo>
        </div>
        <Campo etiqueta="Correo" ayuda="Para mandarle la factura">
          {(p) => <input {...p} type="email" inputMode="email" {...r('correo')} className={campoTexto} />}
        </Campo>
        </>)}
      </section>

      {/* ------------------------------------------------ detalle */}
      <section className="tarjeta p-3 space-y-3" aria-labelledby="t-detalle">
        <div className="flex items-center justify-between gap-2">
          <h2 id="t-detalle" className="font-semibold">Detalle</h2>
          <div role="radiogroup" aria-label="Los precios que escribo son" className="flex rounded-lg border border-[var(--borde)] overflow-hidden text-xs">
            {([['iva', 'Con IVA'], ['neto', 'Netos']] as const).map(([m, t]) => (
              <button key={m} role="radio" aria-checked={modo === m} onClick={() => cambiarModo(m)}
                      className={`tap px-3 ${modo === m ? 'bg-marca-500 text-white font-semibold' : 'bg-white'}`}>{t}</button>
            ))}
          </div>
        </div>

        {lineas.length === 0 && (
          <p className="text-sm text-[var(--texto-suave)]">Agrega productos del catálogo o una línea libre (flete, servicio).</p>
        )}

        <ul className="space-y-3">
          {calculadas.map(({ l, cant, pr, desc, linea }, i) => (
            <li key={l.key} className="rounded-xl border border-[var(--borde)] p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-[var(--texto-suave)]">
                  Línea {i + 1} · {l.productId ? '📦 del catálogo · descuenta stock' : '✏️ libre · no mueve stock'}
                </p>
                <button onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}
                        aria-label={`Quitar la línea ${i + 1}`} className="tap -m-2 px-2 text-sm text-[var(--color-alerta)]">Quitar</button>
              </div>
              {l.productId ? (
                <p className="text-sm font-semibold">{l.nombre}</p>
              ) : (
                <Campo etiqueta="Qué se factura">
                  {(p) => <input {...p} value={l.nombre} maxLength={80} placeholder="Ej: Flete a domicilio"
                                 onChange={(e) => cambiar(l.key, { nombre: e.target.value })} className={campoTexto} />}
                </Campo>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Campo etiqueta={`Cantidad${l.unidad && l.unidad !== 'unidad' ? ` (${l.unidad})` : ''}`}
                       error={intentado || l.cantidad ? (cant.valido ? null : cant.error) : null}>
                  {(p) => <input {...p} inputMode="decimal" value={l.cantidad}
                                 onChange={(e) => cambiar(l.key, { cantidad: e.target.value })}
                                 className={`${campoTexto} num text-right`} />}
                </Campo>
                <Campo etiqueta={modo === 'neto' ? 'Precio c/u (neto)' : 'Precio c/u (con IVA)'}
                       error={intentado || l.precio ? (pr.valido ? null : pr.error) : null}>
                  {(p) => <input {...p} inputMode="numeric" value={l.precio}
                                 onChange={(e) => cambiar(l.key, { precio: e.target.value })}
                                 className={`${campoTexto} num text-right`} />}
                </Campo>
              </div>
              <details>
                <summary className="text-xs text-[var(--texto-suave)] cursor-pointer min-h-[44px] py-3 -my-2">Descuento o detalle (opcional)</summary>
                <div className="space-y-2 mt-1">
                  <Campo etiqueta="Descuento de la línea ($)" error={desc.valido ? null : desc.error}>
                    {(p) => <input {...p} inputMode="numeric" value={l.descuento}
                                   onChange={(e) => cambiar(l.key, { descuento: e.target.value })}
                                   className={`${campoTexto} num text-right`} />}
                  </Campo>
                  <Campo etiqueta="Detalle" ayuda="Texto largo bajo la línea, en la factura">
                    {(p) => <textarea {...p} value={l.descripcion} maxLength={1000} rows={2}
                                      onChange={(e) => cambiar(l.key, { descripcion: e.target.value })}
                                      className="w-full px-3 py-2 rounded-xl border border-[var(--borde)]" />}
                  </Campo>
                </div>
              </details>
              <p className="text-sm flex justify-between gap-2">
                <span className="text-[var(--texto-suave)]">
                  {l.stock !== null && `Hay ${cantidadConUnidad(l.stock, l.unidad)} a la vista`}
                  {l.stock !== null && cant.valido && cant.valor > l.stock && (
                    <span className="text-[var(--color-aviso)]"> · quedará en negativo</span>
                  )}
                </span>
                <strong className="num whitespace-nowrap">{formatCLP(Math.max(Math.round(linea.cantidad * linea.precio) - linea.descuento!, 0))}</strong>
              </p>
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setBuscandoProducto(true)}
                  className="tap rounded-xl border border-marca-500 text-marca-700 font-semibold text-sm">+ Del catálogo</button>
          <button onClick={agregarLibre}
                  className="tap rounded-xl border border-[var(--borde)] font-semibold text-sm">+ Línea libre</button>
        </div>
      </section>

      {/* ------------------------------------------------ pago */}
      <section className="tarjeta p-3 space-y-3" aria-labelledby="t-pago">
        <h2 id="t-pago" className="font-semibold">Pago</h2>
        <div role="radiogroup" aria-label="Forma de pago" className="grid grid-cols-2 gap-2">
          {([['contado', 'Contado'], ['credito', 'Crédito']] as const).map(([v, t]) => (
            <button key={v} role="radio" aria-checked={formaPago === v} onClick={() => setFormaPago(v)}
                    className={`tap rounded-xl border text-sm ${formaPago === v
                      ? 'border-marca-500 bg-marca-50 text-marca-900 font-semibold' : 'border-[var(--borde)] bg-white'}`}>{t}</button>
          ))}
        </div>
        <Campo etiqueta="Observaciones" ayuda="Opcional. Queda guardado con la factura.">
          {(p) => <textarea {...p} value={observaciones} maxLength={500} rows={2}
                            onChange={(e) => setObservaciones(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-[var(--borde)]" />}
        </Campo>
      </section>

      {/* ------------------------------------------------ totales: fijos abajo, al alcance del pulgar.
          Justo sobre la barra del celular (60 px + la zona segura, medido): en
          Recepción una barra fija quedó tapada por ella. En el computador,
          al lado de la lateral (w-60). */}
      <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-60 z-30 bg-white border-t border-[var(--borde)] px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-between text-xs text-[var(--texto-suave)] num">
            <span>Neto {formatCLP(resumen.neto)}</span>
            <span>IVA {formatCLP(resumen.iva)}</span>
            {resumen.totalAdicionales > 0 && <span>Adic. {formatCLP(resumen.totalAdicionales)}</span>}
            {resumen.ajuste !== 0 && <span data-ajuste>Ajuste IVA {resumen.ajuste > 0 ? '+' : '−'}{formatCLP(Math.abs(resumen.ajuste))}</span>}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <p className="num text-2xl font-bold flex-1">{formatCLP(resumen.total)}</p>
            <button onClick={pedirConfirmacion} disabled={lineas.length === 0 || emitiendo}
                    className="tap px-5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
              Emitir factura
            </button>
          </div>
          {error && <p role="alert" className="text-xs text-[var(--color-alerta)] mt-1">{error}</p>}
        </div>
      </div>

      {buscandoProducto && <BuscarProducto onElegir={(p) => void agregarProducto(p)} onCerrar={() => setBuscandoProducto(false)} />}

      {confirmando && (
        <Modal titulo="¿Emitir la factura?" encabezado="visible" onCerrar={() => setConfirmando(false)} bloqueado={emitiendo}>
          <div className="p-4 space-y-3 text-sm">
            <p>
              A <strong>{receptor.razon_social}</strong> (RUT {formatRut(receptor.rut)}) por{' '}
              <strong className="num">{formatCLP(resumen.total)}</strong>, {formaPago === 'credito' ? 'a crédito' : 'al contado'}.
            </p>
            {resumen.ajuste !== 0 && (
              <p className="text-[var(--texto-suave)]">
                Son {formatCLP(Math.abs(resumen.ajuste))} {resumen.ajuste > 0 ? 'más' : 'menos'} que la suma de las líneas:
                en una factura el IVA se calcula sobre el neto, como lo hace el SII.
              </p>
            )}
            {deCatalogo.length > 0 && (
              <p>Descuenta del stock: {deCatalogo.map((c) => `${formatCantidad(c.cant.valor)} ${c.l.nombre}`).join(', ')}.</p>
            )}
            {sinStock.length > 0 && (
              <p className="bg-amber-50 text-amber-900 px-3 py-2 rounded-lg">
                No alcanza el stock de {sinStock.map((c) => c.l.nombre).join(', ')}: quedará en negativo.
              </p>
            )}
            <p className="text-[var(--texto-suave)]">
              Una factura emitida no se edita: si hay un error, se corrige con nota de crédito.
            </p>
            <button onClick={() => void emitir()} disabled={emitiendo}
                    className="tap w-full rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
              {emitiendo ? 'Emitiendo…' : 'Sí, emitir'}
            </button>
            <button onClick={() => setConfirmando(false)} disabled={emitiendo}
                    className="tap w-full rounded-xl border border-[var(--borde)]">Seguir editando</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BuscarProducto({ onElegir, onCerrar }: { onElegir: (p: Producto) => void; onCerrar: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Producto[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    let vivo = true;
    const t = setTimeout(() => {
      void repoProductos().listar({ busqueda: q, soloActivos: true, limite: 20 }, false)
        .then((r) => { if (vivo) setRes(r); })
        .catch((e) => { if (vivo) setError(toUserMessage(e)); });
    }, 200);
    return () => { vivo = false; clearTimeout(t); };
  }, [q]);
  return (
    <Modal titulo="Agregar del catálogo" encabezado="visible" onCerrar={onCerrar}>
      <div className="p-4 space-y-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
               placeholder="Nombre, SKU o código…" aria-label="Buscar producto del catálogo"
               className="tap w-full px-3 rounded-xl border border-[var(--borde)]" />
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <ul className="tarjeta divide-y divide-[var(--borde)] max-h-[55vh] overflow-y-auto">
          {res.map((p) => (
            <li key={p.id}>
              <button onClick={() => onElegir(p)} className="tap w-full px-3 py-2 flex items-center justify-between gap-3 text-left active:bg-marca-50">
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{p.nombre}</span>
                  <span className="block text-xs text-[var(--texto-suave)] num">A la vista {cantidadConUnidad(p.stockSala, p.unidad)}</span>
                </span>
                <span className="num font-semibold whitespace-nowrap">{formatCLP(p.precioVenta)}</span>
              </button>
            </li>
          ))}
          {q.trim().length >= 2 && res.length === 0 && !error && (
            <li className="p-3 text-sm text-[var(--texto-suave)]">Ningún producto activo coincide.</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
