'use client';
import { Icono } from '@/components/Icono';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addToCart, cartTotals, setQuantity, removeFromCart, aplicarOfertas, tramosVigentes, diaLocal, precioDelTramo,
  type ClienteConPrecios,
  aplicarCombos, lineSubtotal, type Combo,
  formatCLP, formatCantidad, validarCantidadVenta, admiteDecimales, toUserMessage, construirComprobante,
  cantidadAtipica,
  type CartLine, type Comprobante as DatosComprobante, type DocumentoVenta, type RegistroDte, coincide
} from '@rutaahorro/core';
import { findByBarcode, desactivadoConCodigo, searchProducts, localProductCount, syncCatalog, EVENTO_CATALOGO, ultimaActualizacionCatalogo } from '@/lib/offline/catalog';
import { contarVendidos, masVendidos } from '@/lib/offline/frecuentes';
import { DEMO_ACTIVO } from '@/lib/demo';
import { sembrarCatalogoDemo } from '@/lib/demo/seed';
import { enqueueSale, newClientUuid, syncQueue, respuestaDe } from '@/lib/offline/sync';
import type { LocalProduct } from '@/lib/offline/db';
import { configuracionLocal, CONFIGURACION_POR_OMISION, type ConfiguracionLocal } from '@/lib/datos/configuracion';
import { Modal } from '@/components/Modal';
import { db } from '@/lib/offline/db';
import { clientesParaVender } from '@/lib/datos/clientes';
import { combosParaVender } from '@/lib/datos/combos';
import { guardarCarro, leerCarro, tomarPedidoPendiente } from '@/lib/offline/carro';
import { Escaner } from './Escaner';
import { Cobro } from './Cobro';
import { DescuentoLinea, PedirAutorizacion, type AutorizacionVigente } from './Descuentos';
import { Comprobante } from './Comprobante';

/** `deshacer`: lo que se acaba de agregar, para sacarlo con un toque (RF-M5-24). */
type Aviso = {
  tipo: 'ok' | 'error' | 'info'; texto: string;
  deshacer?: { productId: string; cantidad: number };
  /** RF-M5-24 · la línea que se acaba de quitar, para devolverla con "Deshacer". */
  recuperar?: CartLine;
} | null;

/** La línea del carrito para un producto del catálogo del celular. */
function lineaDesde(p: LocalProduct, quantity: number): CartLine {
  return {
    productId: p.id,
    name: p.name,
    description: p.description ?? null,
    unitPrice: p.salePrice,
    precioLista: p.salePrice,
    tramos: p.tramos ?? [],
    tasaAdicional: p.tasaAdicional ?? 0,
    nombreAdicional: p.impuestoNombre ?? null,
    quantity,
    unidad: p.unit,
    tracksExpiry: p.tracksExpiry,
    stockAvailable: p.stock,
  };
}

