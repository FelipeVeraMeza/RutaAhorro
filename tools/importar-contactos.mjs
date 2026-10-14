/**
 * Clientes y proveedores desde la planilla del sistema anterior (Kame), sin
 * romper nada (Felipe, 2026-10-13: "ayúdame a meter todo eso en la bd sin
 * explotar").
 *
 *   node tools/importar-contactos.mjs tmp/contactos.txt [--excluir=77736858-3]
 *
 * Entrada: lo que se copia de la planilla en Excel y se pega en un .txt
 * (columnas separadas por tabulación, con la fila de títulos). Salida:
 *   · un resumen en pantalla: cuántos clientes, proveedores, omitidos y por qué;
 *   · tmp/contactos-importar.sql, para pegar en el SQL Editor de Supabase.
 *
 * El SQL es UNA transacción (falla entera o entra entera), exige que la base
 * tenga exactamente un local activo, valida el RUT en la base
 * (fn_rut_formateado) y se puede correr dos veces: lo que ya existe no se
 * duplica, y solo se le completan los datos que tenga vacíos.
 *
 * Quién es qué (la planilla trae las columnas Cliente / Proveedor / Empleado):
 *   · Empleado = S → se omite (no es cliente ni proveedor).
 *   · Proveedor = S, o con "Concepto Compras" → proveedor.
 *   · Cliente = S → cliente (puede ser las dos cosas).
 *   · Ni uno ni otro → cliente (son los negocios a los que se les vende).
 *   · RUT genérico (11.111.111-1, 55.555.555-5…) o inválido → se omite.
 */
import fs from 'node:fs';
import path from 'node:path';

const archivo = process.argv[2];
if (!archivo) { console.error('Uso: node tools/importar-contactos.mjs <archivo.txt> [--excluir=RUT,RUT]'); process.exit(1); }
// --local=<uuid>: con más de un local activo en la base (producción tenía varios
// el 2026-10-13), se dice en cuál cargar. Sin él, se exige que haya uno solo.
const local = process.argv.find((a) => a.startsWith('--local='))?.slice(8).trim() ?? null;
if (local && !/^[0-9a-f-]{36}$/i.test(local)) { console.error(`--local no es un id válido: ${local}`); process.exit(1); }
const excluir = new Set((process.argv.find((a) => a.startsWith('--excluir='))?.slice(10) ?? '')
  .split(',').map((r) => r.replace(/[^0-9kK]/g, '').toUpperCase()).filter(Boolean));

const limpio = (r) => String(r ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
function dvValido(r) {
  const c = limpio(r);
  if (c.length < 8 || !/^\d+[\dK]$/.test(c)) return false;
  let suma = 0, m = 2;
  for (let i = c.length - 2; i >= 0; i--) { suma += Number(c[i]) * m; m = m === 7 ? 2 : m + 1; }
  const resto = 11 - (suma % 11);
  return (resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)) === c.slice(-1);
}
// Los "clientes genéricos" del sistema anterior: todos los dígitos iguales.
const generico = (r) => /^(\d)\1+$/.test(limpio(r).slice(0, -1));
const texto = (v) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t && !/^(0|n\/a|null|por definir|generico|genérico)$/i.test(t) ? t : null;
};
const correo = (v) => { const t = texto(v)?.toLowerCase(); return t && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? t : null; };

const lineas = fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
const titulos = lineas[0].split('\t').map((t) => t.trim().toLowerCase());
const col = (nombre) => {
  const i = titulos.indexOf(nombre.toLowerCase());
  if (i < 0) throw new Error(`Falta la columna "${nombre}" en la fila de títulos`);
  return i;
};
const C = {
  rut: col('Rut'), razon: col('Razón Social'), giro: col('Giro'), direccion: col('Dirección'), ciudad: col('Ciudad'),
  comuna: col('Comuna'), mail: col('Mail'), telefono: col('Teléfono'), contacto: col('Contacto'),
  concepto: col('Concepto Compras'), cliente: col('Cliente'), proveedor: col('Proveedor'), empleado: col('Empleado'),
  nombreContacto: col('Nombre Contacto'), mailContacto: col('Mail Contacto'),
};

const vistos = new Map();
const omitidos = [];
for (const [n, linea] of lineas.slice(1).entries()) {
  const c = linea.split('\t');
  const rut = texto(c[C.rut]);
  const nombre = texto(c[C.razon]);
  const fila = n + 2;
  if (!rut || !nombre) { omitidos.push(`fila ${fila}: sin RUT o sin razón social`); continue; }
  if (!dvValido(rut)) { omitidos.push(`fila ${fila}: RUT inválido ${rut} (${nombre})`); continue; }
  if (generico(rut)) { omitidos.push(`fila ${fila}: RUT genérico ${rut} (${nombre})`); continue; }
  if (excluir.has(limpio(rut))) { omitidos.push(`fila ${fila}: excluido a pedido ${rut} (${nombre})`); continue; }
  if ((c[C.empleado] ?? '').trim().toUpperCase() === 'S') { omitidos.push(`fila ${fila}: es empleado ${rut} (${nombre})`); continue; }
  const esProveedor = (c[C.proveedor] ?? '').trim().toUpperCase() === 'S' || Boolean(texto(c[C.concepto]));
  const esCliente = (c[C.cliente] ?? '').trim().toUpperCase() === 'S' || !esProveedor;
  const r = {
    rut, nombre: nombre.slice(0, 200), giro: texto(c[C.giro]), direccion: texto(c[C.direccion]),
    comuna: texto(c[C.comuna]) ?? texto(c[C.ciudad]), email: correo(c[C.mail]) ?? correo(c[C.mailContacto]),
    telefono: texto(c[C.telefono]), contacto: texto(c[C.nombreContacto]) ?? texto(c[C.contacto]),
    concepto: texto(c[C.concepto]), esCliente, esProveedor,
  };
  const previo = vistos.get(limpio(rut));
  if (previo) {
    // El mismo RUT dos veces: se juntan (lo que falte en uno lo pone el otro).
    for (const k of Object.keys(r)) if (previo[k] == null || previo[k] === false) previo[k] = r[k];
    omitidos.push(`fila ${fila}: RUT repetido ${rut}, se juntó con la primera aparición`);
    continue;
  }
  vistos.set(limpio(rut), r);
}

