import type { MetadataRoute } from 'next';
import { sitioTienda } from '@/lib/tienda/sitio';

/**
 * RT-53 · Los buscadores entran a la tienda y a nada más. En el dominio de la
 * tienda todo es tienda; en el del sistema, solo /tienda (el resto son
 * pantallas con sesión que no tienen nada que hacer en Google).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { esDominioTienda, base } = await sitioTienda();
  return esDominioTienda
    ? { rules: { userAgent: '*', allow: '/' }, sitemap: `${base}/sitemap.xml` }
    : { rules: { userAgent: '*', allow: '/tienda', disallow: '/' }, sitemap: `${base.replace(/\/tienda$/, '')}/sitemap.xml` };
}
