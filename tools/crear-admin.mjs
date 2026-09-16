/**
 * Crea un usuario del sistema contra la base real.
 *
 * Se hace por script y no a mano en el panel de Supabase porque el paso
 * delicado es invisible: el perfil no lo crea el panel, lo crea el disparador
 * `handle_new_user` leyendo `raw_user_meta_data`. Si ese JSON no trae
 * `tenant_id`, el usuario se crea igual, entra al login igual, y queda sin
 * perfil: la aplicación lo rechaza sin decir por qué. Es el error más fácil de
 * cometer al instalar y el más difícil de diagnosticar después.
 *
 * Este script busca el tenant y la tienda en la base, arma el metadata
 * completo y después **verifica que el perfil exista de verdad**.
 *
 *   npm run db:admin -- --correo=dueno@almacen.cl --nombre="Ana Pérez"
 *   npm run db:admin -- --correo=jorge@almacen.cl --nombre="Jorge Peña" --rol=vendedor
 *
 * Usa la llave `service_role`, que salta RLS. Por eso vive acá y nunca en el
 * navegador (regla 5 del proyecto).
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(raiz, '.env.local') });

const ROLES = ['admin', 'supervisor', 'vendedor', 'bodega'];

function arg(nombre) {
  const p = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return p ? p.slice(nombre.length + 3) : null;
}

function morir(mensaje) {
  console.error(`\n✖ ${mensaje}\n`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const llave = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) morir('Falta NEXT_PUBLIC_SUPABASE_URL en .env.local');
if (!llave) morir('Falta SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY) en .env.local');

const correo = arg('correo');
const nombre = arg('nombre');
const rol = arg('rol') ?? 'admin';
const claveDada = arg('password');

if (!correo) {
  morir('Falta --correo.\n  Ejemplo: npm run db:admin -- --correo=dueno@almacen.cl --nombre="Ana Pérez"');
}
if (!nombre) morir('Falta --nombre. El nombre aparece en cada venta y en cada ajuste del kardex.');
if (!ROLES.includes(rol)) morir(`Rol "${rol}" no existe. Los roles son: ${ROLES.join(', ')}`);

const db = createClient(url, llave, { auth: { persistSession: false } });

// ---------------------------------------------------------------- tenant
const { data: tenants, error: errTenants } = await db
  .from('tenants').select('id, name').order('created_at');

if (errTenants) morir(`No se pudo leer la tabla tenants: ${errTenants.message}\n  ¿Ya aplicaste supabase/instalar.sql?`);
if (!tenants?.length) morir('No hay ningún tenant. Aplica supabase/instalar.sql antes de crear usuarios.');

const tenantPedido = arg('tenant');
const tenant = tenantPedido
  ? tenants.find((t) => t.id === tenantPedido || t.name === tenantPedido)
  : tenants[0];

if (!tenant) morir(`No encontré el tenant "${tenantPedido}".`);
if (!tenantPedido && tenants.length > 1) {
  morir(
    `Hay ${tenants.length} tenants y no dijiste cuál:\n` +
    tenants.map((t) => `    ${t.name}  (${t.id})`).join('\n') +
    '\n  Agrega --tenant=<nombre o id>',
  );
}

const { data: tiendas } = await db
  .from('stores').select('id, name').eq('tenant_id', tenant.id).order('created_at');

if (!tiendas?.length) morir(`El tenant "${tenant.name}" no tiene ninguna tienda.`);
const tienda = tiendas[0];

// ---------------------------------------------------------------- usuario
// Una clave temporal fuerte de verdad. La persona la cambia al entrar; lo que
// no puede pasar es que el instalador ponga "123456" en la cuenta que manda.
const clave = claveDada ?? `Ra-${randomBytes(9).toString('base64url')}`;

const { data: creado, error: errCrear } = await db.auth.admin.createUser({
  email: correo,
  password: clave,
  email_confirm: true,
  user_metadata: {
    tenant_id: tenant.id,
    store_id: tienda.id,
    role: rol,
    full_name: nombre,
  },
});

if (errCrear) {
  if (/already|registered|exists/i.test(errCrear.message)) {
    morir(
      `Ya existe una cuenta con el correo ${correo}.\n` +
      '  Si quedó sin perfil, bórrala en Supabase > Authentication > Users y vuelve a correr esto.',
    );
  }
  morir(`No se pudo crear el usuario: ${errCrear.message}`);
}

// --------------------------------------------------------------- verificar
// El disparador corre dentro del insert en auth.users. Si el metadata iba
// incompleto no falla: simplemente no crea el perfil. Por eso se comprueba.
const { data: perfil } = await db
  .from('profiles')
  .select('full_name, role, is_active, tenant_id')
  .eq('id', creado.user.id)
  .maybeSingle();

if (!perfil) {
  morir(
    'El usuario se creó en Auth pero el disparador NO creó su perfil.\n' +
    '  Sin perfil, la aplicación lo va a rechazar al entrar.\n' +
    `  Revisa que el disparador on_auth_user_created exista (está en 0002_functions.sql).\n` +
    `  id del usuario: ${creado.user.id}`,
  );
}

console.log(`
✔ Usuario creado y verificado

    Local       ${tenant.name} · ${tienda.name}
    Nombre      ${perfil.full_name}
    Correo      ${correo}
    Rol         ${perfil.role}
    Contraseña  ${clave}

  Anota la contraseña ahora: no se vuelve a mostrar.
  Que la persona la cambie al entrar la primera vez.
`);