export function PosClient({
  hasOpenSession, local = '', cajero = '', usuarioId = '', puedeForzarStock = false, puedeCrearProductos = false,
  topeDescuento = 0,
}: {
  /** El tope de descuento de quien vende (profiles.max_discount_pct). Pasarlo pide autorización (RQ-17). */
  topeDescuento?: number;
  /** Admin y supervisor: un código desconocido se puede crear desde acá (RF-M5-04). */
  puedeCrearProductos?: boolean;
  hasOpenSession: boolean;
  /** Dueño del carrito guardado en la pestaña: otra persona no hereda la venta a medias. */
  usuarioId?: string;
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
  // El cliente de la venta: para la factura y el fiado. Desde 0032 no tiene
  // precio propio: el precio por mayor es del producto, desde N unidades.
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
        : siguiente.map((l) => (l.tramos?.length ? { ...l, tramos: [] } : l)));
      const dia = diaLocal(new Date(), zonaRef.current);
      // 0023 · El combo va después: se mide contra el precio que la línea ya
      // tiene (la oferta), así nunca se suma a otra rebaja.
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
  // El motivo por el que la venta no se registró, DENTRO del diálogo de
  // cobro: el aviso de la pantalla quedaba detrás del diálogo y el cajero
  // tocaba "Confirmar" sin ver por qué no pasaba nada.
  const [errorCobro, setErrorCobro] = useState<string | null>(null);
  const [comprobante, setComprobante] = useState<DatosComprobante | null>(null);
  const [catalogReady, setCatalogReady] = useState<boolean | null>(null);
  const avisoTimer = useRef<number | null>(null);

  const totals = cartTotals(lines);

  // RQ-15/17 · Descuento por línea. Si pasa el tope de quien vende, John o
  // María José lo autorizan con su PIN en este celular (0036). La base mide lo
  // mismo y rechaza lo que no esté autorizado.
  const [descontando, setDescontando] = useState<CartLine | null>(null);
  const [autorizacion, setAutorizacion] = useState<AutorizacionVigente | null>(null);
  const [pidiendoAutorizacion, setPidiendoAutorizacion] = useState(false);
  const brutoLineas = lines.reduce((s, l) => s + Math.round(l.unitPrice * l.quantity), 0);
  const descuentoManual = lines.reduce((s, l) => s + (l.discountAmount ?? 0), 0);
  const pctDescuento = brutoLineas > 0 ? (descuentoManual * 100) / brutoLineas : 0;
  const faltaAutorizacion = pctDescuento > topeDescuento + 0.011
    && !(autorizacion && autorizacion.pct + 0.011 >= pctDescuento);

  const notificar = useCallback((tipo: 'ok' | 'error' | 'info', texto: string, deshacer?: { productId: string; cantidad: number }, recuperar?: CartLine) => {
    setAviso({ tipo, texto, deshacer, recuperar });
    if (avisoTimer.current) window.clearTimeout(avisoTimer.current);
    // Con "Deshacer" el aviso dura más: hay que alcanzar a tocarlo.
    avisoTimer.current = window.setTimeout(() => setAviso(null), deshacer || recuperar ? 5000 : 3200);
  }, []);

  /**
   * RF-M5-24 · Sacar una línea (Quitar, o "−" hasta cero) ofrece "Deshacer",
   * como dice Ayuda. Antes solo se podía deshacer lo agregado: una línea
   * quitada por error había que volver a buscarla y a contar.
   */
  const quitarLinea = useCallback((l: CartLine) => {
    cambiarCarro((p) => removeFromCart(p, l.productId));
    notificar('info', `Se quitó ${l.name}`, undefined, l);
  }, [cambiarCarro, notificar]);

  // RF-M5-25 · los más vendidos en este celular, de un toque.
  const [frecuentes, setFrecuentes] = useState<LocalProduct[]>([]);
  const cargarFrecuentes = useCallback(async () => {
    const ids = masVendidos(8);
    const ps = await Promise.all(ids.map((id) => db().products.get(id).catch(() => undefined)));
    setFrecuentes(ps.filter((p): p is LocalProduct => Boolean(p?.isActive)));
  }, []);
  // RF-M5-29 · de cuándo son los precios que se están viendo.
  const [actualizado, setActualizado] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const leer = () => {
      void ultimaActualizacionCatalogo().then(setActualizado);
      void cargarFrecuentes();
    };
    leer();
    window.addEventListener(EVENTO_CATALOGO, leer);
    return () => window.removeEventListener(EVENTO_CATALOGO, leer);
  }, [cargarFrecuentes]);

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
    cambiarCarro((prev) => addToCart(prev, lineaDesde(p, qty)));
    const enCarro = (linesRef.current.find((l) => l.productId === p.id)?.quantity ?? 0) + qty;
    // Vender alimentos vencidos está prohibido (Reglamento Sanitario): si el
    // producto tiene un lote vencido, que el cajero mire la fecha antes de
    // entregarlo. No se bloquea: puede que en la repisa ya no quede de ese lote.
    if (p.venceProximo && p.venceProximo < diaLocal(new Date(), zonaRef.current)) {
      notificar('error', `${p.name}: hay un lote vencido el ${p.venceProximo.split('-').reverse().join('-')}. Revisa la fecha antes de entregarlo`,
        { productId: p.id, cantidad: qty });
    } else if (enCarro > p.stock && venderSinStockRef.current) {
      // Se vende igual (respuesta 13), pero quien cobra sabe que el sistema
      // no lo tenía: es la pista de que falta ingresar una recepción.
      notificar('info', `${p.name}: el sistema tenía ${Math.max(0, p.stock)}. Se vende igual y se avisa al administrador`);
    } else if (enCarro > p.stock && !puedeForzarStock) {
      // Antes decía "✓" y la venta recién fallaba al cobrar, con el cliente
      // esperando. Se agrega igual (puede ser un error del sistema), pero se
      // dice ahora lo que va a pasar.
      notificar('error', `${p.name}: el sistema tiene ${Math.max(0, p.stock)}. Así no se podrá cobrar: pide a un supervisor que lo revise`,
        { productId: p.id, cantidad: qty });
    } else {
      notificar('ok', `${p.name} · ${formatCLP(p.salePrice)}`, { productId: p.id, cantidad: qty });
    }
  }, [notificar, cambiarCarro, puedeForzarStock]);

  /** RF-M5-24 · el último escaneo fue un error: se saca sin buscar la línea. */
  function recuperarLinea(l: CartLine) {
    cambiarCarro((prev) => addToCart(prev, l));
    setAviso(null);
  }

  function deshacer(d: { productId: string; cantidad: number }) {
    cambiarCarro((prev) => {
      const l = prev.find((x) => x.productId === d.productId);
      if (!l) return prev;
      return l.quantity - d.cantidad > 0
        ? setQuantity(prev, d.productId, Math.round((l.quantity - d.cantidad) * 1000) / 1000)
        : removeFromCart(prev, d.productId);
    });
    setAviso(null);
  }

  /** La venta a medio armar vuelve al entrar (sessionStorage, más abajo). */
  const restauradoRef = useRef(false);

  /**
   * Las líneas toman precio, ofertas, impuesto y stock del catálogo del
   * celular de AHORA. Una línea agregada antes de que terminara de bajar el
   * catálogo se quedaba con lo viejo para siempre: si la oferta llegó un
   * segundo después, se cobraba precio normal (lo destapó ofertas.mjs contra
   * Railway, donde la bajada tarda más). Lo que ya no se vende sale.
   */
  const refrescarLineas = useCallback(async (lineas: CartLine[]) => {
    const quitados: string[] = [];
    const frescas: CartLine[] = [];
    for (const l of lineas) {
      const p = await db().products.get(l.productId).catch(() => undefined);
      if (p && !p.isActive) { quitados.push(l.name); continue; }
      frescas.push(p ? { ...lineaDesde(p, l.quantity), discountAmount: l.discountAmount } : l);
    }
    if (quitados.length) notificar('info', `Se quitó de la venta porque ya no se vende: ${quitados.join(', ')}`);
    return frescas;
  }, [notificar]);

  /** El carrito del momento, con el catálogo de ahora (lo del cajero no se pisa). */
  const refrescarCarro = useCallback(async (lineas: CartLine[]) => {
    if (lineas.length === 0) return;
    const ids = new Set(lineas.map((l) => l.productId));
    const frescas = new Map((await refrescarLineas(lineas)).map((l) => [l.productId, l]));
    // Contra el carrito del momento: el cajero pudo tocar algo mientras se leía.
    // Lo que se leyó y ya no se vende sale; lo agregado después queda.
    cambiarCarro((prev) => prev.flatMap((l) => {
      if (!ids.has(l.productId)) return [l];
      const f = frescas.get(l.productId);
      return f ? [{ ...f, quantity: l.quantity, discountAmount: l.discountAmount }] : [];
    }));
  }, [refrescarLineas, cambiarCarro]);

  useEffect(() => {
    const alCambiar = () => void refrescarCarro(linesRef.current);
    window.addEventListener(EVENTO_CATALOGO, alCambiar);
    return () => window.removeEventListener(EVENTO_CATALOGO, alCambiar);
  }, [refrescarCarro]);

  // Cada cambio queda guardado en la pestaña, desde que se restauró. Va
  // declarado ANTES que la restauración, a propósito: en el primer render corre
  // primero, todavía sin restaurar, y así no escribe el carrito vacío encima
  // del guardado.
  useEffect(() => {
    if (restauradoRef.current) guardarCarro(usuarioId, lines, cliente?.id ?? null);
  }, [lines, cliente, usuarioId]);

  // Restaurar apenas se monta, sin esperar al catálogo: sessionStorage se lee
  // al instante. Antes esperaba a que el catálogo estuviera listo, y en
  // Railway el cajero alcanzaba a agregar un producto en ese rato (el catálogo
  // ya se podía buscar porque otra sincronización terminó primero): ese cambio
  // no se guardaba nunca y la venta se perdía al salir. Precios y ofertas se
  // refrescan después, con el catálogo del celular.
  useEffect(() => {
    if (!hasOpenSession || restauradoRef.current) return;
    restauradoRef.current = true;
    const guardado = leerCarro(usuarioId);
    if (guardado?.lineas.length) {
      cambiarCarro((prev) => prev.reduce(addToCart, guardado.lineas));
      void refrescarCarro(guardado.lineas);
    }
    if (guardado?.clienteId) {
      void clientesParaVender().catch(() => []).then((lista) => {
        const c = lista.find((x) => x.id === guardado.clienteId) ?? null;
        clienteRef.current = c;
        setCliente(c);
        cambiarCarro((p) => p);
      });
    }
  }, [hasOpenSession, usuarioId, cambiarCarro, refrescarCarro]);

  // Lo pedido desde el consultador necesita el producto del catálogo del
  // celular: espera a que esté listo, y se agrega una sola vez.
  const pedidoRef = useRef(false);
  useEffect(() => {
    if (!hasOpenSession || catalogReady === null || pedidoRef.current) return;
    pedidoRef.current = true;
    const pedido = tomarPedidoPendiente(usuarioId);
    if (!pedido) return;
    void db().products.get(pedido.productId).catch(() => undefined).then((p) => {
      if (p?.isActive) agregar(p, pedido.cantidad);
      else notificar('error', 'Ese producto no está en el catálogo de este dispositivo');
    });
  }, [hasOpenSession, catalogReady, usuarioId, agregar, notificar]);

  const onScan = useCallback(async (code: string) => {
    const product = await findByBarcode(code);
    if (product) {
      agregar(product);
      return;
    }
    const desactivado = await desactivadoConCodigo(code).catch(() => null);
    if (desactivado) {
      notificar('error', `${desactivado} está desactivado: no se vende. Un administrador lo reactiva en Productos`);
      // Sin limpiar, el buscador seguía ofreciendo "Crear el producto con este código".
      setQuery('');
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
    // La búsqueda de la pantalla puede ser la de lo escrito hace un instante
    // (corre aparte): con el lector, Enter llega antes de que se actualice y
    // se agregaba el producto de la búsqueda anterior.
    const actuales = await searchProducts(texto);
    if (actuales.length === 1) {
      agregar(actuales[0]);
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
        setErrorCobro(`No hay stock suficiente de ${falta.name}: en el local quedan ${Math.max(0, falta.stockAvailable ?? 0)}. Un supervisor puede autorizar la venta.`);
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
      autorizacion: autorizacion?.id ?? null,
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
        setErrorCobro(toUserMessage(fila.lastError ?? ''));
        return false;
      }
      if (fila) {
        // La red se cortó a mitad del envío (esErrorDeRed): la venta queda en
        // la cola como una sin conexión. Se reenvía con el mismo clientUuid,
        // así que si sí había llegado no se duplica.
        await db().saleQueue.update(clientUuid, { sinConexion: true });
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
      pie: config.comprobantePie,
    }));

    // La venta se confirma de inmediato en pantalla: el cajero no espera a la
    // red ni siquiera cuando hay buena señal (ADR-005). El comprobante que
    // acaba de aparecer ya es el aviso; un toast encima sería ruido.
    contarVendidos(lines.map((l) => l.productId));
    void cargarFrecuentes();
    setLines([]);
    // La autorización era para esta venta (y la base ya la gastó).
    setAutorizacion(null);
    // La siguiente venta parte sin cliente.
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
        <span className="inline-grid place-items-center w-16 h-16 rounded-2xl bg-marca-50 text-marca-700 mb-4"><Icono nombre="caja" tamano={32} /></span>
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
          <span className="flex items-center justify-between gap-2">
            <span>{aviso.texto}</span>
            {(aviso.deshacer || aviso.recuperar) && (
              <button
                onClick={() => (aviso.recuperar ? recuperarLinea(aviso.recuperar) : deshacer(aviso.deshacer!))}
                className="tap -my-2 -mr-2 px-2 font-semibold underline shrink-0">
                Deshacer
              </button>
            )}
          </span>
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
        {catalogReady && actualizado !== undefined && <Frescura desde={actualizado} />}
        {query.trim() === '' && frecuentes.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] text-[var(--texto-suave)] mb-1">Frecuentes en este celular</p>
            <div className="flex gap-2 overflow-x-auto sin-scrollbar pb-1">
              {frecuentes.map((p) => (
                <button key={p.id} onClick={() => agregar(p)}
                  className="tap shrink-0 max-w-[10rem] px-3 py-1.5 rounded-xl border border-[var(--borde)] bg-white text-left">
                  <span className="block text-sm font-medium truncate">{p.name}</span>
                  <span className="block text-xs text-[var(--texto-suave)] num">{formatCLP(p.salePrice)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {query.trim().length >= 2 && results.length === 0 && catalogReady !== false && (
          /^[0-9A-Za-z-]{4,40}$/.test(query.trim()) && /\d{4,}/.test(query.trim()) ? (
            // RF-M5-04 · Un código que no está en el catálogo: antes solo se
            // decía y había que ir a Productos, buscar el botón y volver a
            // escanear. La venta armada no se pierde (queda en la pestaña).
            <div className="tarjeta mt-2 p-3 text-sm">
              <p className="font-medium">El código <span className="num">{query.trim()}</span> no está en el catálogo.</p>
              {puedeCrearProductos ? (
                <Link href={`/productos?nuevo=${encodeURIComponent(query.trim())}`} prefetch={false}
                      className="btn btn-secundario w-full mt-2">
                  <Icono nombre="agregar" tamano={18} /> Crear el producto con este código
                </Link>
              ) : (
                <p className="text-[var(--texto-suave)] mt-1">
                  Véndelo buscándolo por nombre, y pídele a un supervisor que le agregue este código.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--texto-suave)] mt-2 px-1">
              No hay productos activos que coincidan con «{query.trim()}».
            </p>
          )
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
                      En bodega {formatCantidad(p.stock)}
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

      {/* Cliente (0022): para la factura y el fiado. Sin precio propio (0032). */}
      <div className="px-3 pt-3">
        {cliente ? (
          <div className="flex items-center gap-2 tarjeta px-3 py-1.5">
            <span className="min-w-0 flex-1 text-sm">
              <strong className="font-semibold inline-flex items-center gap-1.5"><Icono nombre="clientes" tamano={16} className="text-marca-700" />{cliente.nombre}</strong>
              {cliente.rut && <span className="block text-xs text-[var(--texto-suave)] num">{cliente.rut}</span>}
            </span>
            <button onClick={() => setEligiendoCliente(true)} className="tap px-2 text-sm underline">Cambiar</button>
            <button onClick={() => elegirCliente(null)} aria-label="Quitar el cliente"
                    className="tap px-2 text-sm text-[var(--color-alerta)]">Quitar</button>
          </div>
        ) : (
          <button onClick={() => setEligiendoCliente(true)}
                  className="tap w-full px-3 rounded-xl border border-dashed border-[var(--borde)] text-sm text-[var(--texto-suave)] text-left">
            <span className="inline-flex items-center gap-2"><Icono nombre="clientes" tamano={18} /> Elegir cliente (para factura o fiado)</span>
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
                      {formatCLP(l.unitPrice)} {admiteDecimales(l.unidad) ? `el ${l.unidad}` : 'c/u'}
                      {typeof l.stockAvailable === 'number' && l.stockAvailable < l.quantity && (
                        <span className="text-[var(--color-aviso)]"> · en bodega {formatCantidad(Math.max(0, l.stockAvailable))}</span>
                      )}
                    </p>
                    <OfertaDeLinea linea={l} zona={config.zonaHoraria} />
                    {(l.discountAmount ?? 0) > 0 && (
                      <p className="text-xs font-medium text-marca-700 num">
                        ✂️ Descuento -{formatCLP(l.discountAmount ?? 0)}
                      </p>
                    )}
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
                    onClick={() => (l.quantity - 1 <= 0
                      ? quitarLinea(l)
                      : cambiarCarro((p) => setQuantity(p, l.productId, l.quantity - 1)))}
                    className="tap w-11 h-11 rounded-lg border border-[var(--borde)] text-xl font-bold active:bg-gray-100"
                  >
                    −
                  </button>
                  <CantidadDeLinea
                    linea={l}
                    onCambiar={(q) => cambiarCarro((p) => setQuantity(p, l.productId, q))}
                    onError={(texto) => notificar('error', texto)}
                  />
                  <button
                    aria-label={`Agregar una unidad de ${l.name}`}
                    onClick={() => {
                      cambiarCarro((p) => setQuantity(p, l.productId, l.quantity + 1));
                      // Lo mismo que al escanear: pasar el stock se dice ahora, no al cobrar.
                      if (typeof l.stockAvailable === 'number' && l.quantity + 1 > l.stockAvailable
                          && !puedeForzarStock && !config.venderSinStock) {
                        notificar('error', `${l.name}: el sistema tiene ${Math.max(0, l.stockAvailable)}. Así no se podrá cobrar`);
                      }
                    }}
                    className="tap w-11 h-11 rounded-lg border border-[var(--borde)] text-xl font-bold active:bg-gray-100"
                  >
                    +
                  </button>
                  <button
                    onClick={() => setDescontando(l)}
                    aria-label={`Descuento a ${l.name}`}
                    className="tap ml-auto px-3 text-sm underline"
                  >
                    Descuento
                  </button>
                  <button
                    onClick={() => quitarLinea(l)}
                    aria-label={`Quitar ${l.name} de la venta`}
                    className="tap px-3 text-sm text-[var(--color-alerta)]"
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
              {/* 12 panes y 0,35 kg de queso no suman "12,35 unidades". */}
              {lines.some((l) => !Number.isInteger(l.quantity))
                ? `${totals.itemCount} ${totals.itemCount === 1 ? 'producto' : 'productos'}`
                : `${totals.unitCount} ${totals.unitCount === 1 ? 'unidad' : 'unidades'}`}
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
              onClick={() => { setErrorCobro(null); if (faltaAutorizacion) setPidiendoAutorizacion(true); else setCobrando(true); }}
              className="tap flex-1 py-3.5 rounded-xl bg-marca-500 text-white font-bold text-base active:bg-marca-600"
            >
              {faltaAutorizacion ? 'Pedir autorización y cobrar' : 'Cobrar'}
            </button>
          </div>
        </div>
      )}

      {cobrando && (
        <Cobro
          total={totals.total}
          tarjetaEmiteDocumento={config.tarjetaEmiteDocumento}
          redondear={config.redondeoEfectivo}
          cliente={cliente}
          onCancel={() => { setCobrando(false); setErrorCobro(null); }}
          error={errorCobro}
          onConfirm={(payments, documento) =>
            confirmarVenta(payments, documento).catch((e) => { setErrorCobro(toUserMessage(e)); return false; })
          }
        />
      )}

      {descontando && (
        <DescuentoLinea
          linea={descontando}
          onCerrar={() => setDescontando(null)}
          onAplicar={(monto) => {
            cambiarCarro((p) => p.map((x) => (x.productId === descontando.productId ? { ...x, discountAmount: monto } : x)));
            setDescontando(null);
          }}
        />
      )}

      {pidiendoAutorizacion && (
        <PedirAutorizacion
          pct={pctDescuento}
          tope={topeDescuento}
          onCerrar={() => setPidiendoAutorizacion(false)}
          onAutorizado={(a) => { setAutorizacion(a); setPidiendoAutorizacion(false); setErrorCobro(null); setCobrando(true); }}
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
              onClick={() => { setLines([]); setAutorizacion(null); elegirCliente(null); setConfirmandoVaciar(false); }}
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
 * La cantidad de la línea, que se toca y se escribe: para 20 panes había que
 * tocar "+" 19 veces, y un producto por kilo no admitía 0,35 (hallazgo 4 del
 * flujo completo). Se confirma al salir del campo o con Enter; mientras se
 * escribe, el carrito no cambia, así que borrar para escribir no saca la línea.
 */
function CantidadDeLinea({ linea, onCambiar, onError }: {
  linea: CartLine;
  onCambiar: (cantidad: number) => void;
  onError: (texto: string) => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const decimales = admiteDecimales(linea.unidad);
  function confirmar() {
    if (texto === null) return;
    const v = validarCantidadVenta(texto, linea.unidad);
    setTexto(null);
    if (!v.valido) {
      onError(texto.trim() === '0'
        ? `Para sacar ${linea.name} de la venta, toca Quitar`
        : `${linea.name}: ${v.error}`);
      return;
    }
    // RF-M5-27 · 120 panes o 50 kg casi siempre es un dedo de más.
    if (v.valor !== linea.quantity && cantidadAtipica(v.valor, linea.unidad)
        && !window.confirm(`¿${formatCantidad(v.valor)} ${admiteDecimales(linea.unidad) ? linea.unidad : 'unidades'} de ${linea.name}? Es una cantidad poco común.`)) {
      return;
    }
    if (v.valor !== linea.quantity) onCambiar(v.valor);
  }
  return (
    <input
      type="text"
      inputMode={decimales ? 'decimal' : 'numeric'}
      enterKeyHint="done"
      aria-label={`Cantidad de ${linea.name}${decimales && linea.unidad ? `, en ${linea.unidad}` : ''}`}
      value={texto ?? formatCantidad(linea.quantity)}
      onFocus={(e) => { setTexto(formatCantidad(linea.quantity)); e.currentTarget.select(); }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { setTexto(null); e.currentTarget.blur(); }
      }}
      className="tap w-16 h-11 rounded-lg border border-[var(--borde)] text-center num font-semibold"
    />
  );
}

/**
 * Lo que la oferta le dice al cajero. Aplicada: cuánto se ahorra el cliente
 * (texto y color, RNF-46). Por aplicar: cuántas faltan para el siguiente
 * tramo, que es lo que el cajero le ofrece al cliente en voz alta.
 */
function OfertaDeLinea({ linea, zona }: { linea: CartLine; zona: string }) {
  if (linea.precioLista == null) return null;
  if (!linea.tramos?.length) return null;
  const lista = linea.precioLista;
  const vigentes = tramosVigentes(linea.tramos, diaLocal(new Date(), zona))
    .map((t) => ({ desde: t.desde, precio: precioDelTramo(t, lista) }))
    .filter((t) => t.precio < lista);
  const ahorro = Math.round((lista - linea.unitPrice) * linea.quantity);
  const siguiente = vigentes.find((t) => t.desde > linea.quantity && t.precio < linea.unitPrice);
  // "Por mayor" es una oferta desde 2 o más unidades; desde 1 es una
  // promoción. Lo que importa en el mostrador (Felipe, 2026-10-01): que se vea
  // desde cuántas rige, para que nadie lo pida llevando menos.
  const aplicado = [...vigentes].reverse().find((t) => t.desde <= linea.quantity && t.precio === linea.unitPrice);
  const porMayor = (aplicado?.desde ?? 1) > 1;
  return (
    <>
      {ahorro > 0 && (
        <p className="text-xs font-medium text-marca-700 num">🏷️ {porMayor ? `Precio por mayor (desde ${aplicado!.desde})` : 'Oferta aplicada'} · ahorra {formatCLP(ahorro)}</p>
      )}
      {siguiente && (
        <p className="text-xs text-[var(--texto-suave)] num">
          Por mayor desde {siguiente.desde}: llevando {siguiente.desde - linea.quantity} más, {formatCLP(siguiente.precio)} c/u
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
    || coincide(c.nombre, q)
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
                  {c.rut ?? 'sin RUT'}
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

/**
 * De cuándo son los precios del celular (RF-M5-29). Con más de un día, en
 * color de aviso: vendiendo sin internet, un precio viejo se cobra mal.
 */
function Frescura({ desde }: { desde: string | null }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60_000); return () => clearInterval(t); }, []);
  if (!desde) return null;
  const min = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 60_000));
  const texto = min < 2 ? 'recién' : min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.floor(min / 60)} h` : min < 2880 ? 'hace 1 día' : `hace ${Math.floor(min / 1440)} días`;
  const viejo = min >= 1440;
  return (
    <p className={`text-[11px] mt-1 ${viejo ? 'text-[var(--color-aviso)] font-medium' : 'text-[var(--texto-suave)]'}`}>
      Precios actualizados {texto}{viejo ? ' · conéctate a internet para traer los de hoy' : ''}
    </p>
  );
}
