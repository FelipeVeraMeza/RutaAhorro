/**
 * M1 · Usuarios y sesiones, en el navegador y contra el Supabase real.
 * Corre en el local "QA · pruebas internas" (lo crea `npm run db:e2e`).
 *
 *   node tools/ui/m1-usuarios.mjs
 */
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = dotenv.parse(fs.readFileSync('.env.local'));
const BASE = 'http://localhost:3001';
const opc = { auth: { persistSession: false, autoRefreshToken: false } };
const servicio = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, opc);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];

const resultados = [];
function ok(rf, cumple, texto, detalle = '') {
  resultados.push({ rf, cumple, texto, detalle });
  console.log(`  ${cumple ? '✔' : '✖'} ${rf} · ${texto}${detalle ? ' — ' + detalle : ''}`);
}

async function claveNueva(correo) {
  const { data } = await servicio.auth.admin.listUsers({ perPage: 1000 });
  const u = data.users.find((x) => x.email === correo);
  const clave = randomBytes(12).toString('base64url');
  await servicio.auth.admin.updateUserById(u.id, { password: clave });
  return { id: u.id, correo, clave };
}

async function entrar(pagina, u) {
  await pagina.goto(`${BASE}/login`);
  await pagina.fill('#email', u.correo);
  await pagina.fill('#password', u.clave);
  await Promise.all([pagina.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: 20000 }), pagina.click('button[type=submit]')]);
}

const admin = await claveNueva(`qa-admin-${ref}@example.com`);
const cajero = await claveNueva(`qa-cajero-${ref}@example.com`);
const { data: perfilAdmin } = await servicio.from('profiles').select('tenant_id, store_id').eq('id', admin.id).single();

const nav = await chromium.launch({ channel: 'msedge', headless: true });
const nueva = async () => (await nav.newContext({ viewport: { width: 1280, height: 850 } })).newPage();

// ------------------------------------------------------------------ M1-01
console.log('M1-01 · Iniciar sesión');
{
  const p = await nueva();
  await p.goto(`${BASE}/login`);
  await p.fill('#email', admin.correo);
  await p.fill('#password', 'equivocada123');
  await p.click('button[type=submit]');
  const msj = await p.locator('form [role=alert]').first().innerText({ timeout: 10000 }).catch(() => '');
  ok('M1-01', msj === 'Correo o contraseña incorrectos', 'clave equivocada: mensaje sin revelar si el correo existe', msj);
  await entrar(p, admin);
  ok('M1-01', new URL(p.url()).pathname === '/pos', 'clave correcta: entra al POS', new URL(p.url()).pathname);
  await p.context().close();
}

// ------------------------------------------------------------------ M1-02
console.log('M1-02 · Cada trabajador con su sesión');
const pA = await nueva();
const pC = await nueva();
await entrar(pA, admin);
await entrar(pC, cajero);
await pA.goto(`${BASE}/`);
await pC.goto(`${BASE}/`);
const nombreA = await pA.locator('aside, header').first().innerText();
const nombreC = await pC.locator('aside, header').first().innerText();
ok('M1-02', /QA admin/i.test(nombreA) && /QA cajero/i.test(nombreC), 'dos navegadores, dos personas distintas a la vez');
const menuCajero = await pC.locator('nav').first().innerText();
ok('M1-02', !/Usuarios/.test(menuCajero), 'el vendedor no ve Usuarios en el menú');
await pC.goto(`${BASE}/usuarios`);
// La redirección llega después del esqueleto de carga: se espera a que ocurra.
await pC.waitForURL((x) => x.pathname !== '/usuarios', { timeout: 10000 }).catch(() => {});
ok('M1-02', new URL(pC.url()).pathname !== '/usuarios' || /permiso/i.test(await pC.locator('main').innerText()),
  'el vendedor no entra a Usuarios aunque escriba la dirección', new URL(pC.url()).pathname);

// ------------------------------------------------------------------ M1-12 + M1-08
console.log('M1-12 · Invitar empleado, y el invitado crea su contraseña');
const correoInv = `qa-inv-${Date.now().toString().slice(-6)}-${ref}@example.com`;
const { data: link, error: eLink } = await servicio.auth.admin.generateLink({
  type: 'invite', email: correoInv,
  options: { data: { tenant_id: perfilAdmin.tenant_id, store_id: perfilAdmin.store_id, role: 'vendedor', full_name: 'QA Invitado' },
             redirectTo: `${BASE}/recuperar` },
});
ok('M1-12', !eLink, 'Supabase genera la invitación', eLink?.message ?? '');
const pI = await nueva();
await pI.goto(link.properties.action_link);
await pI.waitForLoadState('networkidle').catch(() => {});
const llegada = new URL(pI.url());
ok('M1-12', llegada.host === new URL(BASE).host && llegada.pathname === '/recuperar',
  'el enlace del correo lleva a la pantalla de crear contraseña', `${llegada.host}${llegada.pathname}`);
