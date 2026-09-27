/**
 * Matriz de requerimientos con evidencia (docs/24).
 *
 *   node tools/matriz.mjs
 *
 * Cruza los requerimientos (docs/03 funcionales, docs/04 no funcionales) con
 * lo que dice el inventario (docs/17) y, sobre todo, con la EVIDENCIA: qué
 * prueba automática o recorrido en el navegador cita cada requerimiento.
 *
 * La regla del proyecto (HANDOFF, regla 20): un requerimiento no está hecho
 * hasta que se recorrió. Acá "verificado" significa que hay una prueba que lo
 * cita y que esa prueba pasa en la última corrida registrada. Un ✅ del
 * inventario sin prueba que lo respalde queda como "sin evidencia", no como
 * hecho: ya pasó tres veces que un ✅ no funcionaba.
 *
 * Los resultados de los recorridos se leen de tools/ui/.resultado-*.json (los
 * deja cada recorrido al terminar). Las pruebas de la base y de core se
 * cuentan por el identificador en el nombre o en un comentario de la prueba.
 */
import fs from 'node:fs';
import path from 'node:path';

const raiz = process.cwd();
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

// ---------------------------------------------------------------- requerimientos
const reqs = [];
for (const linea of leer('docs/03-requerimientos-funcionales.md').split('\n')) {
  const m = linea.match(/^\| *(RF-M\d+-\d+) *\| *(.+?) *\| *([MSCW]) *\|/);
  if (m) reqs.push({ id: m[1], texto: m[2], prioridad: m[3], tipo: 'RF' });
}
for (const linea of leer('docs/04-requerimientos-no-funcionales.md').split('\n')) {
  const m = linea.match(/^\| *(RNF-\d+) *\| *(.+?) *\| *(.+?) *\|/);
  if (m && !reqs.some((r) => r.id === m[1])) reqs.push({ id: m[1], texto: m[2], prioridad: '', tipo: 'RNF', criterio: m[3] });
}

// ---------------------------------------------------------------- estado del inventario
const inventario = new Map();
for (const linea of leer('docs/17-inventario-alcance.md').split('\n')) {
  const m = linea.match(/^\| *(?:RF-)?(M\d+-\d+|RNF-\d+) *\|[^|]*\| *(✅|🔵|🟡|⬜)/u);
  if (m) inventario.set(m[1].startsWith('RNF') ? m[1] : `RF-${m[1]}`, m[2]);
}

// ---------------------------------------------------------------- evidencia
/** Identificadores que cita un texto: RF-M5-05, M5-05, RNF-45. */
function citas(texto) {
  const ids = new Set();
  for (const m of texto.matchAll(/\b(?:RF-)?(M\d{1,2}-\d{2})\b/g)) ids.add(`RF-${m[1]}`);
  for (const m of texto.matchAll(/\bRNF-(\d{1,2})\b/g)) ids.add(`RNF-${m[1].padStart(2, '0')}`);
  return ids;
}

const evidencia = new Map();   // id -> [{fuente, ok}]
const anotar = (id, fuente, ok) => {
  if (!evidencia.has(id)) evidencia.set(id, []);
  evidencia.get(id).push({ fuente, ok });
};

