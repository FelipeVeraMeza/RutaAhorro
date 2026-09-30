export const dynamic = 'force-dynamic';

/**
 * Qué versión está publicada ahora (RNF-66). Una pestaña abierta desde antes
 * del despliegue la compara con la suya y ofrece actualizar.
 */
export function GET() {
  return Response.json(
    { commit: process.env.NEXT_PUBLIC_COMMIT ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