if (llegada.pathname === '/recuperar') {
  await pI.getByRole('heading', { name: 'Crea tu contraseña' }).waitFor({ timeout: 10000 }).then(
    () => ok('M1-12', true, 'dice "Crea tu contraseña"'), () => ok('M1-12', false, 'dice "Crea tu contraseña"'));
  await pI.fill('#clave', 'corta');
  await pI.fill('#repetida', 'corta');
  await pI.getByRole('button', { name: 'Guardar y entrar' }).click();
  const m = await pI.locator('[role=alert]').first().innerText({ timeout: 5000 }).catch(() => '');
  ok('M1-08', /al menos 8/.test(m), 'rechaza una contraseña de menos de 8 caracteres', m);
  const claveInv = 'Invitado-' + randomBytes(6).toString('hex');
  await pI.fill('#clave', claveInv);
  await pI.fill('#repetida', claveInv);
  await Promise.all([pI.waitForURL('**/pos', { timeout: 20000 }).catch(() => {}), pI.getByRole('button', { name: 'Guardar y entrar' }).click()]);
  ok('M1-12', new URL(pI.url()).pathname === '/pos', 'guarda la contraseña y entra', new URL(pI.url()).pathname);
  await pI.context().close();
  const pI2 = await nueva();
  await entrar(pI2, { correo: correoInv, clave: claveInv }).catch(() => {});
  ok('M1-12', new URL(pI2.url()).pathname === '/pos', 'después entra con esa contraseña desde el ingreso normal');
  await pI2.context().close();
}

// ------------------------------------------------------------------ M1-04 + M1-03
console.log('M1-03 / M1-04 · El administrador cambia el rol y desactiva');
await pA.goto(`${BASE}/usuarios`);
const filaInv = pA.locator('li', { hasText: correoInv });
await filaInv.waitFor({ timeout: 15000 }).then(() => ok('M1-03', true, 'el invitado aparece en Usuarios'), () => ok('M1-03', false, 'el invitado aparece en Usuarios'));
await filaInv.locator('select').selectOption('supervisor');
await pA.waitForTimeout(2500);
const { data: trasRol } = await servicio.from('profiles').select('role, is_active').eq('email', correoInv).single();
ok('M1-04', trasRol?.role === 'supervisor', 'cambiar el rol desde la pantalla queda guardado', trasRol?.role);
await pA.locator('li', { hasText: correoInv }).getByRole('button', { name: 'Desactivar' }).click();
await pA.waitForTimeout(2500);
const { data: trasDes } = await servicio.from('profiles').select('is_active').eq('email', correoInv).single();
ok('M1-03', trasDes?.is_active === false, 'desactivar queda guardado');
await pA.reload();
const miFila = await pA.locator('li', { hasText: admin.correo }).innerText();
ok('M1-04', !/Desactivar/.test(miFila), 'el administrador no puede desactivarse a sí mismo');

// ------------------------------------------------------------------ M1-14
console.log('M1-14 · Ver quién está conectado');
ok('M1-14', /Conectado/.test(await pA.locator('li', { hasText: cajero.correo }).innerText()), 'el cajero que acaba de entrar aparece conectado');

// ------------------------------------------------------------------ M1-13
console.log('M1-13 · El mismo usuario en dos dispositivos');
{
  const cel = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opc);
  await cel.auth.signInWithPassword({ email: cajero.correo, password: cajero.clave });
  await pC.goto(`${BASE}/pos`);
  await pC.locator('form[action="/api/logout"] button').first().click();
  await pC.waitForURL('**/login', { timeout: 15000 }).catch(() => {});
  const r2 = await cel.auth.refreshSession();
  ok('M1-13', !r2.error, 'cerrar sesión en un navegador no saca al celular del mismo usuario', r2.error?.message ?? 'sigue conectado');
}

// ------------------------------------------------------------------ M1-06
console.log('M1-06 · La sesión se mantiene hasta cerrarla');
{
  const cookies = await pA.context().cookies();
  const auth = cookies.filter((c) => c.name.includes('auth-token'));
  const dias = auth.length ? Math.round((Math.min(...auth.map((c) => c.expires)) * 1000 - Date.now()) / 86400000) : 0;
  ok('M1-06', dias >= 300, 'la cookie de sesión dura más de un año y se renueva sola', `${dias} días`);
}

// ------------------------------------------------------------------ M1-05
console.log('M1-05 · Recuperar la contraseña');
{
  const p = await nueva();
  await p.goto(`${BASE}/login`);
  await p.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
  await p.waitForURL('**/recuperar');
  ok('M1-05', true, 'el ingreso tiene "¿Olvidaste tu contraseña?"');
  const { data: rec } = await servicio.auth.admin.generateLink({ type: 'recovery', email: cajero.correo, options: { redirectTo: `${BASE}/recuperar` } });
  await p.goto(rec.properties.action_link);
  await p.getByRole('heading', { name: 'Nueva contraseña' }).waitFor({ timeout: 15000 }).then(
    () => ok('M1-05', true, 'el enlace de recuperación abre "Nueva contraseña"'),
    () => ok('M1-05', false, 'el enlace de recuperación abre "Nueva contraseña"', new URL(p.url()).host + new URL(p.url()).pathname));
  await p.context().close();
}

await nav.close();
const malos = resultados.filter((x) => !x.cumple);
console.log(`\n${resultados.length - malos.length}/${resultados.length} comprobaciones pasaron.`);
fs.writeFileSync('tools/ui/.resultado-m1.json', JSON.stringify(resultados, null, 1));
process.exit(malos.length ? 1 : 0);
