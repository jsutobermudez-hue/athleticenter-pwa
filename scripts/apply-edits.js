// Aplica reemplazos exactos definidos en un JSON: [{ "file": "...", "find": "...", "replace": "...", "all": false }]
// Normaliza saltos de línea (find/replace con \n funcionan en archivos CRLF). Falla si algún 'find' no aparece.
// Uso: node scripts/apply-edits.js <edits.json>
const fs = require('fs');
const edits = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let failed = 0;
const cache = {};
for (const e of edits) {
  if (!cache[e.file]) {
    const raw = fs.readFileSync(e.file, 'utf8');
    cache[e.file] = { crlf: raw.includes('\r\n'), text: raw.replace(/\r\n/g, '\n') };
  }
  const c = cache[e.file];
  const find = e.find.replace(/\r\n/g, '\n');
  const repl = e.replace.replace(/\r\n/g, '\n');
  const count = c.text.split(find).length - 1;
  if (count === 0) { console.error(`NO ENCONTRADO en ${e.file}: ${find.slice(0, 80)}`); failed++; continue; }
  if (count > 1 && !e.all) { console.error(`AMBIGUO (${count}x) en ${e.file}: ${find.slice(0, 80)}`); failed++; continue; }
  c.text = e.all ? c.text.split(find).join(repl) : c.text.replace(find, () => repl);
  console.log(`OK ${e.file}: ${find.slice(0, 60).replace(/\n/g, '⏎')}`);
}
if (failed) { console.error(`${failed} edición(es) fallida(s). No se escribió ningún archivo.`); process.exit(1); }
for (const [file, c] of Object.entries(cache)) fs.writeFileSync(file, c.crlf ? c.text.replace(/\n/g, '\r\n') : c.text, 'utf8');
console.log('Archivos escritos:', Object.keys(cache).length);
