'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  calcularCarrito, diaLocal, enlaceWhatsApp, formatCLP, mensajePedido, proximaOferta, validarDatosCliente,
} from '@rutaahorro/core';
import { cambiarCantidad, sincronizarCarrito, useCarritoListo, vaciarCarrito, type ProductoAlDia } from '@/lib/tienda/carrito';
import { anotarPedido, useDatosCliente } from '@/lib/tienda/cliente';

/**
 * El carrito (RT-20, RT-21). Mientras no exista el pedido con pago en línea
 * (etapas 2 y 3 de docs/30), se envía por WhatsApp con el detalle, el total y
 * los datos de "Mi cuenta", y queda anotado en "Mis pedidos".
 *
 * Al abrirlo se pone al día con los precios de ahora (/api/tienda/productos):
 * el carrito guarda una copia del producto del momento en que se agregó.
 */
export function CarritoCliente({ telefono, direccion }: { telefono: string | null; direccion: string | null }) {
  const { valor: lineas, listo } = useCarritoListo();
  const { valor: cliente } = useDatosCliente();
  const [avisos, setAvisos] = useState<string[]>([]);
  const sincronizado = useRef(false);
  const dia = diaLocal(new Date(), 'America/Santiago');
  const carrito = calcularCarrito(lineas, dia);
  const conDatos = Object.keys(validarDatosCliente(cliente)).length === 0;
  const whatsapp = carrito.lineas.length ? enlaceWhatsApp(telefono, mensajePedido(carrito, conDatos ? cliente : null)) : null;

  useEffect(() => {
    if (!listo || sincronizado.current || !lineas.length) return;
    sincronizado.current = true;
    fetch(`/api/tienda/productos?ids=${lineas.map((l) => l.id).join(',')}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { productos: ProductoAlDia[] } | null) => { if (d) setAvisos(sincronizarCarrito(d.productos)); })
      .catch(() => { /* sin red: queda lo guardado, y el local confirma */ });
  }, [listo, lineas]);

  // Hasta leer el navegador no se sabe si hay algo: sin esto, un carrito
  // lleno decía "vacío" por un instante al abrirlo.
  if (!listo) return <div className="py-16" aria-busy />;

  if (!carrito.lineas.length) {
    return (
      <div className="text-center py-16 flex flex-col items-center gap-3">
        {avisos.map((a) => <p key={a} className="text-sm rounded-xl bg-[var(--fondo)] px-3 py-2">{a}</p>)}
        <h1 className="text-2xl font-extrabold">Tu carrito está vacío</h1>
        <p className="text-[var(--texto-suave)]">Agrega productos desde el catálogo.</p>
        <div className="flex gap-2 flex-wrap justify-center">
          <Link href="/tienda/productos" className="btn btn-primario">Ver productos</Link>
          <Link href="/tienda/ofertas" className="btn btn-secundario">Ver ofertas</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_340px] lg:items-start lg:gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Carrito</h1>
          <button type="button" className="btn btn-fantasma btn-chico"
            onClick={() => { if (confirm('¿Vaciar el carrito?')) vaciarCarrito(); }}>Vaciar</button>
        </div>
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
                      <button type="button" className="btn btn-secundario btn-chico px-0 w-11" aria-label="Quitar uno"
                        onClick={() => cambiarCantidad(l.id, l.cantidad - 1)}>−</button>
                      <span className="w-8 text-center font-bold num">{l.cantidad}</span>
                      <button type="button" className="btn btn-secundario btn-chico px-0 w-11" aria-label="Agregar uno"
                        onClick={() => cambiarCantidad(l.id, l.cantidad + 1)}>+</button>
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
                  <button type="button" className="btn btn-fantasma btn-chico" onClick={() => cambiarCantidad(l.id, 0)}
                    aria-label={`Quitar ${l.nombre} del carrito`}>Quitar</button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="tarjeta p-4 flex flex-col gap-3 lg:sticky lg:top-24">
        <div className="flex items-baseline justify-between">
          <span className="text-[var(--texto-suave)]">{carrito.unidades} {carrito.unidades === 1 ? 'producto' : 'productos'}</span>
          <span className="text-3xl font-extrabold num">{formatCLP(carrito.total)}</span>
        </div>
        {carrito.ahorro > 0 && (
          <p className="text-sm font-semibold text-exito num">Ahorras {formatCLP(carrito.ahorro)} con ofertas</p>
        )}

        <div className="text-sm rounded-xl bg-[var(--fondo)] p-3">
          {conDatos ? (
            <p>Pide <strong>{cliente.nombre}</strong> · {cliente.celular} · <Link href="/tienda/cuenta" className="text-marca-700 font-semibold hover:underline">cambiar</Link></p>
          ) : (
            <p><Link href="/tienda/cuenta" className="text-marca-700 font-semibold hover:underline">Deja tu nombre y celular</Link> para que el local sepa a quién entregarle el pedido.</p>
          )}
        </div>

        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-acento btn-grande"
            onClick={() => anotarPedido({ fecha: new Date().toISOString(), lineas, total: carrito.total })}>
            Enviar pedido por WhatsApp
          </a>
        ) : (
          <p className="text-sm rounded-xl bg-acento-50 p-3">
            Pronto podrás pagar en línea. Por ahora, compra estos productos en el local{direccion ? `: ${direccion}` : ''}.
          </p>
        )}
        <p className="text-xs text-[var(--texto-suave)]">
          Total estimado con IVA incluido. El local confirma precios y disponibilidad.
        </p>
        <Link href="/tienda/productos" className="btn btn-secundario">Seguir comprando</Link>
      </aside>
    </div>
  );
}
