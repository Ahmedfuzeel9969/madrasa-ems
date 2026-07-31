/**
 * EMS Hosting Build — immutable dist/ artifact for Firebase Hosting
 * Fixes "content hash doesn't match content" by deploying a frozen copy,
 * not the live workspace root (public: "." anti-pattern).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/** Production-only — never deploy dev/config/source artifacts */
const EXCLUDE_ROOT = new Set([
  'page2.html',
  'playwright.config.js',
  'vitest.config.js',
  'package.json',
  'package-lock.json',
  'firebase.json',
  'firestore.rules',
  'firestore.indexes.json',
  '.firebaserc',
  '.gitignore'
]);

const EXCLUDE_DIR = new Set([
  'node_modules',
  'functions',
  'docs',
  'scripts',
  'dist',
  '.firebase',
  '.git',
  '.cursor'
]);

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function walkCopy(srcDir, destDir, manifest, relBase) {
  if (!fs.existsSync(srcDir)) return;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  entries.forEach(function (ent) {
    if (ent.name.startsWith('.')) return;
    const src = path.join(srcDir, ent.name);
    const rel = relBase ? relBase + '/' + ent.name : ent.name;
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      if (EXCLUDE_DIR.has(ent.name)) return;
      walkCopy(src, dest, manifest, rel);
    } else if (ent.isFile()) {
      copyFile(src, dest);
      manifest[rel.replace(/\\/g, '/')] = {
        bytes: fs.statSync(dest).size,
        sha256: sha256File(dest)
      };
    }
  });
}

