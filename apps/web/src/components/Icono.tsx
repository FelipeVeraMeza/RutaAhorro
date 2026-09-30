/**
 * Íconos de la aplicación, en SVG y de un solo trazo.
 *
 * Antes la navegación usaba emoji (🏠 🛒 💰…): cada marca de celular los
 * dibuja distinto, algunos Android viejos muestran un cuadro vacío, y no
 * toman el color del texto, así que el ítem activo solo cambiaba la palabra.
 * Estos heredan `currentColor` y miden lo mismo en todos lados.
 *
 * Trazos al estilo de Lucide (ISC), redibujados para lo que usa la app.
 */

const TRAZOS = {
  inicio: 'M3 10.5 12 3l9 7.5|M5 9.5V21h14V9.5|M10 21v-6h4v6',
  vender: 'M2.5 3h2.2l2.4 11.2a2 2 0 0 0 2 1.6h8.3a2 2 0 0 0 2-1.5L21 7H6|c9,20,1.5|c18,20,1.5',
  caja: 'r2,6,20,12,2|c12,12,2.5|M6 12h.01|M18 12h.01',
  precio: 'M12.6 2.6a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z|c7.5,7.5,1.5',
  productos: 'M21 8 12 3 3 8v8l9 5 9-5z|M3 8l9 5 9-5|M12 13v8|m7.5 5.5 9 5',
  inventario: 'r5,4,14,17,2|M9 2h6v4H9z|M9 11h6|M9 15h6',
  proveedores: 'M3 6h11v10H3z|M14 9h4l3 3v4h-7|c7,18,2|c17,18,2',
  ventas: 'M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z|M9 8h6|M9 12h6|M9 16h3',
  clientes: 'r3,4,18,16,2|c9,11,2.5|M5.5 17a3.5 3.5 0 0 1 7 0|M15 10h3|M15 14h3',
  facturacion: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M8 13h8|M8 17h5',
  reportes: 'M3 3v18h18|M8 16v-5|M13 16V7|M18 16v-8',
  usuarios: 'c9,8,3.5|M2.5 20a6.5 6.5 0 0 1 13 0|M16 4.5a3.5 3.5 0 0 1 0 7|M18.5 14.5A6.5 6.5 0 0 1 21.5 20',
  configuracion: 'M4 6h10|M18 6h2|M4 12h4|M12 12h8|M4 18h12|c16,6,2|c10,12,2|c18,18,2',
  mas: 'M4 6h16|M4 12h16|M4 18h16',
  clave: 'c8,15,4|m11 12 9-9|M17 6l3 3|M14 9l2 2',
  salir: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|m16 17 5-5-5-5|M21 12H9',
  novedades: 'M12 3l1.8 4.9L19 9.5l-5.2 1.6L12 16l-1.8-4.9L5 9.5l5.2-1.6z|M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  descargar: 'M12 3v12|m7 10 5 5 5-5|M4 21h16',
  ayuda: 'c12,12,9|M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14|M12 17.5h.01',
  alerta: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z|M12 9v4|M12 17h.01',
  listo: 'M20 6 9 17l-5-5',
  escanear: 'M3 7V5a2 2 0 0 1 2-2h2|M17 3h2a2 2 0 0 1 2 2v2|M21 17v2a2 2 0 0 1-2 2h-2|M7 21H5a2 2 0 0 1-2-2v-2|M7 8v8|M10 8v8|M13 8v8|M17 8v8',
  compra: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z|M3 6h18|M16 10a4 4 0 0 1-8 0',
  agregar: 'M12 5v14|M5 12h14',
  volver: 'm15 18-6-6 6-6',
  copiar: 'r8,8,13,13,2|M4 16V5a2 2 0 0 1 2-2h11',
  subir: 'M12 21V9|m7 14 5-5 5 5|M4 3h16',
  bitacora: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z|m9 12 2 2 4-4',
  cuenta: 'c12,8,4|M4 21a8 8 0 0 1 16 0',
  candado: 'r5,11,14,10,2|M8 11V7a4 4 0 0 1 8 0v4',
} as const;

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({
  nombre, tamano = 20, className = '', titulo,
}: {
  nombre: NombreIcono;
  tamano?: number;
  className?: string;
  /** Si el ícono va solo (sin texto al lado), dice qué es. Si no, queda oculto al lector. */
  titulo?: string;
}) {
  return (
    <svg
      width={tamano} height={tamano} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={titulo ? undefined : true}
      role={titulo ? 'img' : undefined}
      aria-label={titulo}
      focusable="false"
    >
      {TRAZOS[nombre].split('|').map((t, i) => {
        if (t.startsWith('c')) {
          const [cx, cy, r] = t.slice(1).split(',').map(Number);
          return <circle key={i} cx={cx} cy={cy} r={r} />;
        }
        if (t.startsWith('r')) {
          const [x, y, w, h, rx] = t.slice(1).split(',').map(Number);
          return <rect key={i} x={x} y={y} width={w} height={h} rx={rx} />;
        }
        return <path key={i} d={t} />;
      })}
    </svg>
  );
}
