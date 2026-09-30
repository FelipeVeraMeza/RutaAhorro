/**
 * RNF-62 · Peso del JavaScript de la primera carga, por pantalla.
 *
 * El celular del mostrador es de gama baja y a veces con datos móviles: cada
 * kB de JS es tiempo de espera antes de poder vender. Corre DESPUÉS de
 * compilar (npm run build:web) y falla si alguna pantalla supera el límite.
 *
 *   node tools/peso-js.mjs            # falla sobre 270 kB (gzip); meta 250 kB
 *   LIMITE_KB=260 node tools/peso-js.mjs
 *
 * Suma, sin repetir, los archivos JS de la página y de TODOS los layouts que
 * la envuelven, comprimidos con gzip (lo que viaja por la red). Por eso da
 * más que la columna "First Load JS" de `next build`, que no cuenta los
 * componentes de cliente del layout de la app (menú, sincronización del
 * catálogo, estado de conexión): /ayuda figura con 106 kB y en realidad baja
 * ~240 kB. Este es el número que paga el celular.
 *
 * El límite (270) frena que crezca; la meta (250) es adonde hay que llegar.
 */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const NEXT = new URL('../apps/web/.next/', import.meta.url).pathname;
const LIMITE = Number(process.env.LIMITE_KB ?? 270);
const META = 250;
const manifiesto = join(NEXT, 'app-build-manifest.json');
if (!existsSync(manifiesto)) {
  console.error('No hay compilación: corre primero `npm run build:web`.');
  process.exit(2);
}
const { pages } = JSON.parse(readFileSync(manifiesto, 'utf8'));
const cache = new Map();
const peso = (f) => {
  if (!cache.has(f)) cache.set(f, gzipSync(readFileSync(join(NEXT, f))).length);
  return cache.get(f);
};

const layouts = Object.keys(pages).filter((k) => k.endsWith('/layout'));
const filas = [];
for (const [clave, archivos] of Object.entries(pages)) {
  if (!clave.endsWith('/page')) continue;
  const base = clave.slice(0, -'/page'.length);
  const todos = new Set(archivos);
  for (const l of layouts) {
    const dir = l.slice(0, -'/layout'.length);
    if (dir === '' || base === dir || base.startsWith(dir + '/')) for (const f of pages[l]) todos.add(f);
  }
  const kb = [...todos].filter((f) => f.endsWith('.js')).reduce((s, f) => s + peso(f), 0) / 1024;
  const ruta = base.replace(/\/\([^)]+\)/g, '') || '/';
  filas.push({ ruta, kb });
}
filas.sort((a, b) => b.kb - a.kb);
let malas = 0;
for (const { ruta, kb } of filas) {
  const pasa = kb <= LIMITE;
  if (!pasa) malas++;
  console.log(`${pasa ? '✔' : '✖'} ${kb.toFixed(0).padStart(4)} kB  ${ruta}`);
}
const enMeta = filas.filter((f) => f.kb <= META).length;
console.log(`\nRNF-62 · ${filas.length - malas}/${filas.length} pantallas bajo el límite de ${LIMITE} kB · ${enMeta}/${filas.length} en la meta de ${META} kB`);
process.exit(malas ? 1 : 0);
