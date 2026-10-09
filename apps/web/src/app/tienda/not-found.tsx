import Link from 'next/link';

export default function TiendaNoEncontrada() {
  return (
    <div className="text-center py-16">
      <h1 className="text-xl font-bold mb-2">No encontramos lo que buscas</h1>
      <p className="text-[var(--texto-suave)] mb-5">Puede que el producto ya no esté a la venta.</p>
      <Link href="/tienda" className="btn btn-primario">Ver el catálogo</Link>
    </div>
  );
}
