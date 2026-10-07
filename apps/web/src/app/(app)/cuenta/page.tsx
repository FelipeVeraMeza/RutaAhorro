import Link from 'next/link';
import { exigirRol } from '@/lib/permisos';
import { Encabezado } from '@/components/Encabezado';
import { Icono } from '@/components/Icono';
import { NOMBRE_ROL, LEMA_ROL } from '@/lib/navegacion';
import { versionCompleta } from '@/lib/novedades';
import { PreferenciasCelular } from './PreferenciasCelular';
import { PinAutorizacion } from './PinAutorizacion';
import { MisDatos } from './MisDatos';

export const metadata = { title: 'Mi cuenta' };

/**
 * Mi cuenta (RF-M9-14): quién soy, mi contraseña y las preferencias de este
 * celular. Antes lo único personal era un ícono de llave en la cabecera.
 */
export default async function CuentaPage() {
  const user = await exigirRol(['admin', 'supervisor', 'vendedor', 'bodega']);
  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-4">
      <Encabezado titulo="Mi cuenta" icono="cuenta"
        descripcion="Tus datos, tu contraseña y cómo se ve el sistema en este celular." />

      <section className="tarjeta p-4" aria-labelledby="t-datos">
        <h2 id="t-datos" className="font-semibold mb-2">Tus datos</h2>
        <MisDatos nombre={user.fullName || ''} email={user.email} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm mt-4">
          <dt className="text-[var(--texto-suave)]">Rol</dt>
          <dd>{NOMBRE_ROL[user.role]} <span className="text-[var(--texto-suave)]">· {LEMA_ROL[user.role]}</span></dd>
          {user.maxDiscountPct > 0 && (<>
            <dt className="text-[var(--texto-suave)]">Descuento máx.</dt><dd className="num">{user.maxDiscountPct} %</dd>
          </>)}
        </dl>
        <p className="text-xs text-[var(--texto-suave)] mt-3">
          El rol y el descuento los cambia el administrador en Usuarios.
        </p>
        <Link href="/clave" className="btn btn-secundario mt-3 inline-flex items-center gap-2">
          <Icono nombre="clave" tamano={18} /> Cambiar mi contraseña
        </Link>
      </section>

      {/* RQ-17 · John y María José autorizan descuentos con su PIN (0036). */}
      {(user.role === 'admin' || user.role === 'supervisor') && (
        <PinAutorizacion yo={{ id: user.id, nombre: user.fullName || 'Sin nombre', tope: user.maxDiscountPct }} />
      )}

      <PreferenciasCelular />

      <section className="tarjeta p-4 text-sm" aria-labelledby="t-mas">
        <h2 id="t-mas" className="font-semibold mb-2">Más</h2>
        <ul className="space-y-2">
          <li><Link className="underline inline-flex items-center min-h-[44px]" href="/ayuda">Ayuda: cómo se hace cada cosa</Link></li>
          <li><Link className="underline inline-flex items-center min-h-[44px]" href="/novedades">Novedades</Link>
            <span className="text-[var(--texto-suave)] num"> · versión {versionCompleta()}</span></li>
        </ul>
      </section>
    </div>
  );
}