// Recorridos: resultado real de la última corrida.
const dirUi = path.join(raiz, 'tools/ui');
for (const f of fs.readdirSync(dirUi).filter((x) => x.startsWith('.resultado-') && x.endsWith('.json'))) {
  const recorrido = f.replace('.resultado-', '').replace('.json', '');
  for (const r of JSON.parse(fs.readFileSync(path.join(dirUi, f), 'utf8'))) {
    for (const id of citas(`${r.rf} ${r.texto}`)) anotar(id, `recorrido ${recorrido}`, r.cumple);
  }
}
// Pruebas de base y de core: citas en el archivo (nombres de prueba y comentarios).
const archivosPrueba = [
  ...fs.readdirSync(path.join(raiz, 'tools/pg-test')).filter((f) => f.endsWith('.test.mjs')).map((f) => `tools/pg-test/${f}`),
  ...fs.readdirSync(path.join(raiz, 'packages/core/test')).filter((f) => f.endsWith('.test.ts')).map((f) => `packages/core/test/${f}`),
];
for (const f of archivosPrueba) {
  for (const id of citas(leer(f))) anotar(id, f.replace(/^.*\//, ''), true);
}
// El recorrido de celular mide RNF-16 (44 px) en todas las pantallas.
if (fs.existsSync(path.join(dirUi, '.resultado-movil.json'))) {
  const problemas = JSON.parse(fs.readFileSync(path.join(dirUi, '.resultado-movil.json'), 'utf8'));
  anotar('RNF-16', 'recorrido movil (todas las pantallas)', problemas.length === 0);
}

// ---------------------------------------------------------------- veredicto
function veredicto(r) {
  const ev = evidencia.get(r.id) ?? [];
  const inv = inventario.get(r.id) ?? '—';
  if (ev.some((e) => !e.ok)) return { v: '❌', nota: 'una prueba que lo cita FALLA' };
  if (ev.length) return { v: '✅', nota: '' };
  if (inv === '✅') return { v: '⚠️', nota: 'el inventario dice hecho, pero ninguna prueba lo cita' };
  return { v: inv === '—' ? '⬜' : inv, nota: '' };
}

const filas = reqs.map((r) => ({ ...r, ...veredicto(r), inv: inventario.get(r.id) ?? '—', ev: evidencia.get(r.id) ?? [] }));
const cuenta = (tipo, v) => filas.filter((f) => f.tipo === tipo && f.v === v).length;

let md = `# 24 — Matriz de requerimientos con evidencia

**Generado por \`node tools/matriz.mjs\` el ${new Date().toISOString().slice(0, 10)}.** No se edita a mano:
se regenera. Cruza [03](03-requerimientos-funcionales.md) y [04](04-requerimientos-no-funcionales.md)
con el [inventario](17-inventario-alcance.md) y con las pruebas.

**Qué significa cada estado**

| | |
|:--:|---|
| ✅ | **Verificado**: al menos una prueba automática o un recorrido en el navegador lo cita, y en la última corrida pasó |
| ❌ | Una prueba que lo cita falla |
| ⚠️ | El inventario lo marca hecho, pero **ninguna prueba lo demuestra**. No se da por hecho (regla 20) |
| 🔵 🟡 ⬜ | Lo que dice el inventario, sin evidencia automática: en la base sin pantalla, parcial, no empezado |

## Resumen

| | ✅ | ❌ | ⚠️ | 🔵 | 🟡 | ⬜ | Total |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Funcionales | ${cuenta('RF', '✅')} | ${cuenta('RF', '❌')} | ${cuenta('RF', '⚠️')} | ${cuenta('RF', '🔵')} | ${cuenta('RF', '🟡')} | ${cuenta('RF', '⬜')} | ${filas.filter((f) => f.tipo === 'RF').length} |
| No funcionales | ${cuenta('RNF', '✅')} | ${cuenta('RNF', '❌')} | ${cuenta('RNF', '⚠️')} | ${cuenta('RNF', '🔵')} | ${cuenta('RNF', '🟡')} | ${cuenta('RNF', '⬜')} | ${filas.filter((f) => f.tipo === 'RNF').length} |

`;
let modulo = '';
for (const f of filas) {
  const mod = f.tipo === 'RF' ? f.id.match(/RF-(M\d+)/)[1] : 'RNF';
  if (mod !== modulo) {
    modulo = mod;
    md += `\n## ${mod === 'RNF' ? 'No funcionales' : `Módulo ${mod}`}\n\n| | ID | Requerimiento | Inventario | Evidencia |\n|:-:|---|---|:-:|---|\n`;
  }
  const fuentes = [...new Set(f.ev.map((e) => e.fuente))].slice(0, 3).join(', ');
  const texto = f.texto.replace(/\|/g, '/').slice(0, 140);
  md += `| ${f.v} | ${f.id} | ${texto} | ${f.inv} | ${fuentes || f.nota}${fuentes && f.nota ? ' · ' + f.nota : ''} |\n`;
}
fs.writeFileSync(path.join(raiz, 'docs/24-matriz-requerimientos.md'), md);
console.log(`RF:  ✅ ${cuenta('RF', '✅')} · ❌ ${cuenta('RF', '❌')} · ⚠️ ${cuenta('RF', '⚠️')} · 🔵 ${cuenta('RF', '🔵')} · 🟡 ${cuenta('RF', '🟡')} · ⬜ ${cuenta('RF', '⬜')} de ${filas.filter((x) => x.tipo === 'RF').length}`);
console.log(`RNF: ✅ ${cuenta('RNF', '✅')} · ❌ ${cuenta('RNF', '❌')} · ⚠️ ${cuenta('RNF', '⚠️')} · 🔵 ${cuenta('RNF', '🔵')} · 🟡 ${cuenta('RNF', '🟡')} · ⬜ ${cuenta('RNF', '⬜')} de ${filas.filter((x) => x.tipo === 'RNF').length}`);
