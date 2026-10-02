/**
 * Crea (o repara) una cuenta por rol en el local, para probar el sistema como
 * lo usa cada persona: administrador, supervisor, vendedor y bodega.
 *
 *   npm run db:cuentas -- --dominio=rutaahorro.cl
 *   npm run db:cuentas -- --dominio=rutaahorro.cl --clave=MiClave2026 --roles=vendedor,bodega
 *   npm run db:cuentas -- --dominio=rutaahorro.cl --tenant="QA · pruebas internas"
 *
 * Correos: vendedor@<dominio>, supervisor@<dominio>, bodega@<dominio> (y
 * admin.prueba@<dominio> si se pide el rol admin). Si la cuenta ya existe, le
 * pone la contraseña de nuevo y verifica que tenga perfil en el local: así
 * sirve también para "no puedo entrar con el vendedor".
 *
 * Por omisión las cuentas NO piden cambiar la clave al entrar (son de prueba).
 * Con --cambiar-al-entrar sí, como las que crea el administrador en Usuarios.
 *
 * Usa la llave de servicio: vive acá, nunca en el navegador (regla 5).
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(raiz, '.env.local') });

const NOMBRES = {
  admin: 'Administrador de prueba',
  supervisor: 'Supervisor de prueba',
  vendedor: 'Vendedor de prueba',
  bodega: 'Bodega de prueba',
};
const DESCUENTO = { admin: 100, supervisor: 10, vendedor: 0, bodega: 0 };

const arg = (n) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : null;
};
const bandera = (n) => process.argv.includes(`--${n}`);
function morir(m) { console.error(`\n✖ ${m}\n`); process.exit(1); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const llave = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) morir('Falta NEXT_PUBLIC_SUPABASE_URL en .env.local');
if (!llave) morir('Falta SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY) en .env.local');

const dominio = arg('dominio');
if (!dominio) morir('Falta --dominio. Ejemplo: npm run db:cuentas -- --dominio=rutaahorro.cl');
const roles = (arg('roles') ?? 'supervisor,vendedor,bodega').split(',').map((r) => r.trim());
for (const r of roles) if (!NOMBRES[r]) morir(`Rol "${r}" no existe. Los roles son: ${Object.keys(NOMBRES).join(', ')}`);
const clave = arg('clave') ?? `Ra-${randomBytes(6).toString('base64url')}`;
if (clave.length < 8) morir('La contraseña necesita al menos 8 caracteres');
const cambiarAlEntrar = bandera('cambiar-al-entrar');

const db = createClient(url, llave, { auth: { persistSession: false } });

const { data: tenants, error: eT } = await db.from('tenants').select('id, name').order('created_at');
if (eT) morir(`No se pudo leer tenants: ${eT.message}`);
const pedido = arg('tenant');
const tenant = pedido ? tenants.find((t) => t.id === pedido || t.name === pedido) : tenants[0];
if (!tenant) morir(`No encontré el tenant "${pedido}".`);
if (!pedido && tenants.length > 1) {
  morir(`Hay ${tenants.length} locales y no dijiste cuál:\n${tenants.map((t) => `    ${t.name}  (${t.id})`).join('\n')}\n  Agrega --tenant=<nombre o id>`);
}
const { data: tiendas } = await db.from('stores').select('id').eq('tenant_id', tenant.id).order('created_at');
if (!tiendas?.length) morir(`El local "${tenant.name}" no tiene tienda.`);

/** Busca un usuario por correo recorriendo las páginas de Auth. */
async function buscarPorCorreo(correo) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === correo);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

const filas = [];
for (const rol of roles) {
  const correo = `${rol === 'admin' ? 'admin.prueba' : rol}@${dominio}`.toLowerCase();
  const meta = { full_name: NOMBRES[rol], tenant_id: tenant.id, store_id: tiendas[0].id, role: rol };
  let id;
  let accion;
  // 0037 · El disparador toma el local y el rol de `cuentas_autorizadas`, no
  // del metadata. Con una base sin 0037 la tabla no existe: se sigue igual.
  {
    const { error: eAut } = await db.from('cuentas_autorizadas').upsert({
      email: correo.toLowerCase(), tenant_id: tenant.id, store_id: tiendas[0].id, role: rol, full_name: NOMBRES[rol],
    });
    if (eAut && !/cuentas_autorizadas|42P01|PGRST205|does not exist|schema cache/i.test(`${eAut.code} ${eAut.message}`)) {
      morir(`No se pudo autorizar la cuenta: ${eAut.message}`);
    }
  }
  const { data: creado, error } = await db.auth.admin.createUser({
    email: correo, password: clave, email_confirm: true,
    user_metadata: meta, app_metadata: { debe_cambiar_clave: cambiarAlEntrar },
  });
  if (error) {
    if (!/already|registered|exists/i.test(error.message)) morir(`${correo}: ${error.message}`);
    const existente = await buscarPorCorreo(correo);
    if (!existente) morir(`${correo} dice existir pero no lo encuentro en Auth`);
    const { error: e2 } = await db.auth.admin.updateUserById(existente.id, {
      password: clave, app_metadata: { debe_cambiar_clave: cambiarAlEntrar },
    });
    if (e2) morir(`${correo}: ${e2.message}`);
    id = existente.id;
    accion = 'clave nueva';
  } else {
    id = creado.user.id;
    accion = 'creada';
  }

  // Sin perfil la app la rechaza: se crea o se corrige para que sea de este
  // local, con este rol y activa.
  const { data: perfil } = await db.from('profiles').select('tenant_id, role, is_active').eq('id', id).maybeSingle();
  if (!perfil) {
    const { error: e3 } = await db.from('profiles').insert({
      id, tenant_id: tenant.id, store_id: tiendas[0].id, full_name: NOMBRES[rol],
      email: correo, role: rol, max_discount_pct: DESCUENTO[rol],
    });
    if (e3) morir(`${correo}: no se pudo crear el perfil: ${e3.message}`);
    accion += ' + perfil';
  } else if (perfil.tenant_id !== tenant.id) {
    morir(`${correo} ya existe en OTRO local. Usa otro --dominio.`);
  } else if (perfil.role !== rol || !perfil.is_active) {
    await db.from('profiles').update({ role: rol, is_active: true, max_discount_pct: DESCUENTO[rol] }).eq('id', id);
    accion += ' + perfil corregido';
  }
  filas.push({ rol, correo, accion });
}

console.log(`\n✔ Cuentas listas en ${tenant.name}\n`);
for (const f of filas) console.log(`    ${f.rol.padEnd(11)} ${f.correo.padEnd(34)} ${f.accion}`);
console.log(`\n    Contraseña de todas: ${clave}`);
console.log(cambiarAlEntrar
  ? '    Al entrar, cada una tendrá que elegir su propia contraseña.\n'
  : '    Son cuentas de prueba: no piden cambiar la clave. Para personas reales, créalas desde Usuarios.\n');