const todos = [...vistos.values()];
const clientes = todos.filter((r) => r.esCliente);
const proveedores = todos.filter((r) => r.esProveedor);

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const notasProveedor = (r) => [r.giro && `Giro: ${r.giro}`, r.direccion && `Dirección: ${[r.direccion, r.comuna].filter(Boolean).join(', ')}`,
  r.concepto && `Concepto: ${r.concepto}`].filter(Boolean).join(' · ') || null;

const sql = `-- ============================================================================
-- Clientes y proveedores del sistema anterior (generado por tools/importar-contactos.mjs)
-- ${new Date().toISOString()} · ${clientes.length} clientes · ${proveedores.length} proveedores
--
-- Pegar entero en el SQL Editor de Supabase y ejecutar. Es una sola
-- transacción: si algo falla, no queda nada a medias. Se puede correr otra
-- vez sin duplicar: lo que ya existe solo recibe los datos que le faltan.
-- ============================================================================
do $$
declare
  v_tenant uuid;
  v_cli_nuevos integer;
  v_cli_antes integer;
  v_pro_nuevos integer;
  v_invalidos integer;
begin
${local
    ? `  -- El local elegido (--local), y tiene que estar activo; si no, se detiene sin tocar nada.
  select id into strict v_tenant from tenants where status = 'activo' and id = '${local}';`
    : `  -- Exactamente un local activo; si hay más o ninguno, se detiene sin tocar nada.
  select id into strict v_tenant from tenants where status = 'activo';`}

  create temp table _contactos (
    rut text, nombre text, giro text, direccion text, comuna text, email text, telefono text,
    contacto text, notas text, es_cliente boolean, es_proveedor boolean
  ) on commit drop;

  insert into _contactos values
${todos.map((r) => `    (${[r.rut, r.nombre, r.giro, r.direccion, r.comuna, r.email, r.telefono, r.contacto, notasProveedor(r)].map(q).join(', ')}, ${r.esCliente}, ${r.esProveedor})`).join(',\n')};

  -- El RUT con el formato y el dígito verificador que valida la base.
  update _contactos set rut = fn_rut_formateado(rut);
  select count(*) into v_invalidos from _contactos where rut is null;
  delete from _contactos where rut is null;

  -- ---------------------------------------------------------------- clientes
  select count(*) into v_cli_antes from clientes where tenant_id = v_tenant;
  insert into clientes (tenant_id, rut, nombre, giro, direccion, comuna, email, telefono, notas)
  select v_tenant, rut, nombre, giro, direccion, comuna, email, telefono,
         case when contacto is not null then 'Contacto: ' || contacto end
    from _contactos where es_cliente
  on conflict (tenant_id, rut) where rut is not null do update set
    giro      = coalesce(clientes.giro, excluded.giro),
    direccion = coalesce(clientes.direccion, excluded.direccion),
    comuna    = coalesce(clientes.comuna, excluded.comuna),
    email     = coalesce(clientes.email, excluded.email),
    telefono  = coalesce(clientes.telefono, excluded.telefono);
  select count(*) - v_cli_antes into v_cli_nuevos from clientes where tenant_id = v_tenant;

  -- ------------------------------------------------------------- proveedores
  -- suppliers no tiene RUT único: se compara por los dígitos del RUT.
  update suppliers s set
    contact_name = coalesce(s.contact_name, c.contacto),
    phone        = coalesce(s.phone, c.telefono),
    email        = coalesce(s.email, c.email),
    notes        = coalesce(s.notes, c.notas)
    from _contactos c
   where c.es_proveedor and s.tenant_id = v_tenant
     and regexp_replace(upper(coalesce(s.rut, '')), '[^0-9K]', '', 'g') = regexp_replace(c.rut, '[^0-9K]', '', 'g');
  insert into suppliers (tenant_id, name, rut, contact_name, phone, email, notes)
  select v_tenant, c.nombre, c.rut, c.contacto, c.telefono, c.email, c.notas
    from _contactos c
   where c.es_proveedor and not exists (
     select 1 from suppliers s where s.tenant_id = v_tenant
        and regexp_replace(upper(coalesce(s.rut, '')), '[^0-9K]', '', 'g') = regexp_replace(c.rut, '[^0-9K]', '', 'g'));
  get diagnostics v_pro_nuevos = row_count;

  raise notice 'Listo: % clientes nuevos, % proveedores nuevos, % RUT rechazados por la base.',
    v_cli_nuevos, v_pro_nuevos, v_invalidos;
end $$;
`;

const salida = path.join(path.dirname(path.resolve(archivo)), 'contactos-importar.sql');
fs.writeFileSync(salida, sql);
console.log(`\nFilas leídas: ${lineas.length - 1}`);
console.log(`  Clientes:    ${clientes.length}`);
console.log(`  Proveedores: ${proveedores.length}  (${todos.filter((r) => r.esCliente && r.esProveedor).length} son las dos cosas)`);
console.log(`  Omitidos:    ${omitidos.length}`);
for (const o of omitidos) console.log(`    · ${o}`);
console.log(`\nSQL listo para el SQL Editor de Supabase: ${salida}\n`);
