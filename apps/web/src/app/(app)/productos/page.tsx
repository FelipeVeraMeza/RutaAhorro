import { getCurrentUser } from '@/lib/supabase/server';
import { ProductosClient } from './ProductosClient';

export const metadata = { title: 'Productos' };

export default async function ProductosPage() {
  const user = await getCurrentUser();

  // Permisos según la matriz del doc 02. La interfaz los refleja; la base de
  // datos los impone (RLS). Ocultar un botón no es seguridad.
  const rol = user!.role;
  return (
    <ProductosClient
      puedeVerCostos={rol === 'admin'}
      puedeEditar={rol === 'admin' || rol === 'supervisor' || rol === 'bodega'}
      puedeEliminar={rol === 'admin'}
    />
  );
}
