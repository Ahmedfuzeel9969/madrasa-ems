'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CMI_DIR = path.join(ROOT, '.cmi');

const CMI_VERSION = 1;
const PSC_MAX_BYTES = 32 * 1024;
const FULL_REFRESH_MONTHS_DEFAULT = 6;

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.firebase',
  '.cursor',
  '.cmi',
  'android',
  'backups',
  'desktop',
  'coverage',
  'playwright-report',
  'test-results'
]);

const INDEXABLE_EXT = new Set([
  '.js', '.html', '.css', '.json', '.md', '.rules', '.mjs', '.cjs'
]);

const SECURITY_PATTERNS = [
  { id: 'api_key_literal', re: /apiKey\s*[:=]\s*['"][^'"]{8,}/i, severity: 'high' },
  { id: 'gemini_key', re: /AIza[0-9A-Za-z\-_]{20,}/, severity: 'critical' },
  { id: 'openai_sk', re: /\bsk-[a-zA-Z0-9]{20,}\b/, severity: 'critical' },
  { id: 'eval_usage', re: /\beval\s*\(/, severity: 'medium' },
  { id: 'innerHTML_assign', re: /\.innerHTML\s*=/, severity: 'low' }
];

module.exports = {
  ROOT,
  CMI_DIR,
  CMI_VERSION,
  PSC_MAX_BYTES,
  FULL_REFRESH_MONTHS_DEFAULT,
  EXCLUDE_DIRS,
  INDEXABLE_EXT,
  SECURITY_PATTERNS
};
