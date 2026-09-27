const fs = require('fs');
const path = require('path');
const factory = require('pg-query-emscripten').default;

const dir = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const only = process.argv[2];

// El parser compilado a WebAssembly se cae ("… is not a function") con
// archivos grandes: 0019 tiene 55 KB y no se podía validar entero, aunque cada
// parte por separado estaba bien. Se valida por secciones —los separadores
// `-- ----…` de las migraciones siempre caen entre sentencias—, cada una con
// una instancia fresca.
function secciones(sql) {
  const partes = [];
  let inicio = 0;
  const re = /\n(?=-- -{20,})/g;
  let m;
  while ((m = re.exec(sql))) {
    partes.push({ texto: sql.slice(inicio, m.index + 1), desde: inicio });
    inicio = m.index + 1;
  }
  partes.push({ texto: sql.slice(inicio), desde: inicio });
  return partes;
}

(async () => {
  let bad = 0;
  for (const f of files) {
    if (only && f !== only) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    let sentencias = 0;
    let fallo = null;
    for (const parte of secciones(sql)) {
      const pg = await factory();            // instancia fresca por sección
      let res;
      try { res = pg.parse(parte.texto); }
      catch (e) { fallo = { crash: e.message, desde: parte.desde }; break; }
      if (res.error) { fallo = { error: res.error, desde: parte.desde }; break; }
      sentencias += res.parse_tree?.stmts?.length ?? 0;
    }

    if (fallo?.crash) {
      bad++;
      const line = sql.slice(0, fallo.desde).split('\n').length;
      console.log(`CRASH ${f} (sección desde la línea ~${line}): ${fallo.crash}`);
    } else if (fallo) {
      bad++;
      const line = sql.slice(0, fallo.desde + fallo.error.cursorpos).split('\n').length;
      console.log(`FAIL ${f}`);
      console.log(`     ${fallo.error.message} -> linea ~${line}`);
      console.log(`     >> ${(sql.split('\n')[line-1]||'').trim()}`);
    } else {
      console.log(`OK   ${f.padEnd(30)} ${String(sentencias).padStart(3)} sentencias`);
    }
  }
  console.log(bad === 0 ? '\n==> SQL OK' : `\n==> ${bad} con error`);
  process.exit(bad ? 1 : 0);
})();
