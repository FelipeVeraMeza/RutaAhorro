import type { Metadata } from 'next';
import Link from 'next/link';
import { datosTienda } from '@/lib/tienda/catalogo';

export const metadata: Metadata = { title: 'Privacidad y datos personales', description: 'Qué datos usa la tienda, dónde quedan, cuánto tiempo y cómo pedir que se borren.' };
export const dynamic = 'force-dynamic';

/**
 * Política de privacidad de la tienda (RNF-T21, T26, T28, T29, T30; docs/31).
 *
 * Dice lo que el código hace hoy, ni más ni menos: los datos del cliente
 * quedan en su navegador y solo salen cuando él hace un pedido (en la tienda,
 * 0041, o por WhatsApp). Lo de los pedidos en la tienda aparece solo cuando el
 * local los tiene encendidos.
 * ⚠ Borrador técnico: el local debe revisarlo (idealmente con un abogado)
 * antes de publicar la tienda, y completar su RUT y correo de contacto.
 */
export default async function PrivacidadPage() {
  const tienda = await datosTienda().catch(() => null);
  const pedidos = tienda?.pedidosActivos ?? false;
  const local = tienda?.nombre ?? 'el local';
  const contacto = [tienda?.telefono && `al teléfono ${tienda.telefono}`, tienda?.direccion && `en ${tienda.direccion}`]
    .filter(Boolean).join(' o ') || 'directamente en el local';

  const h2 = 'text-lg font-extrabold mt-6 mb-2';
  return (
    <article className="tarjeta p-5 md:p-8 max-w-3xl mx-auto leading-relaxed">
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-marca-900">Privacidad y datos personales</h1>
      <p className="text-sm text-[var(--texto-suave)] mt-1">Vigente desde el 11 de octubre de 2026.</p>

      <h2 className={h2}>Quién es responsable</h2>
      <p>{local} es responsable de los datos que nos entregas en esta tienda. Puedes escribirnos {contacto}.</p>

      <h2 className={h2}>Qué datos usamos y para qué</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1.5">
        <li><strong>Nombre y celular</strong> (si los escribes en «Mi cuenta»): para saber a quién entregarle un pedido y poder contactarte por él.</li>
        <li><strong>Correo</strong> (opcional): para contactarte por tu pedido si lo prefieres al celular.</li>
        <li><strong>Carrito y pedidos enviados</strong>: para que no pierdas lo que elegiste y puedas repetir un pedido.</li>
      </ul>
      <p className="mt-2">No pedimos RUT, dirección ni datos de pago en esta tienda. No usamos cookies de seguimiento ni publicidad.</p>

      <h2 className={h2}>Dónde quedan</h2>
      <p>
        Tus datos de «Mi cuenta», tus favoritos y los productos que viste se guardan <strong>solo en tu celular o
        computador</strong> (en el almacenamiento de tu navegador). Nos llegan únicamente cuando haces un pedido:
      </p>
      <ul className="list-disc pl-5 flex flex-col gap-1.5 mt-2">
        {pedidos && (
          <li>
            Al tocar «Hacer pedido», guardamos en nuestro sistema tu nombre, tu celular, tu correo si lo escribiste, tu nota y lo
            que pediste. Los ve solo el personal del local que atiende los pedidos. El enlace de seguimiento muestra tu pedido
            y tu primer nombre, nunca tu celular ni tu correo.
          </li>
        )}
        <li>
          Al tocar «Enviar pedido por WhatsApp», se abre WhatsApp con el pedido, tu nombre y tu celular ya escritos, y tú
          decides si enviarlo. Desde ahí, la conversación queda en WhatsApp (un servicio de Meta) según sus propias condiciones.
        </li>
      </ul>

      <h2 className={h2}>Cuánto tiempo</h2>
      <p>
        En tu navegador, hasta que los borres: guardamos tus últimos 20 pedidos y hasta 100 favoritos.
        {pedidos && ' En nuestro sistema, tu nombre, celular, correo y nota se borran 12 meses después de que el pedido se entregó o se canceló; queda solo el pedido (productos y total), sin datos tuyos.'}
        {' '}Los pedidos que nos envías por WhatsApp los conservamos mientras sean necesarios para entregarlos, atender reclamos
        y cumplir obligaciones tributarias.
      </p>

      <h2 className={h2}>Tus derechos</h2>
      <p>
        Puedes pedirnos acceder a tus datos, corregirlos, eliminarlos u oponerte a su uso, conforme a la Ley 19.628 sobre
        protección de la vida privada y, desde diciembre de 2026, la Ley 21.719. Escríbenos {contacto}.
        Lo que está en tu navegador lo borras tú mismo en <Link href="/tienda/cuenta" className="underline">Mi cuenta → Borrar mis datos de este celular</Link>.
      </p>

      <h2 className={h2}>Otros servicios</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1.5">
        <li>La tienda funciona en servidores de Railway y Supabase: ahí están los productos, los precios y los pedidos que hagas en la tienda; no tus datos de «Mi cuenta».</li>
        <li>Algunas fotos de productos vienen de Open Food Facts. A ese servicio solo se le consulta el código de barras del producto, nunca datos tuyos.</li>
      </ul>
    </article>
  );
}
