import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { FacturacionClient } from './FacturacionClient';

export const metadata = { title: 'Facturación' };

export default async function FacturacionPage() {
  if (DEMO_ACTIVO) return <FacturacionClient esAdmin usuarioId="demo" />;
  const user = await getCurrentUser();
  // Los mismos que fn_emitir_factura_manual (0026). La boleta sigue en el POS.
  if (user!.role !== 'admin' && user!.role !== 'supervisor') redirect('/');
  return <FacturacionClient esAdmin={user!.role === 'admin'} usuarioId={user!.id} />;
}
