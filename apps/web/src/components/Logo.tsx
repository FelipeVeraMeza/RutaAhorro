/**
 * Logo de RutaAhorro, plano (2026-10-07).
 *
 * Es la versión para pantalla del logo 3D que trajo el cliente: la "R" blanca
 * en el cuadro naranjo, con las tres líneas de velocidad, y "Ruta Ahorro" en
 * dos líneas. En SVG para que se vea nítido a 32 px en el celular y a 200 px
 * en el login; el render 3D, con sombras y bordes difuminados, se ve borroso
 * en chico y no tiene fondo transparente.
 *
 * `sobre`: el fondo donde va. En azul marino el texto es blanco; en claro, marino.
 */
export function LogoMarca({ tamano = 36, className = '' }: { tamano?: number; className?: string }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 48 48" aria-hidden className={className}>
      {/* Líneas de velocidad, detrás del cuadro */}
      <rect x="1" y="14" width="14" height="5" rx="2.5" fill="#FF8A2A" />
      <rect x="3" y="21.5" width="12" height="5" rx="2.5" fill="#FF8A2A" />
      <rect x="5" y="29" width="10" height="5" rx="2.5" fill="#FF8A2A" />
      <rect x="10" y="4" width="36" height="40" rx="9" fill="#FF6A00" />
      <rect x="14.5" y="8.5" width="27" height="31" rx="5.5" fill="#FFFFFF" />
      {/* La R: asta, panza y pierna */}
      <path
        d="M20 14h9.2c4.2 0 7 2.6 7 6.3 0 2.8-1.6 4.9-4.1 5.8l4.6 7.9h-5.2l-4-7.2h-2.9V34H20V14zm4.6 4.1v5h4.3c1.6 0 2.6-1 2.6-2.5s-1-2.5-2.6-2.5h-4.3z"
        fill="#FF6A00"
      />
    </svg>
  );
}

export function Logo({
  sobre = 'oscuro', tamano = 36, conTexto = true, className = '',
}: { sobre?: 'oscuro' | 'claro'; tamano?: number; conTexto?: boolean; className?: string }) {
  const texto = sobre === 'oscuro' ? 'text-white' : 'text-marca-900';
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMarca tamano={tamano} />
      {conTexto && (
        <span className={`font-extrabold leading-[0.95] tracking-tight ${texto}`} style={{ fontSize: tamano * 0.42 }}>
          Ruta<br />Ahorro
        </span>
      )}
      {!conTexto && <span className="sr-only">RutaAhorro</span>}
    </span>
  );
}
