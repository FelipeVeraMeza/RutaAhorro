import type { MetadataRoute } from 'next';
import { sitioTienda } from '@/lib/tienda/sitio';

/**
 * RT-53 · Los buscadores entran a la tienda y a nada más. En el dominio de la
 * tienda todo es tienda; en el del sistema, solo /tienda (el resto son
 * pantallas con sesión que no tienen nada que hacer en Google).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { esDominioTienda, base } = await sitioTienda();
  // RNF-T62 · El carrito, la cuenta y el seguimiento de un pedido son de cada
  // persona: no se rastrean.
  const privadas = (prefijo: string) => ['carrito', 'cuenta', 'pedido/'].map((r) => `${prefijo}/${r}`);
  return esDominioTienda
    ? { rules: { userAgent: '*', allow: '/', disallow: [...privadas(''), '/api/'] }, sitemap: `${base}/sitemap.xml` }
    : { rules: { userAgent: '*', allow: '/tienda', disallow: ['/', ...privadas('/tienda')] }, sitemap: `${base.replace(/\/tienda$/, '')}/sitemap.xml` };
}
