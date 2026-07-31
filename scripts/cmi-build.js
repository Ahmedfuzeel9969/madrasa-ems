#!/usr/bin/env node
'use strict';

const { buildIndex } = require('./cmi/build-index');

var months = 6;
process.argv.slice(2).forEach(function (arg) {
  if (arg.indexOf('--months=') === 0) months = parseInt(arg.split('=')[1], 10) || 6;
});

console.log('[CMI] Full build starting…');
var result = buildIndex({ mode: 'full', fullRefreshMonths: months });
console.log('[CMI] Full build OK');
console.log('[CMI] Version:', result.meta.cmiVersion);
console.log('[CMI] Git SHA:', result.meta.gitSha);
console.log('[CMI] Files:', result.meta.fileCount, '| Updated:', result.meta.filesUpdated);
console.log('[CMI] Next full refresh due:', result.meta.nextFullRefreshDue);
console.log('[CMI] Ingested:', JSON.stringify(result.ingested));
process.exit(0);
