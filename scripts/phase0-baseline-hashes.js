'use strict';
/**
 * Phase 0 baseline — SHA-256 of runtime source (not generated trees).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIR = new Set([
  'node_modules', 'dist', 'android', 'backups', '.firebase', '.git', '.cmi',
  'test-results', 'playwright-report', 'blob-report'
]);

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function shouldSkipDir(name, relParts) {
  if (SKIP_DIR.has(name)) return true;
  if (name === 'node_modules') return true;
  if (name === 'release' && relParts[0] === 'desktop') return true;
  if (name === 'release-regent' || (typeof name === 'string' && name.indexOf('release-regent') === 0)) return true;
  return false;
}

const RUNTIME_EXT = new Set(['.js', '.html', '.css', '.json', '.mjs', '.cjs']);
const ROOT_CONFIG = new Set([
  'package.json', 'package-lock.json', 'capacitor.config.json', 'firebase.json',
  '.firebaserc', 'firestore.rules', 'firestore.indexes.json', 'storage.rules',
  'vitest.config.js', 'playwright.config.js'
]);

const files = [];

function walk(dir, relParts) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of ents) {
    if (ent.name.startsWith('.') && ent.name !== '.firebaserc') {
      if (ent.name === '.gitignore') {
        // include
      } else if (!ent.isFile()) {
        continue;
      } else if (ent.name !== '.firebaserc' && ent.name !== '.gitignore') {
        continue;
      }
    }
    const abs = path.join(dir, ent.name);
    const rel = relParts.concat(ent.name);
    const relStr = rel.join('/');
    if (ent.isDirectory()) {
      if (shouldSkipDir(ent.name, relParts)) continue;
      if (ent.name === 'node_modules') continue;
      if (relParts[0] === 'functions' && ent.name === 'node_modules') continue;
      if (relParts[0] === 'android') continue;
      walk(abs, rel);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      const top = relParts[0];
      const isRootFile = relParts.length === 0;
      const underSrc = top === 'src' || top === 'cloud' || top === 'sa' || top === 'vendor'
        || top === 'scripts' || top === 'tests' || top === 'bench' || top === 'desktop';
      const underFunctions = top === 'functions';
      const isHtmlCss = ext === '.html' || ext === '.css';
      const isJs = ext === '.js' || ext === '.mjs' || ext === '.cjs';
      const isConfig = ROOT_CONFIG.has(ent.name) || (isRootFile && ext === '.json');
      if (ent.name === '.gitignore' || ent.name === '.firebaserc') {
        files.push(relStr);
        continue;
      }
      if (underFunctions && (isJs || ent.name === 'package.json' || ent.name === 'package-lock.json')) {
        files.push(relStr);
        continue;
      }
      if (isRootFile && (isJs || isHtmlCss || isConfig)) {
        files.push(relStr);
        continue;
      }
      if (underSrc && RUNTIME_EXT.has(ext)) {
        files.push(relStr);
        continue;
      }
    }
  }
}

walk(ROOT, []);
files.sort();

const rows = [];
let totalBytes = 0;
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const buf = fs.readFileSync(abs);
  totalBytes += buf.length;
  rows.push({
    path: rel.replace(/\\/g, '/'),
    bytes: buf.length,
    sha256: sha256(buf)
  });
}

const out = {
  createdAt: new Date().toISOString(),
  root: ROOT,
  fileCount: rows.length,
  totalBytes: totalBytes,
  excludes: [
    'node_modules/', 'dist/', 'android/', 'backups/', 'desktop/release/',
    'functions/node_modules/', 'test-results/', '.firebase/', '.cmi/'
  ],
  note: 'android/ and dist/ excluded as generated/verification artifacts; functions lib JS included as server source',
  files: rows
};

const outDir = path.join(ROOT, 'docs', 'baselines');
fs.mkdirSync(outDir, { recursive: true });
const stamp = out.createdAt.replace(/[:.]/g, '-');
const jsonPath = path.join(outDir, 'PHASE0-RUNTIME-HASHES-' + stamp + '.json');
const latestPath = path.join(outDir, 'PHASE0-RUNTIME-HASHES-latest.json');
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
fs.writeFileSync(latestPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  jsonPath: jsonPath,
  latestPath: latestPath,
  fileCount: rows.length,
  totalBytes: totalBytes
}, null, 2));
