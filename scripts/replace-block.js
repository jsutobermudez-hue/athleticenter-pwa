// Reemplaza en un archivo el bloque entre dos marcadores (inicio incluido, fin excluido) por el contenido de otro archivo.
// Uso: node scripts/replace-block.js <archivo> <marcadorInicio> <marcadorFin> <archivoReemplazo>
const fs = require('fs');
const [file, startMarker, endMarker, replFile] = process.argv.slice(2);
let s = fs.readFileSync(file, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const a = s.indexOf(startMarker);
const b = endMarker === 'EOF' ? s.length : s.indexOf(endMarker, a + 1);
if (a < 0 || b < 0) { console.error(`Marcadores no encontrados: start=${a} end=${b}`); process.exit(1); }
let repl = fs.readFileSync(replFile, 'utf8').replace(/\r\n/g, '\n');
if (nl === '\r\n') repl = repl.replace(/\n/g, '\r\n');
s = s.slice(0, a) + repl + s.slice(b);
fs.writeFileSync(file, s, 'utf8');
console.log(`OK: reemplazados ${b - a} caracteres en ${file}`);
