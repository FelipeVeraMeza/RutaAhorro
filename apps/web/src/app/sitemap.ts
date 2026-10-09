import type { MetadataRoute } from 'next';
import { datosTienda } from '@/lib/tienda/catalogo';
import { sitioTienda } from '@/lib/tienda/sitio';

/** RT-53 · Las páginas de la tienda y la ficha de cada producto, para Google. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tienda = await datosTienda().catch(() => null);
  if (!tienda) return [];
  const { base } = await sitioTienda();
  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/productos`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${base}/ofertas`, changeFrequency: 'daily', priority: 0.8 },
    ...tienda.catalogo.map((p) => ({ url: `${base}/p/${p.id}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
  ];
}
