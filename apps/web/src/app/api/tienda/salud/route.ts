import { datosTienda } from '@/lib/tienda/catalogo';

/**
 * GET /api/tienda/salud — para el monitor de disponibilidad (RNF-T41, p. ej.
 * UptimeRobot cada 5 minutos). 200 si la tienda lee su catálogo; 503 si no.
 * No dice nada interno: cuántos productos y si recibe pedidos.
 */
export async function GET() {
  const sinCache = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  try {
    const t = await datosTienda();
    if (!t) return Response.json({ ok: false, motivo: 'sin tienda' }, { status: 503, headers: sinCache });
    return Response.json({ ok: true, productos: t.catalogo.length, pedidos: t.pedidosActivos, en: new Date().toISOString() }, { headers: sinCache });
  } catch {
    return Response.json({ ok: false, motivo: 'la base no responde' }, { status: 503, headers: sinCache });
  }
}
