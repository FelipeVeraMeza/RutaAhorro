import { NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@supabase/supabase-js';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

/**
 * El PDF que entregó el SII por una factura emitida en el portal (0026).
 *
 * El bucket `facturas` es privado. La factura se lee con la sesión del
 * usuario, así RLS decide si la puede ver (admin o supervisor de ese local);
 * recién entonces se firma un enlace de 5 minutos con la llave de servicio.
 */
export async function GET(request: Request) {
  const actor = await getCurrentUser();
  if (!actor || !actor.isActive || (actor.role !== 'admin' && actor.role !== 'supervisor')) {
    return NextResponse.json({ error: { code: 'SIN_PERMISO', message: 'Sin permiso' } }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const sesion = await createClient();
  const { data: f } = await sesion.from('facturas').select('pdf_path').eq('id', id).maybeSingle();
  if (!f?.pdf_path) {
    return NextResponse.json({ error: { code: 'NO_ENCONTRADO', message: 'Esa factura no tiene PDF del SII' } }, { status: 404 });
  }
  const secreto = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto) return NextResponse.json({ error: { code: 'SIN_CONFIGURAR', message: 'Servidor sin configurar' } }, { status: 500 });
  const admin = createServerSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, secreto, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.storage.from('facturas').createSignedUrl(f.pdf_path as string, 300);
  if (error || !data) return NextResponse.json({ error: { code: 'NO_ENCONTRADO', message: 'El PDF no está disponible' } }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
