'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addToCart, cartTotals, setQuantity, removeFromCart, aplicarOfertas, tramosVigentes, diaLocal, precioDelTramo,
  precioParaCliente, describirCliente, type ClienteConPrecios,
  aplicarCombos, lineSubtotal, type Combo,
  formatCLP, toUserMessage, construirComprobante,
  type CartLine, type Comprobante as DatosComprobante, type DocumentoVenta, type RegistroDte,
} from '@rutaahorro/core';
import { findByBarcode, searchProducts, localProductCount, syncCatalog, EVENTO_CATALOGO } from '@/lib/offline/catalog';
import { DEMO_ACTIVO } from '@/lib/demo';
import { sembrarCatalogoDemo } from '@/lib/demo/seed';
import { enqueueSale, newClientUuid, syncQueue, respuestaDe } from '@/lib/offline/sync';
import type { LocalProduct } from '@/lib/offline/db';
import { configuracionLocal, CONFIGURACION_POR_OMISION, type ConfiguracionLocal } from '@/lib/datos/configuracion';
import { Modal } from '@/components/Modal';
import { db } from '@/lib/offline/db';
import { clientesParaVender } from '@/lib/datos/clientes';
import { combosParaVender } from '@/lib/datos/combos';
import { Escaner } from './Escaner';
import { Cobro } from './Cobro';
import { Comprobante } from './Comprobante';

type Aviso = { tipo: 'ok' | 'error' | 'info'; texto: string } | null;

