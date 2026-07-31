'use strict';
process.env.EMS_DESKTOP_LOCAL = '1';
var { spawnSync } = require('child_process');
var path = require('path');
var electronBin = path.join(__dirname, '..', 'node_modules', 'electron', 'cli.js');
var r = spawnSync(process.execPath, [electronBin, path.join(__dirname, '..', 'desktop', 'main.js')], {
    stdio: 'inherit',
    env: process.env
});
process.exit(r.status || 0);
