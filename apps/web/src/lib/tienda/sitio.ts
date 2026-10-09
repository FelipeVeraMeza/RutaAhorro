import { headers } from 'next/headers';

/**
 * Dónde vive la tienda, visto desde la petición: en su dominio propio
 * (`NEXT_PUBLIC_TIENDA_HOST`) las direcciones no llevan "/tienda"; en el
 * dominio del sistema, sí. Para robots.txt, el sitemap y los datos para
 * Google, que necesitan direcciones completas.
 */
export async function sitioTienda(): Promise<{ esDominioTienda: boolean; base: string }> {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim().toLowerCase();
  const sinPuerto = host.replace(/:\d+$/, '');
  const dominio = process.env.NEXT_PUBLIC_TIENDA_HOST?.trim().toLowerCase();
  const esDominioTienda = Boolean(dominio) && (sinPuerto === dominio || sinPuerto === `www.${dominio}`);
  const protocolo = h.get('x-forwarded-proto') ?? (sinPuerto === 'localhost' ? 'http' : 'https');
  const origen = host ? `${protocolo}://${host}` : (process.env.NEXT_PUBLIC_APP_URL ?? '');
  return { esDominioTienda, base: esDominioTienda ? origen : `${origen}/tienda` };
}
