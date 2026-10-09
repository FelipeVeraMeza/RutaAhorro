'use client';

/** Si la base no responde, el cliente ve esto y no la pantalla de error del sistema. */
export default function TiendaError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="text-center py-16">
      <h1 className="text-xl font-bold mb-2">No pudimos cargar la tienda</h1>
      <p className="text-[var(--texto-suave)] mb-5">Inténtalo de nuevo en un momento.</p>
      <button type="button" className="btn btn-primario" onClick={reset}>Reintentar</button>
    </div>
  );
}
