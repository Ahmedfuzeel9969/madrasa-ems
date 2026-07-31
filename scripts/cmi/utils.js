'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { ROOT, EXCLUDE_DIRS, INDEXABLE_EXT } = require('./constants');

function sha256(bufOrPath) {
  const hash = crypto.createHash('sha256');
  if (Buffer.isBuffer(bufOrPath) || typeof bufOrPath === 'string') {
    hash.update(bufOrPath);
  } else {
    hash.update(fs.readFileSync(bufOrPath));
  }
  return hash.digest('hex');
}

function fileIdFromPath(relPath) {
  return sha256(relPath.replace(/\\/g, '/')).slice(0, 16);
}

function normalizeRel(absPath) {
  return path.relative(ROOT, absPath).replace(/\\/g, '/');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getGitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    return 'unknown';
  }
}

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    return 'unknown';
  }
}

function listChangedFilesSince(lastSha) {
  if (!lastSha || lastSha === 'unknown') return null;
  try {
    const out = execSync('git diff --name-only ' + lastSha + ' HEAD', {
      cwd: ROOT,
      encoding: 'utf8'
    });
    return out.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  } catch (e) {
    return null;
  }
}

function walkIndexableFiles(onFile) {
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(function (ent) {
      if (ent.name.startsWith('.') && ent.name !== '.firebaserc') return;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (EXCLUDE_DIRS.has(ent.name)) return;
        walk(abs);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!INDEXABLE_EXT.has(ext)) return;
        const rel = normalizeRel(abs);
        if (rel.startsWith('backups/')) return;
        onFile(abs, rel);
      }
    });
  }
  walk(ROOT);
}

function summarizeText(text, maxLen) {
  maxLen = maxLen || 280;
  var oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + '…';
}

module.exports = {
  sha256,
  fileIdFromPath,
  normalizeRel,
  ensureDir,
  readJson,
  writeJson,
  getGitSha,
  getGitBranch,
  listChangedFilesSince,
  walkIndexableFiles,
  summarizeText,
  ROOT
};
