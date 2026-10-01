import { exigirRol } from '@/lib/permisos';
import { RecepcionClient } from './RecepcionClient';

export const metadata = { title: 'Recibir mercadería' };

export default async function RecepcionPage() {
  const user = await exigirRol(['admin', 'supervisor', 'bodega']);
  // Pagar con la plata de la caja y anotar la factura en el libro de compras
  // son de admin y supervisor (fn_pagar_factura_proveedor, 0030;
  // fn_registrar_factura_recibida, 0026). Bodega recibe y deja la factura por pagar.
  return <RecepcionClient usuarioId={user.id} puedePagar={user.role !== 'bodega'} />;
}
