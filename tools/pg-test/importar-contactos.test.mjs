/**
 * tools/importar-contactos.mjs contra la base local: el SQL que genera entra
 * entero, no duplica al correrlo dos veces, no pisa lo que ya estaba y se
 * detiene sin tocar nada si hay más de un local activo.
 *
 * Las filas son de la planilla real de Felipe (2026-10-13), recortadas a las
 * columnas que se leen.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { levantarBanco, nuevoLocal, intentar } from './banco.mjs';

let banco;
before(async () => { banco = await levantarBanco(); });
after(async () => { await banco?.bajar(); });

const TITULOS = ['Rut', 'Razón Social', 'Giro', 'Dirección', 'Ciudad', 'Comuna', 'Mail', 'Teléfono', 'Contacto',
  'Concepto Compras', 'Cliente', 'Proveedor', 'Empleado', 'Nombre Contacto', 'Mail Contacto'];
const FILAS = [
  // Proveedor marcado con S.
  ['97.036.000-K', 'Santander - Chile', 'Banco Comercial', 'Bandera 140', 'Santiago', 'Santiago Centro', '', '', '', 'Gastos Bancarios', 'N', 'S', 'N', '', ''],
  // Sin S, pero con concepto de compra: proveedor.
  ['96.792.430-K', 'SODIMAC S.A.', '', '', '', '', '', '', '', 'Gastos Generales', 'N', 'N', 'N', '', ''],
  // Cliente marcado con S, con correo de contacto mal escrito (gmial) que igual tiene forma de correo.
  ['76.886.014-9', 'KING-ROLLS SPA', 'Suministro de comidas por encargo', 'PARQUE CENTRAL ORIENTE 591', 'SANTIAGO', 'MAIPU', '', '', '', '', 'S', 'N', 'N', 'KARINA CISTERNA', 'kary.andrea.cisterna@gmial.com'],
  // Ni cliente ni proveedor, sin concepto: cliente (restaurante).
  ['6.212.011-8', 'JUAN ERNESTO LAZO CACERES', 'comida rapida', 'MIGUEL DE CERVANTES 6522', 'CERRO NAVIA', '', '', '', '', '', 'N', 'N', 'N', '', ''],
  // Empleada: se omite.
  ['15.620.607-5', 'maria jose belmar bobadilla', '', '', '', '', 'majobelbo@yahoo.es', '', '', '', 'N', 'N', 'S', '', ''],
  // Genérico: se omite.
  ['11.111.111-1', 'CLIENTE GENÉRICO SPyme', 'GIRO GENERICO', 'DIRECCION GENERICA', 'las condes', 'generico', '', '', '', '', 'N', 'N', 'N', '', ''],
  // Con correo y teléfono.
  ['12.246.776-7', 'Pamela Díaz', 'Comida rápida', 'Obispo Javier Vasquez #3902,', 'SANTIAGO', 'Estacion central', 'Pameladiazcaica@gmail.com', '998042363', '+56938938786', '', 'S', 'N', 'N', '', ''],
  // RUT con dígito verificador equivocado: se omite.
  ['76.086.428-4', 'RUT MALO SPA', '', '', '', '', '', '', '', '', 'S', 'N', 'N', '', ''],
];

function generarSql(...extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contactos-'));
  const archivo = path.join(dir, 'contactos.txt');
  fs.writeFileSync(archivo, [TITULOS, ...FILAS].map((f) => f.join('\t')).join('\r\n'));
  const salida = execFileSync(process.execPath, ['tools/importar-contactos.mjs', archivo, ...extra], { encoding: 'utf8' });
  return { sql: fs.readFileSync(path.join(dir, 'contactos-importar.sql'), 'utf8'), salida };
}

const cuenta = async (tabla, tenant) =>
  Number((await banco.su.query(`select count(*) from ${tabla} where tenant_id = $1`, [tenant])).rows[0].count);

test('con más de un local activo se detiene sin tocar nada', async () => {
  const A = await nuevoLocal(banco, 'Uno');
  await nuevoLocal(banco, 'Dos');
  const { sql } = generarSql();
  const r = await intentar(banco.su.query(sql));
  assert.ok(!r.ok, 'tenía que fallar');
  assert.equal(await cuenta('clientes', A.tenant), 0);
});

test('importa clientes y proveedores, omite empleados, genéricos y RUT malos, y se puede repetir', async () => {
  // Un solo local activo: los demás de la base de pruebas se suspenden.
  const L = await nuevoLocal(banco, 'Almacén');
  await banco.su.query(`update tenants set status = 'suspendido' where id <> $1`, [L.tenant]);
  // Ya existía un cliente con datos: no se le pisan, solo se completa lo vacío.
  await banco.su.query(`insert into clientes (tenant_id, rut, nombre, email) values ($1, '6.212.011-8', 'Juan Lazo (a mano)', null)`, [L.tenant]);
  await banco.su.query(`insert into suppliers (tenant_id, name, rut, phone) values ($1, 'Santander', '97036000-K', '600 320 3000')`, [L.tenant]);

  const { sql, salida } = generarSql();
  assert.match(salida, /Clientes:\s+3/);
  assert.match(salida, /Proveedores:\s+2/);
  assert.match(salida, /es empleado 15\.620\.607-5/);
  assert.match(salida, /RUT genérico 11\.111\.111-1/);
  assert.match(salida, /RUT inválido 76\.086\.428-4/);

  await banco.su.query(sql);
  await banco.su.query(sql); // dos veces: no duplica

  const { rows: cli } = await banco.su.query(
    `select rut, nombre, giro, comuna, email, telefono from clientes where tenant_id = $1 order by rut`, [L.tenant]);
  assert.equal(cli.length, 3);
  const juan = cli.find((c) => c.rut === '6.212.011-8');
  assert.equal(juan.nombre, 'Juan Lazo (a mano)', 'no pisó el nombre');
  assert.equal(juan.giro, 'comida rapida', 'completó el giro vacío');
  const pamela = cli.find((c) => c.rut === '12.246.776-7');
  assert.deepEqual([pamela.email, pamela.telefono, pamela.comuna], ['pameladiazcaica@gmail.com', '998042363', 'Estacion central']);

  const { rows: pro } = await banco.su.query(
    `select name, rut, phone, notes from suppliers where tenant_id = $1 order by name`, [L.tenant]);
  assert.equal(pro.length, 2, 'Santander no se duplicó aunque su RUT estaba escrito distinto');
  const santander = pro.find((p) => p.name === 'Santander');
  assert.equal(santander.phone, '600 320 3000', 'no pisó el teléfono');
  assert.match(santander.notes, /Concepto: Gastos Bancarios/);
  assert.ok(pro.some((p) => p.rut === '96.792.430-K'), 'Sodimac entró como proveedor por su concepto de compra');
});

// Producción tenía varios locales activos (2026-10-13): con --local se carga en el elegido.
test('con --local carga solo en ese local aunque haya otros activos', async () => {
  const A = await nuevoLocal(banco, 'Real');
  const B = await nuevoLocal(banco, 'Pruebas');
  await banco.su.query(`update tenants set status = 'activo' where id in ($1, $2)`, [A.tenant, B.tenant]);
  const { sql } = generarSql(`--local=${A.tenant}`);
  await banco.su.query(sql);
  assert.equal(await cuenta('clientes', A.tenant), 3);
  assert.equal(await cuenta('clientes', B.tenant), 0, 'no tocó el otro local');
});