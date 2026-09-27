const fs = require('fs');
const path = require('path');
const factory = require('pg-query-emscripten').default;

const dir = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

// Por secciones, con una instancia fresca cada una: el parser en WebAssembly
// se cae con archivos grandes (0019). Ver parse.js.
function secciones(sql) {
  return sql.split(/\n(?=-- -{20,})/);
}

(async () => {
  let bad = 0, total = 0;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/language\s+plpgsql/i.test(sql)) { console.log(`--   ${f} (sin plpgsql)`); continue; }
    let n = 0;
    let fallo = null;
    for (const parte of secciones(sql)) {
      // Todas las secciones: un bloque `do $$ … $$` es PL/pgSQL sin decirlo.
      const pg = await factory();
      let r;
      try { r = pg.parsePlpgsql(parte); }
      catch (e) { fallo = `CRASH ${e.message}`; break; }
      if (r && r.error) { fallo = r.error.message; break; }
      n += (r.plpgsql_funcs || []).length;
    }
    if (fallo) {
      bad++;
      console.log(`FAIL ${f}: ${fallo}`);
    } else {
      total += n;
      console.log(`OK   ${f.padEnd(30)} ${String(n).padStart(2)} funciones plpgsql`);
    }
  }
  console.log(bad === 0 ? `\n==> ${total} cuerpos PL/pgSQL compilan OK` : `\n==> ${bad} con error`);
  process.exit(bad ? 1 : 0);
})();
