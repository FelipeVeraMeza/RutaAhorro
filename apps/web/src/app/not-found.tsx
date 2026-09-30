import Link from 'next/link';

export const metadata = { title: 'Página no encontrada' };

export default function NoEncontrada() {
  return (
    <main className="min-h-dvh grid place-items-center px-6 text-center">
      <div className="max-w-sm">
        <p className="text-5xl font-bold text-marca-500 mb-2 num">404</p>
        <h1 className="text-lg font-bold mb-1">No encontramos esta página</h1>
        <p className="text-sm text-[var(--texto-suave)] mb-5">
          Puede que el enlace esté mal escrito o que la sección se haya movido.
        </p>
        <Link href="/" className="btn btn-primario w-full">Ir a mi pantalla de inicio</Link>
      </div>
    </main>
  );
}
