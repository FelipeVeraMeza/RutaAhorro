import type { MetadataRoute } from 'next';
import { categoriasDelCatalogo } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { sitioTienda } from '@/lib/tienda/sitio';

/**
 * RT-53 · Las páginas de la tienda y la ficha de cada producto, para Google.
 * RNF-T62 · También cada categoría y las páginas de ayuda y contacto (docs/33).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tienda = await datosTienda().catch(() => null);
  if (!tienda) return [];
  const { base } = await sitioTienda();
  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/productos`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${base}/ofertas`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${base}/categorias`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/contacto`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/ayuda`, changeFrequency: 'monthly', priority: 0.4 },
    ...categoriasDelCatalogo(tienda.catalogo).map((c) => ({
      url: `${base}/productos?categoria=${encodeURIComponent(c)}`, changeFrequency: 'daily' as const, priority: 0.6,
    })),
    ...tienda.catalogo.map((p) => ({ url: `${base}/p/${p.id}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
  ];
}
