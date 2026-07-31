'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || '.';
const outPath = process.argv[3];
const skip = new Set(['node_modules', 'dist', 'android', 'backups', 'functions', '.git', 'test-results']);

function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      const top = path.relative(root, p).split(path.sep)[0];
      if (skip.has(e.name) || skip.has(top)) continue;
      walk(p, acc);
    } else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const files = walk(root, []);
const defs = new Map();
const reAssign = /\b(?:global(?:This)?|window)\.([A-Za-z_$][\w$]*)\s*=/g;

for (const f of files) {
  let t;
  try { t = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  let m;
  reAssign.lastIndex = 0;
  while ((m = reAssign.exec(t))) {
    const k = m[1];
    if (!defs.has(k)) defs.set(k, []);
    const arr = defs.get(k);
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (arr.length < 5 && !arr.includes(rel)) arr.push(rel);
  }
}

const keys = [...defs.keys()].sort();
const jamia = keys.filter((k) => k === 'JamiaApp' || k.startsWith('Jamia'));
const lines = [];
lines.push('# Auto-extracted window/globalThis assignments');
lines.push('Generated: ' + new Date().toISOString());
lines.push('Total unique names: ' + keys.length);
lines.push('');
for (const k of keys) {
  lines.push('- `' + k + '` — ' + defs.get(k).join(', '));
}
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log('Wrote', outPath, 'keys', keys.length, 'jamia', jamia.length);