function extractCacheBust(indexPath) {
  try {
    const html = fs.readFileSync(indexPath, 'utf8');
    const m = html.match(/\?v=([\w-]+)/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

function buildHosting() {
  console.log('[EMS] Cleaning dist/ …');
  rmDir(DIST);
  ensureDir(DIST);

  const manifest = {
    builtAt: new Date().toISOString(),
    root: ROOT,
    files: {}
  };

  console.log('[EMS] Copying root assets …');
  fs.readdirSync(ROOT, { withFileTypes: true }).forEach(function (ent) {
    if (!ent.isFile()) return;
    if (EXCLUDE_ROOT.has(ent.name)) return;
    if (ent.name.startsWith('.')) return;
    const ext = path.extname(ent.name).toLowerCase();
    if (!['.html', '.css', '.js', '.json', '.ico', '.png', '.svg', '.webp', '.woff', '.woff2'].includes(ext)) {
      return;
    }
    const src = path.join(ROOT, ent.name);
    if (fs.statSync(src).size === 0) {
      return;
    }
    const dest = path.join(DIST, ent.name);
    copyFile(src, dest);
    manifest.files[ent.name] = {
      bytes: fs.statSync(dest).size,
      sha256: sha256File(dest)
    };
  });

  console.log('[EMS] Copying vendor/ …');
  const vendorSrc = path.join(ROOT, 'vendor');
  const vendorDest = path.join(DIST, 'vendor');
  if (fs.existsSync(vendorSrc)) {
    walkCopy(vendorSrc, vendorDest, manifest.files, 'vendor');
  }

  console.log('[EMS] Copying sa/ …');
  const saSrc = path.join(ROOT, 'sa');
  const saDest = path.join(DIST, 'sa');
  if (fs.existsSync(saSrc)) {
    walkCopy(saSrc, saDest, manifest.files, 'sa');
  }

  console.log('[EMS] Copying cloud/ …');
  const cloudSrc = path.join(ROOT, 'cloud');
  const cloudDest = path.join(DIST, 'cloud');
  if (fs.existsSync(cloudSrc)) {
    walkCopy(cloudSrc, cloudDest, manifest.files, 'cloud');
  }

  console.log('[EMS] Copying src/ …');
  const srcSrc = path.join(ROOT, 'src');
  const srcDest = path.join(DIST, 'src');
  if (fs.existsSync(srcSrc)) {
    walkCopy(srcSrc, srcDest, manifest.files, 'src');
  }

  console.log('[EMS] Copying e2e smoke assets …');
  var smokeSrc = path.join(ROOT, 'scripts', 'smoke-legacy-migration.html');
  var smokeDest = path.join(DIST, 'scripts', 'smoke-legacy-migration.html');
  if (fs.existsSync(smokeSrc)) {
    copyFile(smokeSrc, smokeDest);
    manifest.files['scripts/smoke-legacy-migration.html'] = {
      bytes: fs.statSync(smokeDest).size,
      sha256: sha256File(smokeDest)
    };
  }

  console.log('[EMS] Copying bench/ …');
  var benchSrc = path.join(ROOT, 'bench');
  var benchDest = path.join(DIST, 'bench');
  if (fs.existsSync(benchSrc)) {
    walkCopy(benchSrc, benchDest, manifest.files, 'bench');
  }

  const manifestPath = path.join(DIST, '.hosting-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const count = Object.keys(manifest.files).length;
  const totalBytes = Object.values(manifest.files).reduce(function (s, f) { return s + f.bytes; }, 0);

  const bundleMeta = {
    builtAt: manifest.builtAt,
    fileCount: count,
    totalBytes: totalBytes,
    cacheBust: extractCacheBust(path.join(DIST, 'index.html'))
  };
  fs.writeFileSync(
    path.join(DIST, '.desktop-bundle.json'),
    JSON.stringify(bundleMeta, null, 2),
    'utf8'
  );

  validateLoaderCacheBust();

  console.log('[EMS] Build OK — ' + count + ' files, ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB');
  console.log('[EMS] Manifest: dist/.hosting-manifest.json');
  console.log('[EMS] Desktop bundle: dist/.desktop-bundle.json');
  return manifest;
}

function readCacheBustConstant(filePath) {
  try {
    var text = fs.readFileSync(filePath, 'utf8');
    var m = text.match(/CACHE_BUST\s*=\s*'([^']+)'/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

function validateLoaderCacheBust() {
  var postAuthPath = path.join(DIST, 'ems-post-auth-loader.js');
  var lazyPath = path.join(DIST, 'ems-lazy-loader.js');
  var postAuthBust = readCacheBustConstant(postAuthPath);
  var lazyBust = readCacheBustConstant(lazyPath);
  if (!postAuthBust || !lazyBust) {
    console.warn('[EMS] CACHE_BUST check skipped — loader files missing');
    return;
  }
  if (postAuthBust !== lazyBust) {
    console.error('[EMS] CACHE_BUST mismatch — post-auth=' + postAuthBust + ' lazy=' + lazyBust);
    console.error('[EMS] Update ems-lazy-loader.js CACHE_BUST to match ems-post-auth-loader.js');
    process.exit(1);
  }
  console.log('[EMS] CACHE_BUST OK — ' + lazyBust);
}

function verifyHosting() {
  const manifestPath = path.join(DIST, '.hosting-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('[EMS] dist/ missing — run build first');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let ok = true;
  Object.keys(manifest.files).forEach(function (rel) {
    const fp = path.join(DIST, rel);
    if (!fs.existsSync(fp)) {
      console.error('[EMS] MISSING:', rel);
      ok = false;
      return;
    }
    const hash = sha256File(fp);
    if (hash !== manifest.files[rel].sha256) {
      console.error('[EMS] HASH MISMATCH:', rel);
      ok = false;
    }
  });
  if (!ok) {
    console.error('[EMS] Verify FAILED — rebuild with: npm run build:hosting');
    process.exit(1);
  }
  console.log('[EMS] Verify OK — ' + Object.keys(manifest.files).length + ' files unchanged');
}

const args = process.argv.slice(2);
if (args.indexOf('--clean-only') >= 0) {
  rmDir(DIST);
  const fbCache = path.join(ROOT, '.firebase');
  if (fs.existsSync(fbCache)) {
    fs.rmSync(fbCache, { recursive: true, force: true });
    console.log('[EMS] Removed .firebase/ cache');
  }
  console.log('[EMS] Clean complete');
  process.exit(0);
}
if (args.indexOf('--verify') >= 0) {
  verifyHosting();
  process.exit(0);
}

buildHosting();
if (args.indexOf('--verify-after') >= 0) {
  verifyHosting();
}
