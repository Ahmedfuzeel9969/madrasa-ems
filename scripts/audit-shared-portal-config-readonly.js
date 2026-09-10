#!/usr/bin/env node
'use strict';

/**
 * READ ONLY — inspect one tenant's shared-portal configuration and directory.
 * Raw email addresses and access credentials are never printed.
 */
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var DEFAULT_TENANT = 'bpV58OqWSKhRbvXL57CvihIlDj63';

function readArg(name, fallback) {
  var prefix = '--' + name + '=';
  var found = process.argv.find(function (arg) { return arg.indexOf(prefix) === 0; });
  return found ? found.slice(prefix.length) : fallback;
}

async function setupCliCredentials(projectId) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var candidates = [
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  ];
  var configPath = candidates.find(function (candidate) { return candidate && fs.existsSync(candidate); });
  if (!configPath) return false;
  var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  var defaults = require(path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'defaultCredentials'));
  var credentialPath = await defaults.getCredentialPathAsync({ user: config.user, tokens: config.tokens });
  if (!credentialPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.env.GCLOUD_PROJECT = projectId;
  return true;
}

function normalizeEmail(value) {
  var email = String(value || '').trim().toLowerCase();
  var match = email.match(/^([^@\s]{1,64})@([^@\s]{1,253})$/);
  if (!match) return '';
  var local = match[1];
  var domain = match[2] === 'googlemail.com' ? 'gmail.com' : match[2];
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return local && domain ? local + '@' + domain : '';
}

function emailHash(email) {
  return crypto.createHash('sha256')
    .update('ems-shared-portal-directory-v1:' + normalizeEmail(email))
    .digest('hex');
}

function maskEmail(value) {
  var email = normalizeEmail(value);
  if (!email) return '';
  var parts = email.split('@');
  return (parts[0].slice(0, 2) || '*') + '***@' + parts[1];
}

async function main() {
  var projectId = readArg('project', PROJECT);
  var tenantId = readArg('tenant', DEFAULT_TENANT);
  if (!(await setupCliCredentials(projectId))) throw new Error('Firebase CLI credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: projectId });
  var db = admin.firestore();

  var tenantRef = db.collection('All_Madrasas').doc(tenantId);
  var reads = await Promise.all([
    tenantRef.get(),
    tenantRef.collection('TenantSettings').doc('sharedPortalGateway').get()
  ]);
  if (!reads[0].exists) throw new Error('Tenant not found: ' + tenantId);
  var tenant = reads[0].data() || {};
  var config = reads[1].exists ? (reads[1].data() || {}) : null;
  var portals = (config && config.portals) || {};
  var portalReport = {};

  for (var portal of ['teacher', 'student', 'parent']) {
    var entry = portals[portal] || {};
    var email = normalizeEmail(entry.email);
    var directory = email
      ? await db.collection('SharedPortalGatewayDirectory').doc(emailHash(email)).get()
      : null;
    var authUser = null;
    if (email) {
      try { authUser = await admin.auth().getUserByEmail(email); }
      catch (err) { if (!err || err.code !== 'auth/user-not-found') throw err; }
    }
    portalReport[portal] = {
      configured: entry.configured === true,
      enabled: entry.enabled === true,
      emailHint: maskEmail(email),
      authAccountExists: !!authUser,
      directoryExists: !!(directory && directory.exists),
      directoryTenantMatches: !!(directory && directory.exists
        && String((directory.data() || {}).tenantId || '') === tenantId),
      directoryRoles: directory && directory.exists ? ((directory.data() || {}).roles || []) : []
    };
  }

  var ownerUid = String(tenant.ownerUid || tenantId || '');
  var ownerUser = null;
  try { ownerUser = await admin.auth().getUser(ownerUid); }
  catch (err) { if (!err || err.code !== 'auth/user-not-found') throw err; }
  var updatedAt = config && config.updatedAt && typeof config.updatedAt.toDate === 'function'
    ? config.updatedAt.toDate().toISOString()
    : null;

  console.log(JSON.stringify({
    readOnly: true,
    projectId: projectId,
    tenantId: tenantId,
    tenantName: tenant.name || tenant.madrasaName || tenant.instituteName || '',
    ownerEmailHint: maskEmail((ownerUser && ownerUser.email) || tenant.ownerEmail || tenant.adminEmail),
    configExists: !!config,
    mode: config ? config.mode : null,
    revision: config ? Number(config.revision || 0) : null,
    updatedAt: updatedAt,
    updatedByEmailHint: config ? maskEmail(config.updatedByEmail) : '',
    portals: portalReport
  }, null, 2));
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
