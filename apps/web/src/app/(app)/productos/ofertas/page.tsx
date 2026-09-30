import { exigirRol } from '@/lib/permisos';
import { OfertasMasivasClient } from './OfertasMasivasClient';

export const metadata = { title: 'Ofertas' };

export default async function OfertasPage() {
  // Los mismos que editan las ofertas de un producto (fn_guardar_precios_producto).
  // La base lo vuelve a comprobar en fn_aplicar_oferta_masiva.
  const user = await exigirRol(['admin', 'supervisor']);
  return <OfertasMasivasClient esAdmin={user.role === 'admin'} />;
}
