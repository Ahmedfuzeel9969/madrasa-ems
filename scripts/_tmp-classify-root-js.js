'use strict';
const fs = require('fs');
const rootJs = fs.readdirSync('.').filter((f) => f.endsWith('.js') && fs.statSync(f).isFile()).sort();
const index = fs.readFileSync('index.html', 'utf8');
const post = fs.readFileSync('ems-post-auth-loader.js', 'utf8');
const lazy = fs.readFileSync('ems-lazy-loader.js', 'utf8');
const man = fs.readFileSync('cloud/ems-cloud-manifest.js', 'utf8');

function tagged(f) {
  const tags = [];
  if (index.includes(f)) tags.push('I');
  if (post.includes("'" + f + "'") || post.includes('"' + f + '"')) tags.push('P');
  if (lazy.includes("'" + f + "'") || lazy.includes('"' + f + '"')) tags.push('L');
  if (man.includes("'" + f + "'") || man.includes('"' + f + '"')) tags.push('C');
  return tags.length ? tags.join('') : 'O';
}

const rows = rootJs.map((f) => f + '\t' + tagged(f));
console.log(rows.join('\n'));
console.log('---ORPHANS---');
console.log(rows.filter((r) => r.endsWith('\tO')).map((r) => r.split('\t')[0]).join('\n'));
