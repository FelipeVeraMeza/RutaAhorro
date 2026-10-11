import Link from 'next/link';
import { Buscador } from '@/components/tienda/Catalogo';

/** RF-T80 · Un enlace viejo o mal copiado: buscar ahí mismo, sin volver atrás. */
export default function TiendaNoEncontrada() {
  return (
    <div className="max-w-xl mx-auto py-12 flex flex-col gap-4 text-center">
      <h1 className="text-xl font-bold">No encontramos lo que buscas</h1>
      <p className="text-[var(--texto-suave)]">Puede que el producto ya no esté a la venta, o que el enlace esté incompleto. Búscalo:</p>
      <Buscador accion="/tienda/productos" />
      <div className="flex gap-2 flex-wrap justify-center">
        <Link href="/tienda" className="btn btn-primario">Ver el catálogo</Link>
        <Link href="/tienda/categorias" className="btn btn-secundario">Categorías</Link>
        <Link href="/tienda/ofertas" className="btn btn-secundario">Ofertas</Link>
      </div>
    </div>
  );
}
