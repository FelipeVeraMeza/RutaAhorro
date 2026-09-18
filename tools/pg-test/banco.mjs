/**
 * Banco de pruebas contra un PostgreSQL de verdad.
 *
 * `db:check` solo parsea el SQL: dice que está bien escrito, no que funcione.
 * Hasta esto, ninguna función de la base se había ejecutado nunca fuera de
 * Supabase, y los casos de concurrencia (CP-01 a CP-08) descansaban en diseño.
 *
 * Levanta un PostgreSQL embebido (binarios oficiales, sin Docker), le pone
 * encima lo mínimo de Supabase que el esquema usa —`auth.uid()`, `auth.users`,
 * los roles `anon`/`authenticated`/`service_role` y **los privilegios por
 * omisión que Supabase concede sobre `public`**— y aplica las migraciones en
 * orden, igual que `instalar.sql`.
 *
 * Lo de los privilegios no es un detalle: Supabase le concede ALL sobre cada
 * tabla nueva a `authenticated`. Sin replicarlo, una política permisiva
 * pasaría las pruebas porque el GRANT faltante la taparía, y en producción no.
 */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migraciones = path.join(raiz, 'supabase', 'migrations');

const SUPABASE = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
-- Igual que en Supabase: PostgREST deja el sub del JWT en esta variable.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export function listarMigraciones() {
  return fs.readdirSync(migraciones).filter((f) => f.endsWith('.sql')).sort();
}

export function leerMigracion(f) {
  return fs.readFileSync(path.join(migraciones, f), 'utf8');
}

function puertoLibre() {
  return new Promise((ok, mal) => {
    const s = net.createServer();
    s.unref();
    s.on('error', mal);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/**
 * `aplicar: false` deja la base como la deja Supabase al crear el proyecto,
 * sin esquema: para probar el instalador tal como se va a pegar.
 */
export async function levantarBanco({ aplicar = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-pg-'));
  const port = await puertoLibre();
  const motor = new EmbeddedPostgres({
    databaseDir: dir, user: 'postgres', password: 'postgres', port,
    persistent: false, onLog: () => {}, onError: () => {},
    // Supabase es UTF-8. En Windows, initdb toma la codificación del sistema
    // (WIN1252) y el esquema, que tiene tildes y signos, no se aplicaría igual.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  await motor.initialise();
  await motor.start();

  const conn = { host: 'localhost', port, user: 'postgres', password: 'postgres', database: 'postgres' };
  const su = new pg.Client(conn);
  try {
    await su.connect();
    await su.query(SUPABASE);
    for (const f of aplicar ? listarMigraciones() : []) {
      try {
        await su.query(leerMigracion(f));
      } catch (e) {
        throw new Error(`La migración ${f} no se aplica: ${e.message}`);
      }
    }
  } catch (e) {
    // Sin esto el motor queda vivo y el proceso de pruebas no termina nunca.
    await su.end().catch(() => {});
    await motor.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }

  const abiertas = new Set();
  const banco = {
    conn,
    /** Conexión de superusuario: para preparar datos y verificar, nunca para atacar. */
    su,

    /** Una conexión que se comporta como PostgREST con el JWT de `usuario`. */
    async como(usuario) {
      const c = new pg.Client(conn);
      await c.connect();
      abiertas.add(c);
      if (usuario) {
        await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario.id]);
        await c.query('set role authenticated');
      } else {
        await c.query('set role anon');
      }
      const { rows } = await c.query('select pg_backend_pid() as pid');
      c.pid = rows[0].pid;
      return c;
    },

    async bajar() {
      for (const c of abiertas) await c.end().catch(() => {});
      await su.end().catch(() => {});
      await motor.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return banco;
}

/**
 * Un local nuevo con su tienda y un usuario por rol. Cada prueba arma el suyo
 * para no depender del orden en que corren.
 */
export async function nuevoLocal(banco, nombre = 'Local') {
  const { su } = banco;
  const tenant = (await su.query(`insert into tenants (name) values ($1) returning id`, [nombre])).rows[0].id;
  const store = (await su.query(`insert into stores (tenant_id, name) values ($1, 'Casa matriz') returning id`, [tenant])).rows[0].id;

  const usuario = async (rol, alias) => {
    const meta = { tenant_id: tenant, store_id: store, role: rol, full_name: alias };
    const id = (await su.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [`${alias}@${tenant.slice(0, 8)}.cl`, meta])).rows[0].id;
    return { id, rol, alias };
  };

  const local = {
    tenant, store,
    admin: await usuario('admin', 'admin'),
    supervisor: await usuario('supervisor', 'supervisor'),
    cajero1: await usuario('vendedor', 'cajero1'),
    cajero2: await usuario('vendedor', 'cajero2'),
    bodega: await usuario('bodega', 'bodega'),

    async producto({ nombre = 'Producto', precio = 1000, costo = 600, stock = 0, perecible = false } = {}) {
      const id = (await su.query(
        `insert into products (tenant_id, name, sale_price, avg_cost, last_cost, tracks_expiry)
         values ($1, $2, $3, $4, $4, $5) returning id`,
        [tenant, nombre, precio, costo, perecible])).rows[0].id;
      if (stock) {
        await su.query(
          `select fn_post_movement($1, $2, $3, 'inventario_inicial', $4, $5, null, null, 'inicial', null)`,
          [tenant, store, id, stock, costo]);
      }
      return id;
    },

    async lote(producto, cantidad, vence) {
      return (await su.query(
        `insert into product_lots (tenant_id, store_id, product_id, lot_code, expiry_date, quantity)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [tenant, store, producto, `L-${vence}`, vence, cantidad])).rows[0].id;
    },

    async stock(producto) {
      const r = await su.query(
        `select quantity from stock_levels where store_id = $1 and product_id = $2`, [store, producto]);
      return r.rows.length ? Number(r.rows[0].quantity) : 0;
    },
  };
  return local;
}

/** Llama una función RPC con parámetros con nombre, como lo hace PostgREST. */
export async function rpc(c, fn, args = {}) {
  const claves = Object.keys(args);
  const lista = claves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const valores = claves.map((k) => {
    const v = args[k];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  });
  const { rows } = await c.query(`select public.${fn}(${lista}) as r`, valores);
  return rows[0].r;
}

/** Igual que `rpc`, pero devuelve el error en vez de lanzarlo. */
export async function intentar(promesa) {
  try {
    return { ok: true, valor: await promesa };
  } catch (e) {
    return { ok: false, error: e.message, codigo: e.code };
  }
}

/**
 * Espera a que la conexión `pid` quede bloqueada esperando un lock. Devuelve
 * false si en `ms` no se bloqueó (porque terminó, o porque no hay conflicto).
 * Es lo que hace deterministas las pruebas de carrera: en vez de lanzar dos
 * cosas "a la vez" y esperar que choquen, se fuerza el peor intercalado.
 */
export async function esperarBloqueo(banco, pid, ms = 3000) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    const { rows } = await banco.su.query(
      `select 1 from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'`, [pid]);
    if (rows.length) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

export const venta = (producto, cantidad, precio, extra = {}) => ({
  p_client_uuid: extra.uuid ?? crypto.randomUUID(),
  p_items: [{ product_id: producto, quantity: cantidad, unit_price: precio, discount_amount: extra.descuento ?? 0 }],
  p_payments: [{ method: 'efectivo', amount: Math.round(cantidad * precio) - (extra.descuento ?? 0) }],
});
