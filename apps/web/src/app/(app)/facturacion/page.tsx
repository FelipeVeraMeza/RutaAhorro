import { exigirRol } from '@/lib/permisos';
import { FacturacionClient } from './FacturacionClient';

export const metadata = { title: 'Facturación' };

export default async function FacturacionPage() {
  // Los mismos que fn_emitir_factura_manual (0026). La boleta sigue en el POS.
  const user = await exigirRol(['admin', 'supervisor']);
  return <FacturacionClient esAdmin={user.role === 'admin'} usuarioId={user.id} />;
}
