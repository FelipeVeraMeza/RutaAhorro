import type { Metadata } from 'next';
import { enlaceMapa, enlaceWhatsApp, estadoAtencion, resumenHorario } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { sitioTienda } from '@/lib/tienda/sitio';
import { TiendaCerrada } from '@/components/tienda/Catalogo';
import { Icono } from '@/components/Icono';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { base } = await sitioTienda();
  return { title: 'Contacto y horario', description: 'Dirección, horario de atención y WhatsApp del local.', alternates: { canonical: `${base}/contacto` } };
}

/** RF-T69 y RF-T71 · Dónde está el local, cuándo abre y cómo escribirle. */
export default async function ContactoPage() {
  const tienda = await datosTienda().catch(() => null);
  if (!tienda) return <TiendaCerrada />;
  const atencion = estadoAtencion(tienda.horario, new Date(), tienda.zona);
  const horario = resumenHorario(tienda.horario);
  const mapa = enlaceMapa(tienda.direccion);
  const whatsapp = enlaceWhatsApp(tienda.telefono, `Hola, tengo una consulta para ${tienda.nombre}.`);
  const { base } = await sitioTienda();
  // RNF-T63 · El local para Google: nombre, dirección y horario.
  const negocio = {
    '@context': 'https://schema.org', '@type': 'GroceryStore', name: tienda.nombre, url: base,
    ...(tienda.direccion ? { address: { '@type': 'PostalAddress', streetAddress: tienda.direccion, addressCountry: 'CL' } } : {}),
    ...(tienda.telefono ? { telephone: tienda.telefono } : {}),
  };

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-marca-900">Contacto y horario</h1>
      <section className="tarjeta p-4 md:p-5 flex flex-col gap-3">
        <p className="text-lg font-bold">{tienda.nombre}</p>
        {tienda.direccion && <p className="flex items-start gap-2"><Icono nombre="ubicacion" tamano={20} className="mt-0.5" /> {tienda.direccion}</p>}
        {atencion && <p className={`flex items-center gap-2 font-semibold ${atencion.abierto ? 'text-exito' : 'text-[var(--texto-suave)]'}`}><Icono nombre="reloj" tamano={20} /> {atencion.texto}</p>}
        <div className="flex gap-2 flex-wrap">
          {mapa && <a href={mapa} target="_blank" rel="noopener noreferrer" className="btn btn-primario">Cómo llegar</a>}
          {whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-secundario">Escribir por WhatsApp</a>}
        </div>
        {!tienda.direccion && !whatsapp && <p className="text-[var(--texto-suave)]">El local todavía no publica su dirección ni su WhatsApp.</p>}
      </section>
      {horario.length > 0 && (
        <section className="tarjeta p-4 md:p-5" aria-labelledby="t-horario">
          <h2 id="t-horario" className="text-lg font-extrabold mb-2">Horario de atención</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            {horario.map((h) => <div key={h.dias} className="contents"><dt className="font-semibold">{h.dias}</dt><dd className="num">{h.horas}</dd></div>)}
          </dl>
        </section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(negocio).replace(/</g, '\\u003c') }} />
    </div>
  );
}
