import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var build = require('../../scripts/ems-build-constants.js');

/** Resolve script path (cloud/ or root). */
export function resolveScriptPath(root, name) {
  return build.resolveScriptPath(root, name);
}

export function readScript(root, name) {
  return build.readScript(root, name);
}

export function readCloudManifest(root) {
  return fs.readFileSync(path.join(root, 'cloud', 'ems-cloud-manifest.js'), 'utf8');
}

export function readAppScriptManifest(root) {
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var loaderPath = path.join(root, 'ems-post-auth-loader.js');
  var loader = fs.existsSync(loaderPath)
    ? fs.readFileSync(loaderPath, 'utf8')
    : '';
  var cloud = '';
  var cloudPath = path.join(root, 'cloud', 'ems-cloud-manifest.js');
  if (fs.existsSync(cloudPath)) {
    cloud = fs.readFileSync(cloudPath, 'utf8');
  }
  return {
    html: html,
    loader: loader,
    cloud: cloud,
    combined: html + '\n' + loader + '\n' + cloud
  };
}

export function expectScriptLoaded(manifest, scriptName) {
  var needle = scriptName.indexOf('cloud/') === 0 ? scriptName : scriptName;
  if (!manifest.combined.includes(needle)) {
    throw new Error('Script not in login shell or post-auth bundle: ' + scriptName);
  }
}

export { build as EMS_BUILD };
