import { NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@supabase/supabase-js';
import { cifrar, isValidRut, formatRut } from '@rutaahorro/core';
import { getCurrentUser } from '@/lib/supabase/server';

/**
 * Credenciales del SII para el robot del portal (0026).
 *
 * Vive en el servidor por dos razones: la tabla `sii_credenciales` no la puede
 * leer ni escribir ningún usuario (solo la llave de servicio), y la llave que
 * las cifra (SII_CLAVE_CIFRADO) no puede llegar al navegador. Las claves se
 * cifran acá, antes de tocar la base, y nunca se devuelven: la pantalla solo
 * sabe si están guardadas (fn_estado_emision_sii).
 */

const error = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

function servicio() {
  const secreto = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto) return null;
  return createServerSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, secreto, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  const actor = await getCurrentUser();
  // Doble verificación: la pantalla ya lo oculta, pero ocultar no es seguridad.
  if (!actor || !actor.isActive || actor.role !== 'admin') return error('SIN_PERMISO', 'Solo el administrador guarda las claves del SII', 403);

  const llave = process.env.SII_CLAVE_CIFRADO;
  const admin = servicio();
  if (!llave || !admin) {
    return error('SIN_CONFIGURAR', 'El servidor no tiene la llave para cifrar las claves (SII_CLAVE_CIFRADO). Ver docs/09 §3.4', 500);
  }

  const d = await request.json().catch(() => ({})) as Record<string, unknown>;
  const rutUsuario = String(d.rut_usuario ?? '').trim();
  const rutEmpresa = String(d.rut_empresa ?? '').trim();
  const claveSii = String(d.clave_sii ?? '');
  const claveCertificado = String(d.clave_certificado ?? '');
  if (!isValidRut(rutUsuario)) return error('RUT_INVALIDO', 'El RUT de la persona que entra al SII no es válido', 400);
  if (!isValidRut(rutEmpresa)) return error('RUT_INVALIDO', 'El RUT de la empresa emisora no es válido', 400);
  if (claveSii.length < 4 || claveCertificado.length < 4) {
    return error('DATOS_INVALIDOS', 'Faltan la clave tributaria o la clave del certificado', 400);
  }

  let cifradas: [string, string];
  try {
    cifradas = await Promise.all([cifrar(claveSii, llave), cifrar(claveCertificado, llave)]);
  } catch {
    return error('SIN_CONFIGURAR', 'La llave SII_CLAVE_CIFRADO del servidor no es válida (tienen que ser 32 bytes en base64)', 500);
  }

  const { error: e } = await admin.from('sii_credenciales').upsert({
    tenant_id: actor.tenantId,
    rut_usuario: formatRut(rutUsuario),
    rut_empresa: formatRut(rutEmpresa),
    clave_sii: cifradas[0],
    clave_certificado: cifradas[1],
    actualizado_por: actor.id,
    actualizado_en: new Date().toISOString(),
  });
  if (e) return error('ERROR_INTERNO', 'No se pudieron guardar las credenciales', 500);

  // Quién y cuándo, sin las claves.
  await admin.from('audit_log').insert({
    tenant_id: actor.tenantId, user_id: actor.id, action: 'credenciales_sii', entity_type: 'sii_credenciales',
    entity_id: actor.tenantId, new_values: { rut_usuario: formatRut(rutUsuario), rut_empresa: formatRut(rutEmpresa) },
  });
  return NextResponse.json({ ok: true });
}

/** Borrar las credenciales apaga la emisión real (fn_emision_sii_activa las exige). */
export async function DELETE() {
  const actor = await getCurrentUser();
  if (!actor || !actor.isActive || actor.role !== 'admin') return error('SIN_PERMISO', 'Solo el administrador borra las claves del SII', 403);
  const admin = servicio();
  if (!admin) return error('SIN_CONFIGURAR', 'El servidor no está configurado', 500);
  const { error: e } = await admin.from('sii_credenciales').delete().eq('tenant_id', actor.tenantId);
  if (e) return error('ERROR_INTERNO', 'No se pudieron borrar las credenciales', 500);
  await admin.from('audit_log').insert({
    tenant_id: actor.tenantId, user_id: actor.id, action: 'credenciales_sii_borradas',
    entity_type: 'sii_credenciales', entity_id: actor.tenantId,
  });
  return NextResponse.json({ ok: true });
}
