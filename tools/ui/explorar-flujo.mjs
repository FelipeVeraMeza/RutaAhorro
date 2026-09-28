// Recorrido exploratorio del flujo completo, con capturas. No es una prueba:
// es para mirar qué ve el cliente en cada paso.
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const RAIZ = 'C:/Users/felip/OneDrive/Documentos/VS/RuaAhorro';
const OUT = 'tools/ui/.capturas/flujo';
fs.mkdirSync(OUT, { recursive: true });
const env = dotenv.parse(fs.readFileSync(`${RAIZ}/.env.local`));
const BASE = process.env.RA_BASE ?? 'http://localhost:3001';
const opc = { auth: { persistSession: false, autoRefreshToken: false } };
const servicio = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, opc);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const correo = `qa-admin-${ref}@example.com`;
const { data } = await servicio.auth.admin.listUsers({ perPage: 1000 });
const u = data.users.find((x) => x.email === correo);
const clave = randomBytes(12).toString('base64url');
await servicio.auth.admin.updateUserById(u.id, { password: clave });

const nav = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await nav.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const log = [];
p.on('pageerror', (e) => log.push('JS: ' + e.message));
let n = 0;
const foto = async (nombre) => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${nombre}.png`, fullPage: true }); };

await p.goto(`${BASE}/login`);
await p.fill('#email', correo);
await p.fill('#password', clave);
await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login')), p.click('button[type=submit]')]);
await foto('inicio');

const vp = async (nombre) => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/c${String(++n).padStart(2, '0')}-${nombre}.png` }); };
await p.goto(`${BASE}/caja`);
await p.waitForTimeout(2500);
await p.getByRole('button', { name: 'Cerrar caja' }).click();
await vp('cierre-dialogo');
const inp = p.getByRole('dialog').locator('input').first();
await inp.fill('750');
await vp('cierre-750');
const nombre='';
console.log('ok', nombre, log);
await nav.close();
