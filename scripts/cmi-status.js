#!/usr/bin/env node
'use strict';

const advisor = require('./cmi/advisor-api');
const storage = require('./cmi/storage');

var cmd = process.argv[2] || 'status';

if (cmd === 'status') {
  var st = advisor.getMemoryStatus();
  if (!st.ok) {
    console.log(JSON.stringify(st, null, 2));
    process.exit(1);
  }
  console.log('[CMI] Status OK');
  console.log('  Version:    ', st.cmiVersion);
  console.log('  Git SHA:    ', st.gitSha);
  console.log('  Indexed:    ', st.indexedAt);
  console.log('  Files:      ', st.fileCount);
  console.log('  Next full:  ', st.nextFullRefreshDue);
  console.log('  Refresh mo: ', st.fullRefreshMonths);
  process.exit(0);
}

if (cmd === 'ask') {
  var question = process.argv.slice(3).join(' ');
  if (!question) {
    console.error('Usage: node scripts/cmi-status.js ask "your question"');
    process.exit(1);
  }
  if (!storage.loadMeta()) {
    console.error('[CMI] Index missing — run: npm run cmi:build');
    process.exit(1);
  }
  var res = advisor.prepareLocalRecommendation(question, { useCache: true });
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

console.error('Usage: node scripts/cmi-status.js [status|ask]');
process.exit(1);
