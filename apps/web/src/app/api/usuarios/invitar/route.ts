import { NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/supabase/server';
import { autorizarCuenta, retirarAutorizacion } from '@/lib/supabase/admin';

/**
 * Invitación de empleados (RF-M1-12).
 *
 * Vive en el servidor porque crear usuarios en Supabase Auth exige la llave de
 * servicio, que jamás puede llegar al navegador (RNF-25). El flujo es:
 * el administrador invita → Supabase envía el correo → el empleado define su
 * propia contraseña → el trigger handle_new_user crea su perfil con el rol y
 * el tenant que van en el metadata.
 */
export async function POST(request: Request) {
  const actor = await getCurrentUser();

  // Doble verificación: la interfaz ya lo oculta, pero ocultar no es seguridad.
  if (!actor || !actor.isActive || actor.role !== 'admin') {
    return NextResponse.json(
      { error: { code: 'SIN_PERMISO', message: 'No tienes permiso para invitar usuarios' } },
      { status: 403 },
    );
  }

  const cuerpo = await request.json().catch(() => ({}));
  const nombre = String(cuerpo.nombre ?? '').trim();
  // Igual que "Crear cuenta": sin espacios y en minúsculas. " Juan@Mail.cl"
  // se invitaba tal cual, y después no calzaba con la cuenta autorizada.
  const email = String(cuerpo.email ?? '').trim().toLowerCase();
  const rol = String(cuerpo.rol ?? '');

  if (!nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['admin', 'supervisor', 'vendedor', 'bodega'].includes(rol)) {
    return NextResponse.json(
      { error: { code: 'DATOS_INVALIDOS', message: 'Faltan datos o el rol no es válido' } },
      { status: 400 },
    );
  }

  const secreto = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto) {
    return NextResponse.json(
      { error: { code: 'ERROR_INTERNO', message: 'El servidor no está configurado para enviar invitaciones' } },
      { status: 500 },
    );
  }

  const admin = createServerSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, secreto, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const descuento = rol === 'admin' ? 100 : rol === 'supervisor' ? 10 : 0;

  // 0037 · El disparador toma el local y el rol de la autorización, no del metadata.
  const aut = await autorizarCuenta(admin, { email, tenantId: actor.tenantId, storeId: actor.storeId, rol, nombre });
  if (aut.error) {
    return NextResponse.json({ error: { code: 'ERROR_INTERNO', message: aut.error } }, { status: 500 });
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    // El tenant y el rol NO vienen del cliente: se toman del administrador que
    // invita. Aceptarlos del navegador permitiría invitar a otro local.
    data: {
      full_name: nombre,
      tenant_id: actor.tenantId,
      store_id: actor.storeId,
      role: rol,
      max_discount_pct: descuento,
    },
    // A la pantalla donde el invitado crea su contraseña. Antes iba a /login,
    // y el empleado quedaba frente a un ingreso sin clave con que entrar.
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/recuperar`,
  });

  if (error) {
    await retirarAutorizacion(admin, email);
    const yaExiste = /already|registered|exists/i.test(error.message);
    return NextResponse.json(
      {
        error: {
          code: yaExiste ? 'CORREO_YA_REGISTRADO' : 'ERROR_INTERNO',
          message: yaExiste ? 'Ese correo ya tiene un usuario' : error.message,
        },
      },
      { status: yaExiste ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
