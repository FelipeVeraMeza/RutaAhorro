import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { OfertasMasivasClient } from './OfertasMasivasClient';

export const metadata = { title: 'Ofertas' };

export default async function OfertasPage() {
  if (DEMO_ACTIVO) return <OfertasMasivasClient esAdmin />;

  const user = await getCurrentUser();
  const rol = user!.role;

  // Los mismos que editan las ofertas de un producto (fn_guardar_precios_producto).
  // La base lo vuelve a comprobar en fn_aplicar_oferta_masiva.
  if (rol !== 'admin' && rol !== 'supervisor') redirect('/productos');

  return <OfertasMasivasClient esAdmin={rol === 'admin'} />;
}