// Nota: el descuento por línea (RF-M5-08) aún no está en esta pantalla. Cuando
// se agregue, vuelven a entrar `role` y `maxDiscountPct` para aplicar el tope
// por rol con `isDiscountAllowed` de @rutaahorro/core.
export function PosClient({
  hasOpenSession, local = '', cajero = '', puedeForzarStock = false,
}: {
  hasOpenSession: boolean;
  /** Admin y supervisor pueden vender sin stock; el resto no (fn_register_sale). */
  puedeForzarStock?: boolean;
  /** Nombre del local, para encabezar el comprobante. */
  local?: string;
  /** Quien atendió: va impreso en el comprobante. */
  cajero?: string;
}) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [confirmandoVaciar, setConfirmandoVaciar] = useState(false);
  // Para leer el carrito dentro de callbacks sin volver a crearlos en cada cambio.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  // Se arranca con los valores por omisión para no bloquear la venta mientras
  // llega la configuración: en el mostrador nadie espera a una consulta.
  const [config, setConfig] = useState<ConfiguracionLocal>(CONFIGURACION_POR_OMISION);
  const venderSinStockRef = useRef(config.venderSinStock);
  venderSinStockRef.current = config.venderSinStock;
  const zonaRef = useRef(config.zonaHoraria);
  zonaRef.current = config.zonaHoraria;
  const ofertasRef = useRef(config.ofertasActivas);
  ofertasRef.current = config.ofertasActivas;
  // 0022 · El cliente de la venta: su % o su precio especial en cada línea.
  const [cliente, setCliente] = useState<ClienteConPrecios | null>(null);
  const clienteRef = useRef(cliente);
  clienteRef.current = cliente;
  const [eligiendoCliente, setEligiendoCliente] = useState(false);
  // 0023 · Los combos del local, desde el celular.
  const combosRef = useRef<Combo[]>([]);

  /**
   * Todo cambio del carrito pasa por acá: después de agregar, quitar o
   * cambiar una cantidad, cada línea toma el precio de su tramo (0018). Con 2
   * jugos la línea va a $2.000; al agregar el tercero, los tres a $1.400.
   */
  const cambiarCarro = useCallback((f: (prev: CartLine[]) => CartLine[]) => {
    setLines((prev) => {
      const siguiente = f(prev);
      // 0021 · Con las ofertas apagadas en el local, precio normal. En
      // producción el catálogo ya llega sin ellas; esto cubre la maqueta y
      // un carrito armado antes de que llegara la configuración.
      const lineas = (ofertasRef.current ? siguiente
        : siguiente.map((l) => (l.tramos?.length ? { ...l, tramos: [] } : l)))
        // 0022 · El precio del cliente elegido, que no se apaga con las ofertas.
        .map((l) => (l.precioLista == null ? l
          : { ...l, precioCliente: precioParaCliente(l.productId, l.precioLista, clienteRef.current) }));
      const dia = diaLocal(new Date(), zonaRef.current);
      // 0023 · El combo va después: se mide contra el precio que la línea ya
      // tiene (oferta o cliente), así nunca se suma a otra rebaja.
      return aplicarCombos(aplicarOfertas(lineas, dia), ofertasRef.current ? combosRef.current : [], dia);
    });
  }, []);

  // Los combos se leen al entrar y cada vez que el catálogo cambia; el
  // carrito se recalcula con ellos.
  useEffect(() => {
    const leer = () => void combosParaVender()
      .then((c) => { combosRef.current = c; cambiarCarro((p) => p); })
      .catch(() => {});
    leer();
    window.addEventListener(EVENTO_CATALOGO, leer);
    return () => window.removeEventListener(EVENTO_CATALOGO, leer);
  }, [cambiarCarro]);
  const [scannerOn, setScannerOn] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocalProduct[]>([]);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [cobrando, setCobrando] = useState(false);
  const [comprobante, setComprobante] = useState<DatosComprobante | null>(null);
  const [catalogReady, setCatalogReady] = useState<boolean | null>(null);
  const avisoTimer = useRef<number | null>(null);

  const totals = cartTotals(lines);

  const notificar = useCallback((tipo: 'ok' | 'error' | 'info', texto: string) => {
    setAviso({ tipo, texto });
    if (avisoTimer.current) window.clearTimeout(avisoTimer.current);
    avisoTimer.current = window.setTimeout(() => setAviso(null), 3200);
  }, []);

  useEffect(() => {
    void configuracionLocal().then(setConfig);
  }, []);

  // El catálogo local es lo que permite escanear sin internet.
  useEffect(() => {
    void (async () => {
      // En demo no hay Supabase: se siembra el catálogo de ejemplo.
      if (DEMO_ACTIVO) {
        if ((await localProductCount()) === 0) await sembrarCatalogoDemo();
        setCatalogReady(true);
        return;
      }

      const count = await localProductCount();
      if (count === 0 && navigator.onLine) {
        notificar('info', 'Descargando catálogo…');
        try {
          await syncCatalog(true);
          setCatalogReady((await localProductCount()) > 0);
        } catch {
          setCatalogReady(false);
        }
      } else {
        setCatalogReady(count > 0);
        // Al entrar a vender se trae lo que cambió desde la última vez: un
        // producto creado recién tiene que poder venderse ya, no en 10 minutos.
        if (navigator.onLine) void syncCatalog().then(async () => setCatalogReady((await localProductCount()) > 0)).catch(() => {});
      }
    })();
  }, [notificar]);

  // Si el catálogo cambia mientras hay algo escrito en la búsqueda, se repite.
  const [versionCatalogo, setVersionCatalogo] = useState(0);
  useEffect(() => {
    const alCambiar = () => setVersionCatalogo((v) => v + 1);
    window.addEventListener(EVENTO_CATALOGO, alCambiar);
    return () => window.removeEventListener(EVENTO_CATALOGO, alCambiar);
  }, []);

  const agregar = useCallback((p: LocalProduct, qty = 1) => {
    cambiarCarro((prev) =>
      addToCart(prev, {
        productId: p.id,
        name: p.name,
        description: p.description ?? null,
        unitPrice: p.salePrice,
        precioLista: p.salePrice,
        tramos: p.tramos ?? [],
        tasaAdicional: p.tasaAdicional ?? 0,
        nombreAdicional: p.impuestoNombre ?? null,
        quantity: qty,
        tracksExpiry: p.tracksExpiry,
        stockAvailable: p.stock,
      }),
    );
    // La venta descuenta de la sala. Si lo que hay a la vista no alcanza pero
    // queda en bodega, se avisa y se vende igual (decisión 2026-09-19).
    const enCarro = (linesRef.current.find((l) => l.productId === p.id)?.quantity ?? 0) + qty;
    const sala = p.stockSala ?? p.stock;
    if (enCarro > sala && (p.stockBodega ?? 0) > 0) {
      notificar('info', `${p.name}: a la vista quedan ${Math.max(0, sala)} · hay ${p.stockBodega} en bodega, conviene reponer`);
    } else if (enCarro > p.stock && venderSinStockRef.current) {
      // Se vende igual (respuesta 13), pero quien cobra sabe que el sistema
      // no lo tenía: es la pista de que falta ingresar una recepción.
      notificar('info', `${p.name}: el sistema tenía ${Math.max(0, p.stock)}. Se vende igual y se avisa al administrador`);
    } else {
      notificar('ok', `${p.name} · ${formatCLP(p.salePrice)}`);
    }
  }, [notificar, cambiarCarro]);

  const onScan = useCallback(async (code: string) => {
    const product = await findByBarcode(code);
    if (product) {
      agregar(product);
      return;
    }
    // RF-M5-04: código desconocido ofrece crear el producto, sin perder el carrito
    notificar('error', `Código ${code} no está en el catálogo`);
    setQuery(code);
  }, [agregar, notificar]);

  /**
   * Lector de códigos físico (RQ-13). Un lector USB o Bluetooth se comporta
   * como un teclado: escribe el código y presiona Enter. Sin esto el código
   * quedaba escrito en el buscador y había que tocar el resultado, producto
   * por producto. Con 5 a 10 productos por venta (respuesta 12) eso es el
   * mostrador entero esperando.
   *
   * Enter con un código conocido lo agrega; con un solo resultado por nombre,
   * agrega ese. El campo queda vacío y con el foco, listo para el siguiente.
   */
  async function alPresionarEnter() {
    const texto = query.trim();
    if (!texto) return;
    const porCodigo = /^\d{4,}$/.test(texto) ? await findByBarcode(texto) : undefined;
    if (porCodigo) {
      agregar(porCodigo);
      setQuery('');
      setResults([]);
      return;
    }
    if (results.length === 1) {
      agregar(results[0]);
      setQuery('');
      setResults([]);
      return;
    }
    if (/^\d{4,}$/.test(texto)) await onScan(texto);
  }

  // Búsqueda incremental, 100 % local (RNF-02)
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    let active = true;
    void searchProducts(query).then((r) => { if (active) setResults(r); });
    return () => { active = false; };
  }, [query, versionCatalogo]);

  /**
   * Resuelve true si la venta quedó registrada (o encolada sin conexión).
   *
   * Con conexión se espera la respuesta de la base ANTES de entregar el
   * comprobante. Antes se mostraba de inmediato y se sincronizaba después: si
   * la base la rechazaba (un vendedor que cobra algo sin stock), el cliente ya
   * se había ido con el producto, la plata estaba en el cajón y la venta
   * quedaba como un error en la cola del celular. El arqueo no cuadraba y nada
   * lo explicaba. Sin conexión sigue como siempre (ADR-005).
   */
  async function confirmarVenta(
    payments: Array<{ method: string; amount: number; received_amount?: number }>,
    documento: DocumentoVenta,
  ): Promise<boolean> {
    // Con "vender sin stock" (respuesta 13) el local vende lo que está en la
    // repisa aunque el sistema diga cero; la base deja la alerta.
    if (!puedeForzarStock && !config.venderSinStock) {
      const falta = lines.find((l) => typeof l.stockAvailable === 'number' && l.quantity > l.stockAvailable);
      if (falta) {
        notificar('error', `No hay stock suficiente de ${falta.name}: en el local quedan ${Math.max(0, falta.stockAvailable ?? 0)}. Un supervisor puede autorizar la venta.`);
        return false;
      }
    }
    const clientUuid = newClientUuid();
    const soldAt = new Date().toISOString();

    await enqueueSale({
      clientUuid,
      soldAt,
      sinConexion: !navigator.onLine,
      items: lines.map((l) => ({
        product_id: l.productId,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        // El combo viaja como descuento de la línea; la base calcula cuánto
        // se puede y no acepta más (0023).
        discount_amount: (l.discountAmount ?? 0) + (l.descuentoCombo ?? 0),
        name: l.name,
      })),
      payments,
      documento,
      clienteId: cliente?.id ?? null,
      // Solo el descuento a la venta completa: los de cada línea (combos) ya
      // viajan en `discount_amount`. Antes iba `totals.discountTotal`, que los
      // incluye, y la base los restaba dos veces. No se notaba porque hasta
      // 0023 ninguna línea tenía descuento. El POS todavía no ofrece descuento
      // a la venta completa (RQ-16): es 0.
      discountTotal: 0,
      total: totals.total,
    });

    let registrada: { folio?: number; dte?: RegistroDte | null } | undefined;
    if (navigator.onLine) {
      await syncQueue();
      const fila = await db().saleQueue.get(clientUuid);
      if (fila?.status === 'error') {
        // No quedó registrada: se saca de la cola y el carrito se conserva
        // para corregir y volver a cobrar.
        await db().saleQueue.delete(clientUuid);
        notificar('error', toUserMessage(fila.lastError ?? ''));
        return false;
      }
      registrada = respuestaDe(clientUuid) as typeof registrada;
    }

    // El comprobante se arma con las líneas ANTES de vaciar el carrito
    // (RF-M5-14). El folio queda en null a propósito: lo asigna la base al
    // sincronizar, nunca el dispositivo. Dos cajeros sin señal inventarían
    // folios que después chocan.
    // El IVA sale de la configuración del local, no del 19 escrito por
    // omisión en core: el comprobante decía "IVA (19%)" pasara lo que pasara.
    setComprobante(construirComprobante({
      // Con conexión, el folio y la boleta los asignó la base (0019). Sin
      // conexión quedan pendientes: el dispositivo no inventa números.
      folio: registrada?.folio ?? null,
      dte: registrada?.dte ?? null,
      lineas: lines,
      pagos: payments.map((p) => ({
        metodo: p.method, monto: p.amount, recibido: p.received_amount,
      })),
      fecha: soldAt,
      local,
      cajero,
      ivaPct: config.ivaPct,
      documento,
    }));

    // La venta se confirma de inmediato en pantalla: el cajero no espera a la
    // red ni siquiera cuando hay buena señal (ADR-005). El comprobante que
    // acaba de aparecer ya es el aviso; un toast encima sería ruido.
    setLines([]);
    // La siguiente venta parte sin cliente: si no, el próximo que pase por
    // la caja pagaría a precio mayorista.
    setCliente(null);
    setCobrando(false);
    return true;
  }

  function elegirCliente(c: ClienteConPrecios | null) {
    clienteRef.current = c;
    setCliente(c);
    cambiarCarro((p) => p);
    setEligiendoCliente(false);
  }

  if (!hasOpenSession) {
    return (
      <div className="px-5 py-12 text-center">
        <p className="text-5xl mb-4" aria-hidden>💵</p>
        <h1 className="text-lg font-semibold mb-2">Abre tu caja para vender</h1>
        <p className="text-sm text-[var(--texto-suave)] mb-6 max-w-xs mx-auto">
          Declara con cuánto efectivo partes. Así, al cerrar, el sistema puede decirte si cuadra.
        </p>
        <Link
          href="/caja"
          className="tap inline-flex items-center px-6 py-3.5 rounded-xl bg-marca-500 text-white font-semibold"
        >
          Abrir caja
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100dvh-8rem)]">
      {/* Aviso flotante */}
      {aviso && (
        <div
          role="status"
          className={`sticky top-14 z-20 mx-3 mt-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-sm ${
            aviso.tipo === 'ok'
              ? 'bg-marca-100 text-marca-900'
              : aviso.tipo === 'error'
                ? 'bg-red-50 text-red-900'
                : 'bg-blue-50 text-blue-900'
          }`}
        >
          {aviso.texto}
        </div>
      )}

      {/* Escáner */}
      <div className="px-3 pt-3">
        <Escaner
          activo={scannerOn}
          onToggle={() => setScannerOn((v) => !v)}
          onScan={(code) => void onScan(code)}
        />
      </div>

      {/* Búsqueda manual: salida de emergencia si la cámara falla (R-05) */}
      <div className="px-3 pt-3">
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void alPresionarEnter(); } }}
          enterKeyHint="search"
          aria-label="Buscar por nombre o código"
          placeholder="Buscar por nombre o código…"
          className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white"
        />
        {catalogReady === false && (
          <p className="text-xs text-[var(--color-aviso)] mt-1.5">
            El catálogo no está descargado en este dispositivo. Conéctate a internet una vez para bajarlo.
          </p>
        )}
        {query.trim().length >= 2 && results.length === 0 && catalogReady !== false && (
          <p className="text-sm text-[var(--texto-suave)] mt-2 px-1">
            No hay productos activos que coincidan con «{query.trim()}».
          </p>
        )}
        {results.length > 0 && (
          <ul className="tarjeta mt-2 divide-y divide-[var(--borde)] overflow-hidden">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => { agregar(p); setQuery(''); setResults([]); }}
                  className="tap w-full px-4 py-3 flex items-center justify-between gap-3 text-left active:bg-marca-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    {p.description && (
                      <span className="block truncate text-xs text-[var(--texto-suave)]">
                        {p.description}
                      </span>
                    )}
                    <span className="block text-xs text-[var(--texto-suave)] num">
                      A la vista {p.stockSala ?? p.stock}{typeof p.stockBodega === 'number' && ` · en bodega ${p.stockBodega}`}
                      {p.tracksExpiry && ' · perecible'}
                    </span>
                  </span>
                  <span className="num font-semibold whitespace-nowrap">{formatCLP(p.salePrice)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Cliente (0022): precio mayorista o especial, y los datos de la factura. */}
      <div className="px-3 pt-3">
        {cliente ? (
          <div className="flex items-center gap-2 tarjeta px-3 py-1.5">
            <span className="min-w-0 flex-1 text-sm">
              <span aria-hidden>🤝 </span><strong className="font-semibold">{cliente.nombre}</strong>
              <span className="block text-xs text-[var(--texto-suave)]">{describirCliente(cliente)}</span>
            </span>
            <button onClick={() => setEligiendoCliente(true)} className="tap px-2 text-sm underline">Cambiar</button>
            <button onClick={() => elegirCliente(null)} aria-label="Quitar el cliente"
                    className="tap px-2 text-sm text-[var(--color-alerta)]">Quitar</button>
          </div>
        ) : (
          <button onClick={() => setEligiendoCliente(true)}
                  className="tap w-full px-3 rounded-xl border border-dashed border-[var(--borde)] text-sm text-[var(--texto-suave)] text-left">
            🤝 Elegir cliente (precio mayorista o factura)
          </button>
        )}
      </div>

      {/* Carrito */}
      <div className="flex-1 px-3 pt-3">
        {lines.length === 0 ? (
          <p className="text-center text-sm text-[var(--texto-suave)] py-10">
            Escanea un producto para empezar
          </p>
        ) : (
          <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
            {lines.map((l) => (
              <li key={l.productId} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{l.name}</p>
                    {/* Lo que confirma que se escaneó lo correcto: el nombre
                        del catálogo puede ser "LE-1000 ENT" y no decir nada. */}
                    {l.description && (
                      <p className="text-xs text-[var(--texto-suave)] truncate">{l.description}</p>
                    )}
                    <p className="text-xs text-[var(--texto-suave)] num">
                      {l.precioLista != null && l.unitPrice < l.precioLista && (
                        <s className="mr-1">{formatCLP(l.precioLista)}</s>
                      )}
                      {formatCLP(l.unitPrice)} c/u
                      {typeof l.stockAvailable === 'number' && l.stockAvailable < l.quantity && (
                        <span className="text-[var(--color-aviso)]"> · stock {l.stockAvailable}</span>
                      )}
                    </p>
                    <OfertaDeLinea linea={l} zona={config.zonaHoraria} />
                    {(l.descuentoCombo ?? 0) > 0 && (
                      <p className="text-xs font-medium text-marca-700 num">
                        🎁 Combo {l.comboNombre} · -{formatCLP(l.descuentoCombo ?? 0)}
                      </p>
                    )}
                  </div>
                  <p className="num font-semibold whitespace-nowrap">
                    {formatCLP(lineSubtotal(l))}
                  </p>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <button
                    aria-label={`Quitar una unidad de ${l.name}`}
                    onClick={() => cambiarCarro((p) => setQuantity(p, l.productId, l.quantity - 1))}
                    className="tap w-11 h-11 rounded-lg border border-[var(--borde)] text-xl font-bold active:bg-gray-100"
                  >
                    −
                  </button>
                  <span className="num w-10 text-center font-semibold">{l.quantity}</span>
                  <button
                    aria-label={`Agregar una unidad de ${l.name}`}
                    onClick={() => cambiarCarro((p) => setQuantity(p, l.productId, l.quantity + 1))}
                    className="tap w-11 h-11 rounded-lg border border-[var(--borde)] text-xl font-bold active:bg-gray-100"
                  >
                    +
                  </button>
                  <button
                    onClick={() => cambiarCarro((p) => removeFromCart(p, l.productId))}
                    className="tap ml-auto px-3 text-sm text-[var(--color-alerta)]"
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Barra de cobro: fija abajo, al alcance del pulgar (RNF-17) */}
      {lines.length > 0 && (
        <div className="sticky bottom-0 z-20 bg-white border-t border-[var(--borde)] px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--texto-suave)]">
              {totals.unitCount} {totals.unitCount === 1 ? 'unidad' : 'unidades'}
            </span>
            <span className="num text-2xl font-bold">{formatCLP(totals.total)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmandoVaciar(true)}
              className="tap px-4 py-3.5 rounded-xl border border-[var(--borde)] text-sm font-medium"
            >
              Vaciar
            </button>
            <button
              onClick={() => setCobrando(true)}
              className="tap flex-1 py-3.5 rounded-xl bg-marca-500 text-white font-bold text-base active:bg-marca-600"
            >
              Cobrar
            </button>
          </div>
        </div>
      )}

      {cobrando && (
        <Cobro
          total={totals.total}
          tarjetaEmiteDocumento={config.tarjetaEmiteDocumento}
          cliente={cliente}
          onCancel={() => setCobrando(false)}
          onConfirm={(payments, documento) =>
            confirmarVenta(payments, documento).catch((e) => { notificar('error', toUserMessage(e)); return false; })
          }
        />
      )}

      {eligiendoCliente && (
        <ElegirCliente onElegir={elegirCliente} onCerrar={() => setEligiendoCliente(false)} />
      )}

      {/* Vaciar pide confirmación (RNF-19): un toque de más borraba la venta armada. */}
      {confirmandoVaciar && (
        <Modal titulo="¿Vaciar la venta?" encabezado="visible" onCerrar={() => setConfirmandoVaciar(false)}>
          <div className="p-5 space-y-3">
            <p className="text-sm">
              Se quitan {lines.length} {lines.length === 1 ? 'producto' : 'productos'} del carrito ({formatCLP(totals.total)}).
            </p>
            <button
              onClick={() => { setLines([]); setConfirmandoVaciar(false); }}
              className="tap w-full py-3.5 rounded-xl bg-[var(--color-alerta)] text-white font-bold"
            >
              Sí, vaciar
            </button>
            <button
              onClick={() => setConfirmandoVaciar(false)}
              className="tap w-full py-3 rounded-xl border border-[var(--borde)]"
            >
              No, seguir vendiendo
            </button>
          </div>
        </Modal>
      )}

      {comprobante && (
        <Comprobante datos={comprobante} onCerrar={() => setComprobante(null)} />
      )}
    </div>
  );
}

/**
 * Lo que la oferta le dice al cajero. Aplicada: cuánto se ahorra el cliente
 * (texto y color, RNF-46). Por aplicar: cuántas faltan para el siguiente
 * tramo, que es lo que el cajero le ofrece al cliente en voz alta.
 */
function OfertaDeLinea({ linea, zona }: { linea: CartLine; zona: string }) {
  if (linea.precioLista == null) return null;
  if (linea.precioCliente != null && linea.unitPrice === linea.precioCliente) {
    return (
      <p className="text-xs font-medium text-marca-700 num">
        🤝 Precio de cliente · ahorra {formatCLP(Math.round((linea.precioLista - linea.unitPrice) * linea.quantity))}
      </p>
    );
  }
  if (!linea.tramos?.length) return null;
  const lista = linea.precioLista;
  const vigentes = tramosVigentes(linea.tramos, diaLocal(new Date(), zona))
    .map((t) => ({ desde: t.desde, precio: precioDelTramo(t, lista) }))
    .filter((t) => t.precio < lista);
  const ahorro = Math.round((lista - linea.unitPrice) * linea.quantity);
  const siguiente = vigentes.find((t) => t.desde > linea.quantity && t.precio < linea.unitPrice);
  return (
    <>
      {ahorro > 0 && (
        <p className="text-xs font-medium text-marca-700 num">🏷️ Oferta aplicada · ahorra {formatCLP(ahorro)}</p>
      )}
      {siguiente && (
        <p className="text-xs text-[var(--texto-suave)] num">
          Llevando {siguiente.desde - linea.quantity} más: {formatCLP(siguiente.precio)} c/u
        </p>
      )}
    </>
  );
}

/**
 * Elegir al cliente de la venta (0022). La lista viene del celular, así que
 * funciona sin conexión; se busca por nombre o RUT.
 */
function ElegirCliente({ onElegir, onCerrar }: {
  onElegir: (c: ClienteConPrecios | null) => void;
  onCerrar: () => void;
}) {
  const [clientes, setClientes] = useState<ClienteConPrecios[] | null>(null);
  const [busqueda, setBusqueda] = useState('');
  useEffect(() => { void clientesParaVender().then(setClientes).catch(() => setClientes([])); }, []);
  const q = busqueda.trim().toLowerCase();
  const soloRut = q.replace(/[^0-9k]/g, '');
  const visibles = (clientes ?? []).filter((c) => !q
    || c.nombre.toLowerCase().includes(q)
    || (soloRut.length >= 3 && (c.rut ?? '').toLowerCase().replace(/[^0-9k]/g, '').includes(soloRut)));
  return (
    <Modal titulo="Cliente de la venta" encabezado="visible" onCerrar={onCerrar}>
      <div className="p-4 space-y-3">
        <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoFocus
               aria-label="Buscar cliente por nombre o RUT" placeholder="Nombre o RUT…"
               className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />
        <ul className="divide-y divide-[var(--borde)] tarjeta max-h-[50vh] overflow-y-auto">
          {visibles.map((c) => (
            <li key={c.id}>
              <button onClick={() => onElegir(c)} className="tap w-full px-3 py-2 text-left active:bg-marca-50">
                <span className="block text-sm font-medium">{c.nombre}</span>
                <span className="block text-xs text-[var(--texto-suave)]">
                  {c.rut ? `${c.rut} · ` : ''}{describirCliente(c)}
                </span>
              </button>
            </li>
          ))}
          {clientes && visibles.length === 0 && (
            <li className="p-4 text-sm text-[var(--texto-suave)]">
              {clientes.length === 0
                ? 'Todavía no hay clientes. Se crean en Clientes, o solos al hacer una factura.'
                : 'Ningún cliente coincide.'}
            </li>
          )}
        </ul>
        <button onClick={() => onElegir(null)} className="tap w-full rounded-xl border border-[var(--borde)] text-sm">
          Vender sin cliente
        </button>
      </div>
    </Modal>
  );
}
