'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  calcularCarrito, diaLocal, enlaceWhatsApp, formatCLP, listaDeCompras, mensajePedido, proximaOferta, validarDatosCliente,
  type LineaCarritoTienda,
} from '@rutaahorro/core';
import {
  agregarAlCarrito, cambiarCantidad, carritoActualIds, sincronizarCarrito, useCarritoListo, vaciarCarrito, type ProductoAlDia,
} from '@/lib/tienda/carrito';
import { anotarPedido, useDatosCliente } from '@/lib/tienda/cliente';
import { ConfirmarPedido } from './ConfirmarPedido';

/**
 * El carrito (RT-20, RT-21). Con los pedidos en línea encendidos (0041,
 * docs/33) se confirma acá y queda en el sistema; si no, se envía por
 * WhatsApp con el detalle, el total y los datos de "Mi cuenta".
 *
 * Al abrirlo se pone al día con los precios de ahora (/api/tienda/productos):
 * el carrito guarda una copia del producto del momento en que se agregó.
 */
export function CarritoCliente({ telefono, direccion, pedidosActivos = false, pedidoMinimo = 0, zona = 'America/Santiago' }: {
  telefono: string | null; direccion: string | null; pedidosActivos?: boolean; pedidoMinimo?: number; zona?: string;
}) {
  const { valor: lineas, listo } = useCarritoListo();
  const { valor: cliente } = useDatosCliente();
  const [avisos, setAvisos] = useState<string[]>([]);
  // Después de mandar el pedido el carrito seguía lleno: volver a la tienda
  // mostraba lo mismo y era fácil mandarlo dos veces.
  const [enviado, setEnviado] = useState(false);
  const [nota, setNota] = useState('');
  // RF-T72 · "Quitar" por error se deshace con un toque.
  const [quitado, setQuitado] = useState<LineaCarritoTienda | null>(null);
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null);
  const sincronizado = useRef(false);
  const dia = diaLocal(new Date(), zona);
  const carrito = calcularCarrito(lineas, dia);
  const conDatos = Object.keys(validarDatosCliente(cliente)).length === 0;
  const whatsapp = carrito.lineas.length ? enlaceWhatsApp(telefono, mensajePedido(carrito, conDatos ? cliente : null, nota)) : null;

  const ponerAlDia = useCallback(() => {
    const ids = carritoActualIds();
    if (!ids.length) return;
    fetch(`/api/tienda/productos?ids=${ids.join(',')}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { productos: ProductoAlDia[] } | null) => { if (d) setAvisos(sincronizarCarrito(d.productos)); })
      .catch(() => { /* sin red: queda lo guardado, y el local confirma */ });
  }, []);

  useEffect(() => {
    if (!listo || sincronizado.current || !lineas.length) return;
    sincronizado.current = true;
    ponerAlDia();
    // RF-T39 · quien deja el carrito abierto y vuelve horas después, antes
    // de enviar el pedido: se pone al día otra vez al volver a la pestaña.
    let ultima = Date.now();
    const alVolver = () => {
      if (document.visibilityState === 'visible' && Date.now() - ultima > 30_000) { ultima = Date.now(); ponerAlDia(); }
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [listo, lineas.length, ponerAlDia]);

  function quitar(l: LineaCarritoTienda) {
    setQuitado(l);
    cambiarCantidad(l.id, 0);
  }

  async function copiarLista() {
    try {
      await navigator.clipboard.writeText(listaDeCompras(carrito));
      setCopiado('si');
    } catch {
      setCopiado('no');
    }
  }

  // Hasta leer el navegador no se sabe si hay algo: sin esto, un carrito
  // lleno decía "vacío" por un instante al abrirlo.
  if (!listo) return <div className="py-16" aria-busy />;

  if (!carrito.lineas.length) {
    return (
      <div className="text-center py-16 flex flex-col items-center gap-3">
        {avisos.map((a) => <p key={a} className="text-sm rounded-xl bg-[var(--fondo)] px-3 py-2">{a}</p>)}
        {quitado && (
          <p role="status" className="text-sm rounded-xl bg-[var(--fondo)] px-3 py-2">
            Sacaste {quitado.nombre}.{' '}
            <button type="button" className="font-semibold text-marca-700 underline min-h-11"
              onClick={() => { agregarAlCarrito(quitado, quitado.cantidad); setQuitado(null); }}>Deshacer</button>
          </p>
        )}
        <h1 className="text-2xl font-extrabold">Tu carrito está vacío</h1>
        <p className="text-[var(--texto-suave)]">Agrega productos desde el catálogo.</p>
        <div className="flex gap-2 flex-wrap justify-center">
          <Link href="/tienda/productos" className="btn btn-primario">Ver productos</Link>
          <Link href="/tienda/ofertas" className="btn btn-secundario">Ver ofertas</Link>
          <Link href="/tienda/cuenta#favoritos" className="btn btn-secundario">Mis favoritos</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="t-carrito">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h1 id="t-carrito" className="text-2xl md:text-3xl font-extrabold tracking-tight">Carrito</h1>
          <div className="flex gap-1">
            <button type="button" className="btn btn-fantasma btn-chico" onClick={() => void copiarLista()}>Copiar lista</button>
            <button type="button" className="btn btn-fantasma btn-chico"
              onClick={() => { if (confirm('¿Vaciar el carrito?')) vaciarCarrito(); }}>Vaciar</button>
          </div>
        </div>
        {copiado && (
          <p role="status" className="text-sm">
            {copiado === 'si' ? 'Lista copiada: pégala en un mensaje.' : 'No se pudo copiar en este navegador.'}
          </p>
        )}
        {quitado && (
          <p role="status" className="text-sm rounded-xl bg-[var(--fondo)] px-3 py-2">
            Sacaste {quitado.nombre}.{' '}
            <button type="button" className="font-semibold text-marca-700 underline min-h-11"
              onClick={() => { agregarAlCarrito(quitado, quitado.cantidad); setQuitado(null); }}>Deshacer</button>
          </p>
        )}
        {avisos.length > 0 && (
          <ul role="status" className="rounded-xl bg-[#fffbeb] border border-[#fde68a] p-3 text-sm flex flex-col gap-1">
            {avisos.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}
        <ul className="tarjeta divide-y divide-[var(--borde)]">
          {carrito.lineas.map((l) => {
            const prox = proximaOferta(l, dia);
            return (
              <li key={l.id} className="p-3 md:p-4 flex flex-col gap-2">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <Link href={`/tienda/p/${l.id}`} className="font-semibold hover:underline">{l.nombre}</Link>
                    <p className="text-sm text-[var(--texto-suave)] num">
                      {formatCLP(l.precioUnitario)} c/u
                      {l.conOferta && <span className="ml-2 font-semibold text-acento-700">con oferta (antes {formatCLP(l.precio)})</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 justify-between">
                    <div className="flex items-center gap-2" role="group" aria-label={`Cantidad de ${l.nombre}`}>
                      <button type="button" className="btn btn-secundario btn-chico px-0 w-11" aria-label={`Quitar uno de ${l.nombre}`}
                        onClick={() => (l.cantidad <= 1 ? quitar(l) : cambiarCantidad(l.id, l.cantidad - 1))}>−</button>
                      <span className="w-8 text-center font-bold num" aria-live="polite">{l.cantidad}</span>
                      <button type="button" className="btn btn-secundario btn-chico px-0 w-11" aria-label={`Agregar uno de ${l.nombre}`}
                        disabled={l.cantidad >= 99} onClick={() => cambiarCantidad(l.id, l.cantidad + 1)}>+</button>
                    </div>
                    <p className="w-24 text-right font-bold num">{formatCLP(l.subtotal)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  {prox ? (
                    <button type="button" onClick={() => cambiarCantidad(l.id, l.cantidad + prox.faltan)}
                      className="text-sm font-semibold text-acento-700 hover:underline text-left min-h-11">
                      Lleva {prox.faltan} más y paga {formatCLP(prox.precio)} c/u →
                    </button>
                  ) : <span />}
                  <button type="button" className="btn btn-fantasma btn-chico" onClick={() => quitar(l)}
                    aria-label={`Quitar ${l.nombre} del carrito`}>Quitar</button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="tarjeta p-4 flex flex-col gap-3 lg:sticky lg:top-24" aria-label="Resumen del pedido">
        <div className="flex items-baseline justify-between">
          <span className="text-[var(--texto-suave)]">{carrito.unidades} {carrito.unidades === 1 ? 'producto' : 'productos'}</span>
          <span className="text-3xl font-extrabold num">{formatCLP(carrito.total)}</span>
        </div>
        {carrito.ahorro > 0 && (
          <p className="text-sm font-semibold text-exito num">Ahorras {formatCLP(carrito.ahorro)} con ofertas</p>
        )}

        {pedidosActivos ? (
          <>
            <ConfirmarPedido carrito={carrito} direccion={direccion} pedidoMinimo={pedidoMinimo}
              notaInicial={nota} onNota={setNota} onPonerAlDia={ponerAlDia} />
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="text-sm text-center font-semibold text-marca-700 underline min-h-11 grid place-items-center"
                onClick={() => anotarPedido({ fecha: new Date().toISOString(), lineas, total: carrito.total })}>
                O envíalo por WhatsApp
              </a>
            )}
          </>
        ) : (
          <>
            <div className="text-sm rounded-xl bg-[var(--fondo)] p-3">
              {conDatos ? (
                <p>Pide <strong>{cliente.nombre}</strong> · {cliente.celular} · <Link href="/tienda/cuenta" className="text-marca-700 font-semibold hover:underline">cambiar</Link></p>
              ) : (
                <p><Link href="/tienda/cuenta" className="text-marca-700 font-semibold hover:underline">Deja tu nombre y celular</Link> para que el local sepa a quién entregarle el pedido.</p>
              )}
            </div>
            {whatsapp && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">Nota para el local (opcional)</span>
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300}
                  className="w-full min-h-20 px-3 py-2 rounded-xl border border-[var(--borde)] bg-[var(--superficie)]" />
              </label>
            )}
            {whatsapp ? (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-acento btn-grande"
                onClick={() => { anotarPedido({ fecha: new Date().toISOString(), lineas, total: carrito.total }); setEnviado(true); }}>
                Enviar pedido por WhatsApp
              </a>
            ) : (
              <p className="text-sm rounded-xl bg-acento-50 p-3">
                Pronto podrás pedir en línea. Por ahora, compra estos productos en el local{direccion ? `: ${direccion}` : ''}.
              </p>
            )}
            {enviado && (
              <div role="status" className="text-sm rounded-xl bg-[var(--fondo)] p-3 flex flex-col gap-2">
                <p>¿Ya enviaste el mensaje? El pedido quedó en Mi cuenta → Mis pedidos.</p>
                <button type="button" className="btn btn-secundario btn-chico" onClick={() => { vaciarCarrito(); setEnviado(false); }}>
                  Sí, vaciar el carrito
                </button>
              </div>
            )}
          </>
        )}
        <p className="text-xs text-[var(--texto-suave)]">
          Total estimado con IVA incluido. El local confirma precios y disponibilidad.
        </p>
        <Link href="/tienda/productos" className="btn btn-secundario">Seguir comprando</Link>
      </aside>
    </div>
  );
}
