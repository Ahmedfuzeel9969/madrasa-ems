#!/usr/bin/env node
'use strict';

const { buildIndex, buildIncremental } = require('./cmi/build-index');
const { listChangedFilesSince } = require('./cmi/utils');
const storage = require('./cmi/storage');

var meta = storage.loadMeta();
if (!meta) {
  console.error('[CMI] No existing index — run: npm run cmi:build');
  process.exit(1);
}

var changed = listChangedFilesSince(meta.gitSha);
if (!changed || changed.length === 0) {
  console.log('[CMI] No git changes since last indexed SHA:', meta.gitSha);
  process.exit(0);
}

console.log('[CMI] Incremental update —', changed.length, 'path(s) changed since', meta.gitSha);
var result = buildIncremental(changed);
console.log('[CMI] Incremental OK');
console.log('[CMI] Version:', result.meta.cmiVersion);
console.log('[CMI] Updated:', result.meta.filesUpdated, '| Skipped unchanged:', result.meta.filesSkipped);
process.exit(0);
