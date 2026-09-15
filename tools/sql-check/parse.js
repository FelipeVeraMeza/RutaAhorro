const fs = require('fs');
const path = require('path');
const factory = require('pg-query-emscripten').default;

const dir = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const only = process.argv[2];

(async () => {
  let bad = 0;
  for (const f of files) {
    if (only && f !== only) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const pg = await factory();            // instancia fresca por archivo
    let res;
    try { res = pg.parse(sql); }
    catch (e) { console.log(`CRASH ${f}: ${e.message}`); bad++; continue; }

    if (res.error) {
      bad++;
      const line = sql.slice(0, res.error.cursorpos).split('\n').length;
      console.log(`FAIL ${f}`);
      console.log(`     ${res.error.message} -> linea ~${line}`);
      console.log(`     >> ${(sql.split('\n')[line-1]||'').trim()}`);
    } else {
      console.log(`OK   ${f.padEnd(30)} ${String(res.parse_tree?.stmts?.length ?? 0).padStart(3)} sentencias`);
    }
  }
  console.log(bad === 0 ? '\n==> SQL OK' : `\n==> ${bad} con error`);
  process.exit(bad ? 1 : 0);
})();
