import type { Metadata } from 'next';
import Link from 'next/link';
import { formatCLP } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { sitioTienda } from '@/lib/tienda/sitio';

export async function generateMetadata(): Promise<Metadata> {
  const { base } = await sitioTienda();
  return { title: 'Cómo comprar', description: 'Cómo hacer un pedido, retirarlo y pagarlo, y cómo funcionan las ofertas.', alternates: { canonical: `${base}/ayuda` } };
}
export const dynamic = 'force-dynamic';

/** RF-T78 · Cómo se compra en la tienda, en preguntas cortas (y para Google, RNF-T63). */
export default async function AyudaPage() {
  const tienda = await datosTienda().catch(() => null);
  const pedidos = tienda?.pedidosActivos ?? false;
  const preguntas: Array<{ p: string; r: string }> = [
    pedidos
      ? { p: '¿Cómo hago un pedido?', r: 'Agrega productos al carrito, abre el carrito, escribe tu nombre y celular y toca "Hacer pedido". Te llega un número y un enlace para ver cómo va.' }
      : { p: '¿Cómo hago un pedido?', r: 'Agrega productos al carrito y envíalo por WhatsApp desde el carrito. También puedes comprar directo en el local.' },
    { p: '¿Cómo pago?', r: 'Pagas al retirar en el local, en efectivo o con tarjeta. Todavía no hay pago en línea.' },
    { p: '¿Hacen despacho?', r: 'Por ahora los pedidos se retiran en el local. Te avisamos al celular cuando el tuyo esté listo.' },
    { p: '¿Cómo funcionan las ofertas por cantidad?', r: 'Cuando llevas la cantidad de la oferta, el carrito cobra el precio rebajado en todas las unidades. El carrito te dice cuántas te faltan.' },
    { p: '¿Los precios son finales?', r: 'Los precios incluyen IVA. Pueden cambiar sin aviso: al hacer el pedido se confirman con los del local en ese momento.' },
    ...(tienda?.pedidoMinimo ? [{ p: '¿Hay un pedido mínimo?', r: `Sí, ${formatCLP(tienda.pedidoMinimo)}.` }] : []),
    { p: '¿Necesito una cuenta?', r: 'No. Tus datos y tus pedidos quedan guardados en tu celular para la próxima vez, y los puedes borrar cuando quieras en Mi cuenta.' },
    { p: '¿Cómo cancelo un pedido?', r: 'Escríbele al local por WhatsApp o llama con tu número de pedido.' },
  ];
  const { base } = await sitioTienda();
  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: preguntas.map((x) => ({ '@type': 'Question', name: x.p, acceptedAnswer: { '@type': 'Answer', text: x.r } })),
    url: `${base}/ayuda`,
  };
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-marca-900">Cómo comprar</h1>
      <div className="flex flex-col gap-2">
        {preguntas.map((x) => (
          <details key={x.p} className="tarjeta p-4 group">
            <summary className="font-bold cursor-pointer min-h-8 flex items-center">{x.p}</summary>
            <p className="mt-2 text-[var(--texto-suave)]">{x.r}</p>
          </details>
        ))}
      </div>
      <p>¿Otra duda? <Link href="/tienda/contacto" className="font-semibold text-marca-700 underline">Escríbele al local</Link>.</p>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq).replace(/</g, '\\u003c') }} />
    </div>
  );
}
