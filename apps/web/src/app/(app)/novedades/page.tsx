import { exigirRol } from '@/lib/permisos';
import { Encabezado } from '@/components/Encabezado';
import { NOVEDADES, versionCompleta } from '@/lib/novedades';
import { NOMBRE_ROL } from '@/lib/navegacion';

export const metadata = { title: 'Novedades' };

/** Versión instalada y qué cambió (RF-M9-09). Cada rol ve lo que le toca. */
export default async function NovedadesPage() {
  const user = await exigirRol(['admin', 'supervisor', 'vendedor', 'bodega']);
  // El supervisor también vende y recibe mercadería (Vender, Caja, Recibir):
  // antes solo veía lo marcado "supervisor" y no se enteraba de cambios en el
  // mostrador como el descuento con PIN. El admin ve todo.
  const ve = (para: string) => para === 'todos' || user.role === 'admin' || para === user.role
    || (user.role === 'supervisor' && (para === 'vendedor' || para === 'bodega'));
  return (
    <div className="px-4 py-5 max-w-2xl mx-auto">
      <Encabezado
        titulo="Novedades"
        icono="novedades"
        descripcion="Qué cambió en el sistema, empezando por lo más reciente."
        detalle={`Versión instalada: ${versionCompleta()}`}
      />
      <ol className="space-y-4">
        {NOVEDADES.map((n, i) => {
          const cambios = n.cambios.filter((c) => ve(c.para));
          if (cambios.length === 0) return null;
          return (
            <li key={n.version} className="tarjeta p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <h2 className="font-semibold">{n.titulo}</h2>
                <span className="text-xs text-[var(--texto-suave)] num">
                  {i === 0 && <span className="insignia insignia-ok mr-2">Instalada</span>}
                  {n.version} · {n.fecha.split('-').reverse().join('-')}
                </span>
              </div>
              <ul className="space-y-1.5 text-sm">
                {cambios.map((c) => (
                  <li key={c.texto} className="flex gap-2">
                    <span className="insignia insignia-neutra shrink-0 h-fit">
                      {c.para === 'todos' ? 'Todos' : NOMBRE_ROL[c.para]}
                    </span>
                    <span>{c.texto}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
