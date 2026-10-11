import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DETALLE_ESTADO_PEDIDO, NOMBRE_ESTADO_PEDIDO, enlaceMapa, enlaceWhatsApp, estadoAtencion, formatCLP, type EstadoPedidoWeb,
} from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { seguimientoPedido } from '@/lib/tienda/seguimiento';
import { Icono } from '@/components/Icono';
import { RefrescarSolo } from '@/components/tienda/RefrescarSolo';
import { RecordarPedido } from '@/components/tienda/RecordarPedido';

export const dynamic = 'force-dynamic';

type Params = Promise<{ codigo: string }>;

// El seguimiento es de quien tiene el enlace: los buscadores no lo guardan.
export const metadata: Metadata = { title: 'Tu pedido', robots: { index: false, follow: false } };

const PASOS: EstadoPedidoWeb[] = ['recibido', 'preparando', 'listo', 'entregado'];

/**
 * RF-T50 · El seguimiento del pedido con su código (docs/33): en qué estado
 * va, qué lleva y dónde se retira. Se pone al día solo cada minuto mientras
 * no esté entregado o cancelado.
 */
export default async function SeguimientoPage({ params, searchParams }: { params: Params; searchParams: Promise<{ nuevo?: string }> }) {
  const { codigo } = await params;
  const [pedido, tienda] = await Promise.all([seguimientoPedido(codigo), datosTienda().catch(() => null)]);
  if (!pedido) notFound();
  const nuevo = (await searchParams).nuevo === '1';
  const final = pedido.estado === 'entregado' || pedido.estado === 'cancelado';
  const paso = PASOS.indexOf(pedido.estado);
  const fecha = (iso: string) => new Date(iso).toLocaleString('es-CL', {
    timeZone: tienda?.zona ?? 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const atencion = tienda ? estadoAtencion(tienda.horario, new Date(), tienda.zona) : null;
  const mapa = enlaceMapa(tienda?.direccion);
  const whatsapp = enlaceWhatsApp(tienda?.telefono, `Hola, consulto por mi pedido N° ${pedido.numero} (código ${pedido.codigo}).`);

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto w-full">
      <RecordarPedido codigo={pedido.codigo} numero={pedido.numero} total={pedido.total} fecha={pedido.creado} />
      {!final && <RefrescarSolo segundos={60} />}
      {nuevo && (
        <div role="status" className="rounded-2xl bg-exito/10 border border-exito/30 p-4 flex gap-3 items-start">
          <Icono nombre="listo" tamano={28} className="text-exito mt-0.5" />
          <div>
            <p className="text-lg font-extrabold">¡Listo, {pedido.nombre}! Recibimos tu pedido N° {pedido.numero}.</p>
            <p className="text-[var(--texto-suave)]">Te avisaremos al celular cuando esté listo. Guarda este enlace para ver cómo va.</p>
          </div>
        </div>
      )}

      <section className="tarjeta p-4 md:p-5 flex flex-col gap-4" aria-labelledby="t-pedido">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h1 id="t-pedido" className="text-2xl md:text-3xl font-extrabold tracking-tight">Pedido N° {pedido.numero}</h1>
          <p className="text-sm text-[var(--texto-suave)]">Código <strong className="num tracking-widest text-[var(--texto)]">{pedido.codigo}</strong></p>
        </div>

        <div>
          <p className={`text-xl font-bold ${pedido.estado === 'cancelado' ? 'text-alerta' : 'text-marca-700'}`}>{NOMBRE_ESTADO_PEDIDO[pedido.estado]}</p>
          <p className="text-[var(--texto-suave)]">{DETALLE_ESTADO_PEDIDO[pedido.estado]}</p>
          {pedido.estado === 'cancelado' && pedido.motivo && <p className="mt-1">Motivo: {pedido.motivo}</p>}
        </div>

        {pedido.estado !== 'cancelado' && (
          <ol className="grid grid-cols-4 gap-1" aria-label="Avance del pedido">
            {PASOS.map((e, i) => {
              const hecho = i <= paso;
              const cuando = pedido.historial.find((h) => h.estado === e)?.fecha;
              return (
                <li key={e} className="flex flex-col gap-1.5" aria-current={i === paso ? 'step' : undefined}>
                  <span className={`h-2 rounded-full ${hecho ? 'bg-marca-500' : 'bg-[var(--borde)]'}`} />
                  <span className={`text-xs md:text-sm ${hecho ? 'font-semibold' : 'text-[var(--texto-suave)]'}`}>
                    {NOMBRE_ESTADO_PEDIDO[e]}
                    {cuando && <span className="block font-normal text-[var(--texto-suave)]">{fecha(cuando)}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {!final && <p className="text-xs text-[var(--texto-suave)]">Esta página se pone al día sola cada minuto. <Link href={`/tienda/pedido/${pedido.codigo}`} className="underline">Actualizar ahora</Link></p>}
      </section>

      <section className="tarjeta p-4 md:p-5 flex flex-col gap-3" aria-labelledby="t-detalle">
        <h2 id="t-detalle" className="text-lg font-extrabold">Lo que pediste</h2>
        <ul className="divide-y divide-[var(--borde)]">
          {pedido.items.map((i) => (
            <li key={`${i.product_id}-${i.nombre}`} className="py-2 flex justify-between gap-3">
              <span className="min-w-0">
                <span className="num font-semibold">{i.cantidad} ×</span>{' '}
                {i.product_id ? <Link href={`/tienda/p/${i.product_id}`} className="hover:underline">{i.nombre}</Link> : i.nombre}
                <span className="block text-sm text-[var(--texto-suave)] num">
                  {formatCLP(i.precio_unitario)} c/u{i.precio_unitario < i.precio_lista && ` (antes ${formatCLP(i.precio_lista)})`}
                </span>
              </span>
              <span className="font-bold num shrink-0">{formatCLP(i.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-t border-[var(--borde)] pt-3">
          <span className="font-semibold">Total a pagar al retirar</span>
          <span className="text-2xl font-extrabold num">{formatCLP(pedido.total)}</span>
        </div>
        {pedido.ahorro > 0 && <p className="text-sm font-semibold text-exito num">Ahorras {formatCLP(pedido.ahorro)} con ofertas</p>}
        {pedido.nota && <p className="text-sm rounded-xl bg-[var(--fondo)] p-3">Tu nota: {pedido.nota}</p>}
        <p className="text-xs text-[var(--texto-suave)]">Hecho el {fecha(pedido.creado)}. Precios con IVA incluido.</p>
      </section>

      {tienda && (
        <section className="tarjeta p-4 md:p-5 flex flex-col gap-2" aria-labelledby="t-retiro">
          <h2 id="t-retiro" className="text-lg font-extrabold">Dónde se retira</h2>
          <p className="font-semibold">{tienda.nombre}</p>
          {tienda.direccion && <p className="flex items-center gap-2"><Icono nombre="ubicacion" tamano={18} /> {tienda.direccion}</p>}
          {atencion && <p className={`flex items-center gap-2 text-sm ${atencion.abierto ? 'text-exito' : 'text-[var(--texto-suave)]'}`}><Icono nombre="reloj" tamano={18} /> {atencion.texto}</p>}
          <div className="flex gap-2 flex-wrap mt-1">
            {mapa && <a href={mapa} target="_blank" rel="noopener noreferrer" className="btn btn-secundario btn-chico">Cómo llegar</a>}
            {whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-secundario btn-chico">Escribir al local</a>}
          </div>
        </section>
      )}

      <div className="flex gap-2 flex-wrap">
        <Link href="/tienda/productos" className="btn btn-primario">Seguir comprando</Link>
        <Link href="/tienda/cuenta" className="btn btn-secundario">Mis pedidos</Link>
      </div>
    </div>
  );
}
