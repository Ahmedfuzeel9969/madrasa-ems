/**
 * Workspace backup before deploy — copies source (excludes node_modules, dist, .firebase)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const DEST = path.join(ROOT, '..', 'ems-backup-' + stamp);

const SKIP = new Set(['node_modules', 'dist', '.firebase', '.git']);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach(function (ent) {
    if (SKIP.has(ent.name)) return;
    if (ent.name.startsWith('.') && ent.name !== '.firebaserc') return;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  });
}

console.log('[backup] Copying to:', DEST);
copyDir(ROOT, DEST);
console.log('[backup] Done —', DEST);
