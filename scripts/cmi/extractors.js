'use strict';

const { SECURITY_PATTERNS } = require('./constants');
const { summarizeText } = require('./utils');

function extractImports(content) {
  var imports = [];
  var reRequire = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  var reImport = /import\s+[^'"]*['"]([^'"]+)['"]/g;
  var m;
  while ((m = reRequire.exec(content)) !== null) {
    imports.push(m[1]);
  }
  while ((m = reImport.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports.slice(0, 40);
}

function extractExports(content) {
  var exports = [];
  var patterns = [
    /exports\.(\w+)\s*=/g,
    /module\.exports\s*=\s*\{([^}]{0,500})/,
    /global\.(\w+)\s*=\s*function/g,
    /window\.(\w+)\s*=\s*function/g
  ];
  patterns[0].lastIndex = 0;
  var m;
  while ((m = patterns[0].exec(content)) !== null) {
    exports.push(m[1]);
  }
  patterns[2].lastIndex = 0;
  while ((m = patterns[2].exec(content)) !== null) {
    exports.push(m[1]);
  }
  patterns[3].lastIndex = 0;
  while ((m = patterns[3].exec(content)) !== null) {
    exports.push(m[1]);
  }
  var named = content.match(/function\s+(ems[A-Z]\w+|process\w+)/g) || [];
  named.forEach(function (fn) {
    var name = fn.replace('function ', '');
    if (exports.indexOf(name) === -1) exports.push(name);
  });
  return exports.slice(0, 30);
}

function extractFlags(content) {
  var flags = [];
  var re = /(?:window\.|global\.|)(EMS_[A-Z0-9_]+)\s*=/g;
  var m;
  while ((m = re.exec(content)) !== null) {
    if (flags.indexOf(m[1]) === -1) flags.push(m[1]);
  }
  return flags;
}

function extractCallables(content) {
  var names = [];
  var re = /emsCallFunction\s*\(\s*['"]([\w]+)['"]/g;
  var m;
  while ((m = re.exec(content)) !== null) {
    if (names.indexOf(m[1]) === -1) names.push(m[1]);
  }
  return names;
}

function linkedTestFiles(relPath) {
  var base = relPath.replace(/^.*\//, '').replace(/\.(js|html)$/, '');
  var candidates = [
    'tests/unit/' + base + '.test.js',
    'tests/unit/' + base.replace(/-/g, '-') + '.test.js'
  ];
  if (/^ems-/.test(base)) {
    candidates.push('tests/unit/' + base + '.test.js');
    candidates.push('tests/unit/' + base + '-phasea.test.js');
  }
  if (/ems-registration-/.test(relPath)) {
    candidates.push('tests/unit/ems-registration-' + base.split('-').pop() + '.test.js');
  }
  return candidates;
}

function securityHints(content) {
  var hints = [];
  SECURITY_PATTERNS.forEach(function (p) {
    if (p.re.test(content)) {
      hints.push({ id: p.id, severity: p.severity });
    }
  });
  return hints;
}

function buildLocalSummary(relPath, content, meta) {
  meta = meta || {};
  var parts = [];
  parts.push('File: ' + relPath);
  if (meta.moduleId) parts.push('Module: ' + meta.moduleId);
  if (meta.exports && meta.exports.length) {
    parts.push('Exports/APIs: ' + meta.exports.slice(0, 8).join(', '));
  }
  if (meta.imports && meta.imports.length) {
    parts.push('Imports: ' + meta.imports.slice(0, 6).join(', '));
  }
  if (meta.flags && meta.flags.length) {
    parts.push('Flags: ' + meta.flags.join(', '));
  }
  if (meta.callables && meta.callables.length) {
    parts.push('Cloud callables: ' + meta.callables.join(', '));
  }
  parts.push('Lines: ' + (meta.lineCount || 0));
  if (meta.securityHints && meta.securityHints.length) {
    parts.push('Security flags: ' + meta.securityHints.map(function (h) { return h.id; }).join(', '));
  }
  var header = content.slice(0, 400).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  var comment = header.match(/\/\*\*([\s\S*]{0,200}?)\*\//) || header.match(/^\/\/\s*(.{10,120})/m);
  if (comment && comment[1]) {
    parts.push('Header: ' + summarizeText(comment[1], 120));
  }
  return {
    summaryShort: summarizeText(parts.join(' | '), 220),
    summaryDetailed: summarizeText(parts.join('\n'), 800)
  };
}

function analyzeFile(relPath, content) {
  var lines = content.split('\n');
  return {
    lineCount: lines.length,
    imports: extractImports(content),
    exports: extractExports(content),
    flags: extractFlags(content),
    callables: extractCallables(content),
    securityHints: securityHints(content),
    todoCount: (content.match(/\bTODO\b|\bFIXME\b/gi) || []).length
  };
}

module.exports = {
  extractImports,
  extractExports,
  extractFlags,
  extractCallables,
  linkedTestFiles,
  securityHints,
  buildLocalSummary,
  analyzeFile
};
