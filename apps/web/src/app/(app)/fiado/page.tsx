import { redirect } from 'next/navigation';

// El local no fía (Felipe, 2026-10-07): Fiado salió del menú y de la ayuda.
// La pantalla queda en FiadoClient por si algún día se vuelve a usar; la
// dirección vieja lleva al inicio en vez de mostrar un módulo que no existe.
export default function FiadoPage() {
  redirect('/');
}
