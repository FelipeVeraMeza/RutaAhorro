import { datosTienda } from '@/lib/tienda/catalogo';
import { ipDe, limitar } from '@/lib/limites';

/**
 * GET /api/tienda/productos?ids=a,b,c — los productos del carrito como están
 * AHORA (precio, ofertas, si hay, si sigue a la venta).
 *
 * El carrito guarda una copia del producto al agregarlo; sin esto, un precio
 * que subió o un producto que se desactivó seguía en el carrito como estaba.
 * Público como la tienda: devuelve lo mismo que ya muestran sus páginas.
 */
const MAX_IDS = 100;

export async function GET(request: Request) {
  const limite = limitar('tienda', ipDe(request));
  if (limite) return limite;
  const ids = (new URL(request.url).searchParams.get('ids') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_IDS);
  const tienda = await datosTienda().catch(() => null);
  if (!tienda) return Response.json({ error: { code: 'TIENDA_CERRADA', message: 'La tienda no está abierta' } }, { status: 503 });
  const pedidos = new Set(ids);
  const productos = tienda.catalogo
    .filter((p) => pedidos.has(p.id))
    .map(({ id, nombre, precio, tramos, disponible }) => ({ id, nombre, precio, tramos, disponible }));
  return Response.json({ productos }, { headers: { 'Cache-Control': 'no-store' } });
}
