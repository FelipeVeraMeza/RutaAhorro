/**
 * tools/convertir-catalogo.mjs · casos de la planilla real del sistema anterior.
 *   node --test tools/convertir-catalogo.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precioPublico, codigoDeBarras, tasaAdicional, leerNeto, convertirCatalogo, leerTexto } from './convertir-catalogo.mjs';

test('precio: neto + IVA, subido a la decena; el caso del bon o bon blanco', () => {
  assert.equal(precioPublico(1218), 1450);           // 1.449,42
  assert.equal(precioPublico(1000), 1190);           // sin el error de coma flotante (1190,0000000002)
  assert.equal(precioPublico(840.33), 1000);          // 999,99
  assert.equal(precioPublico(1), 0);
  assert.equal(precioPublico(0), 0);
  assert.equal(precioPublico(null), 0);
});

test('bebidas del art. 42: el IABA va incluido; la de 3 L queda en $1.990', () => {
  assert.equal(tasaAdicional('IMPUESTO ART. 42, LEY DE IVA LETRA A) PÁRRAFO 2°'), 0.18);
  assert.equal(tasaAdicional('IMPUESTO ART. 42, LEY DE IVA LETRA A)'), 0.10);
  assert.equal(tasaAdicional(''), 0);
  assert.equal(precioPublico(1672.2), 1990);    // 1.989,92: el precio de la repisa
  assert.equal(precioPublico(1672.26), 1990);
});

test('el neto con coma decimal chilena', () => {
  assert.equal(leerNeto('1672,26'), 1672.26);
  assert.equal(leerNeto('16722'), 16722);
  assert.equal(leerNeto(''), null);
});

test('códigos: solo los de barras de verdad', () => {
  assert.equal(codigoDeBarras('7802225640848'), '7802225640848');
  assert.equal(codigoDeBarras(' 8445291870314'), '8445291870314');
  assert.equal(codigoDeBarras('021000002696'), '0021000002696', '12 dígitos → con 0, como el sistema');
  assert.equal(codigoDeBarras('111111111'), null);
  assert.equal(codigoDeBarras('AC0021'), null);
  assert.equal(codigoDeBarras('I- 2077'), null);
  assert.equal(codigoDeBarras('676'), null);
  assert.equal(codigoDeBarras('7613031291359z'), null);
});

test('una planilla con repetidos, internos y comillas sale importable', () => {
  const txt = [
    'Descripción\tID interno\tSKU\tSKU Interno\tUnidad de Medida\tPrecio de Venta Neto\tStock Mínimo\tStock Máximo\tFamilia\tImpuesto Adicional',
    'ARVERJITAS CONGELADAS 1 KG \t3719022\t7801222133995\t\tUN\t1672,26\t0\t0\t\t',
    'Arvejas Interagro 1k\t5148731\t7801222133995\tarv3995\tUN\t1932,77\t0\t0\t\t',
    ' PAPA ONE FRY 12mm 7X 2,5\t3473098\t71699008173996 \t\tUN\t1\t\t\t\t',
    '106030105921   TAPA CARTON C10\t3473070\t106030105921 \t\tUN\t1\t\t\t\t',
    '"\tCHICKEN FINGERS REB 3k SADIA BOLSA"\t3712882\t7893000747302\t\tun\t13857,14\t0\t0\t\t',
    'BILZ PET3000\t3473076\t7801620001193\t\tUN\t16722\t0\t0\t\tIMPUESTO ART. 42, LEY DE IVA LETRA A) PÁRRAFO 2°',
    'TE CLUB 100 BOLSAS \t4042560\tI- 2077\t\tun\t1950\t0\t0\t\t',
  ].join('\n');
  const { csv, inf } = convertirCatalogo(leerTexto(txt));
  const filas = csv.trim().split('\r\n');
  assert.equal(filas.length, 8);
  assert.match(filas[5], /^CHICKEN FINGERS REB 3k SADIA BOLSA;;3712882;7893000747302;;16490;/);
  assert.equal(inf.codigoRepetido.length, 1, 'el 7801222133995 queda en las arvejitas, el primero');
  assert.ok(inf.codigoMalo.some((x) => x.includes('71699008173996')), '71699008173996 tiene el dígito de control malo');
  assert.ok(filas[4].startsWith('TAPA CARTON C10;'), 'sin el código pegado al nombre');
  assert.match(filas[7], /^TE CLUB 100 BOLSAS;Código anterior: I- 2077;4042560;;;2330;/);
  assert.ok(inf.revisarPrecio.some((x) => x.startsWith('BILZ PET3000')), 'BILZ a $19.900 (le faltó la coma) se marca para revisar');
  assert.equal(inf.iaba18.length, 1);
});

test('lo ya cargado en el local queda fuera; lo parecido sin código se avisa', async () => {
  const { leerExistentes, parecido } = await import('./convertir-catalogo.mjs');
  assert.ok(parecido('Nutella 350g', 'nutella 350 grs') === 1);
  assert.ok(parecido('Galleta bon o bon blanco 95g', 'BON O BON BLANCO COOKIES') >= 0.6);
  assert.ok(parecido('Nutella 350g', 'MANTECOL LINGOTE') === 0);
  const existentes = leerExistentes(leerTexto([
    '\uFEFFnombre;codigo_interno;codigos_de_barra;categoria;precio_venta',
    'Galleta bon o bon blanco 95g;;7802225640848;;1450',
    'Nutella 350g;;;;5490',
  ].join('\r\n')));
  const txt = [
    'Descripción\tID interno\tSKU\tPrecio de Venta Neto\tImpuesto Adicional',
    'BON O BON BLANCO COOKIES\t3642197\t7802225640848\t1218\t',
    'nutella 350 grs\t3553732\t80177173\t5033,61\t',
    'MANTECOL LINGOTE\t4480746\t7790380026402\t5033\t',
  ].join('\n');
  const { csv, inf } = convertirCatalogo(leerTexto(txt), existentes);
  const filas = csv.trim().split('\r\n');
  assert.equal(filas.length, 3, 'el bon o bon blanco ya estaba: queda fuera');
  assert.equal(inf.yaCargado.length, 1);
  assert.equal(inf.posibleDuplicado.length, 1, 'nutella se parece a la que ya está, sin código');
  assert.match(inf.posibleDuplicado[0], /Nutella 350g/);
});
