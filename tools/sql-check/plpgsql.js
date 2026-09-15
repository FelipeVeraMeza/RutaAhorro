const fs = require('fs');
const path = require('path');
const factory = require('pg-query-emscripten').default;

const dir = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

(async () => {
  let bad = 0, total = 0;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/language\s+plpgsql/i.test(sql)) { console.log(`--   ${f} (sin plpgsql)`); continue; }
    const pg = await factory();
    let r;
    try { r = pg.parsePlpgsql(sql); }
    catch (e) { console.log(`CRASH ${f}: ${e.message}`); bad++; continue; }
    if (r && r.error) {
      bad++;
      console.log(`FAIL ${f}: ${r.error.message}`);
    } else {
      const n = (r.plpgsql_funcs || []).length;
      total += n;
      console.log(`OK   ${f.padEnd(30)} ${String(n).padStart(2)} funciones plpgsql`);
    }
  }
  console.log(bad === 0 ? `\n==> ${total} cuerpos PL/pgSQL compilan OK` : `\n==> ${bad} con error`);
  process.exit(bad ? 1 : 0);
})();
