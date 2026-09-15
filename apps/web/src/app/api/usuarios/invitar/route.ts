import { NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/supabase/server';

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
  if (!actor || actor.role !== 'admin') {
    return NextResponse.json(
      { error: { code: 'SIN_PERMISO', message: 'No tienes permiso para invitar usuarios' } },
      { status: 403 },
    );
  }

  const { nombre, email, rol } = await request.json().catch(() => ({}));

  if (!nombre || !email || !['admin', 'supervisor', 'vendedor', 'bodega'].includes(rol)) {
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
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/login`,
  });

  if (error) {
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
