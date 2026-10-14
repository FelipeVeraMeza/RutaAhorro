import { datosTienda } from '@/lib/tienda/catalogo';
import { ipDe, limitar } from '@/lib/limites';

/**
 * GET /api/tienda/productos?ids=a,b,c — los productos del carrito como están
 * AHORA (precio, ofertas, si hay, si sigue a la venta).
 *
 * El carrito guarda una copia del producto al agregarlo; sin esto, un precio
 * que subió o un producto que se desactivó seguía en el carrito como estaba.
 * Público como la tienda: devuelve lo mismo que ya muestran sus páginas.
 *
 * Con `completo=1` devuelve la ficha pública entera, para Favoritos y
 * "Vistos hace poco" (docs/33): nunca el costo ni el stock exacto.
 */
const MAX_IDS = 100;
// Solo id de producto (o los de la maqueta): lo demás se descarta sin buscarlo.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^p\d{1,4}$/i;

export async function GET(request: Request) {
  const limite = limitar('tienda', ipDe(request));
  if (limite) return limite;
  const url = new URL(request.url);
  const ids = (url.searchParams.get('ids') ?? '').slice(0, 4000)
    .split(',').map((s) => s.trim()).filter((s) => ID.test(s)).slice(0, MAX_IDS);
  const completo = url.searchParams.get('completo') === '1';
  const tienda = await datosTienda().catch(() => null);
  if (!tienda) return Response.json({ error: { code: 'TIENDA_CERRADA', message: 'La tienda no está abierta' } }, { status: 503 });
  // En el orden pedido: Favoritos y Vistos los muestran como el cliente los guardó.
  const porId = new Map(tienda.catalogo.map((p) => [p.id, p]));
  const productos = ids.map((id) => porId.get(id)).filter((p) => p != null)
    .map((p) => (completo ? p : { id: p.id, nombre: p.nombre, precio: p.precio, tramos: p.tramos, disponible: p.disponible }));
  return Response.json({ productos }, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
