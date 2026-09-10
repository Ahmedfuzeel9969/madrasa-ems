#!/usr/bin/env node
'use strict';

/**
 * صرف مطالعہ: ایک ادارے کے اساتذہ/عملہ اور والدین پورٹل کے ربط اور
 * اختیار ناموں کی گنتی۔ یہ کسی Firestore دستاویز کو نہیں بدلتا۔
 */
var path = require('path');
var phase0 = require('./attendance-phase0-snapshot');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';

function readArg(name, fallback) {
  var prefix = '--' + name + '=';
  var found = process.argv.find(function (arg) { return arg.indexOf(prefix) === 0; });
  return found ? found.slice(prefix.length) : fallback;
}

function statusCounts(docs) {
  return docs.reduce(function (out, doc) {
    var status = String((doc.data() || {}).status || 'active');
    out[status] = Number(out[status] || 0) + 1;
    return out;
  }, {});
}

function activeActions(permission) {
  var actions = permission && permission.actions && typeof permission.actions === 'object'
    ? permission.actions : {};
  return Object.keys(actions).reduce(function (count, moduleId) {
    var moduleActions = actions[moduleId] || {};
    return count + Object.keys(moduleActions).filter(function (key) { return moduleActions[key] === true; }).length;
  }, 0);
}

function usableKey(data) {
  data = data || {};
  var hasHash = typeof data.accessKeyHash === 'string' && data.accessKeyHash.length > 20;
  var expires = data.accessKeyExpiresAt;
  var expiresMs = expires && typeof expires.toMillis === 'function' ? expires.toMillis() : Number(expires || 0);
  return hasHash && (!expiresMs || expiresMs > Date.now());
}

function summarizeStaff(permissionsSnap, linksSnap, keysSnap) {
  var permissions = Object.create(null);
  permissionsSnap.forEach(function (doc) { permissions[doc.id] = doc.data() || {}; });
  var keyById = Object.create(null);
  keysSnap.forEach(function (doc) { keyById[doc.id] = doc.data() || {}; });
  var activeLinks = linksSnap.docs.filter(function (doc) {
    return String((doc.data() || {}).status || '') === 'active';
  });
  var missingPermissions = activeLinks.filter(function (doc) {
    return !permissions[String((doc.data() || {}).staffId || '')];
  }).length;
  var incoherent = permissionsSnap.docs.filter(function (doc) {
    var p = doc.data() || {};
    var modules = p.modules || {};
    var actions = p.actions || {};
    return Object.keys(modules).some(function (moduleId) {
      var moduleActions = actions[moduleId] || {};
      var anyAction = Object.keys(moduleActions).some(function (key) { return moduleActions[key] === true; });
      return (modules[moduleId] === true && moduleActions.view !== true)
        || (modules[moduleId] !== true && anyAction);
    });
  }).length;
  return {
    permissionDocuments: permissionsSnap.size,
    permissionStatuses: statusCounts(permissionsSnap.docs),
    permissionsWithNoModule: permissionsSnap.docs.filter(function (doc) {
      var modules = (doc.data() || {}).modules || {};
      return !Object.keys(modules).some(function (key) { return modules[key] === true; });
    }).length,
    permissionsWithNoAction: permissionsSnap.docs.filter(function (doc) {
      return activeActions(doc.data() || {}) === 0;
    }).length,
    incoherentModuleActionDocuments: incoherent,
    linkDocuments: linksSnap.size,
    linkStatuses: statusCounts(linksSnap.docs),
    activeLinks: activeLinks.length,
    activeLinksMissingPermission: missingPermissions,
    accessKeyDocuments: keysSnap.size,
    permissionsWithUsableKey: permissionsSnap.docs.filter(function (doc) {
      return usableKey(keyById[doc.id]) || usableKey(doc.data() || {});
    }).length
  };
}

function parentStudentIds(link) {
  var ids = [];
  if (Array.isArray(link.studentIds)) ids = ids.concat(link.studentIds);
  if (link.studentId) ids.push(link.studentId);
  return ids.map(String).filter(Boolean);
}

function summarizeParents(permissionsSnap, linksSnap, keysSnap) {
  var permissions = Object.create(null);
  permissionsSnap.forEach(function (doc) { permissions[doc.id] = doc.data() || {}; });
  var activeLinks = linksSnap.docs.filter(function (doc) {
    return String((doc.data() || {}).status || '') === 'active';
  });
  var linkedIds = [];
  activeLinks.forEach(function (doc) { linkedIds = linkedIds.concat(parentStudentIds(doc.data() || {})); });
  linkedIds = Array.from(new Set(linkedIds));
  return {
    permissionDocuments: permissionsSnap.size,
    permissionStatuses: statusCounts(permissionsSnap.docs),
    permissionsWithNoView: permissionsSnap.docs.filter(function (doc) {
      var views = (doc.data() || {}).views || {};
      return !Object.keys(views).some(function (key) { return views[key] === true; });
    }).length,
    linkDocuments: linksSnap.size,
    linkStatuses: statusCounts(linksSnap.docs),
    activeLinks: activeLinks.length,
    distinctLinkedStudents: linkedIds.length,
    linkedStudentsMissingPermission: linkedIds.filter(function (id) { return !permissions[id]; }).length,
    accessKeyDocuments: keysSnap.size,
    permissionsWithUsableKey: permissionsSnap.docs.filter(function (doc) {
      var key = keysSnap.docs.find(function (keyDoc) { return keyDoc.id === doc.id; });
      return !!key && usableKey(key.data() || {});
    }).length
  };
}

async function main() {
  var projectId = readArg('project', PROJECT);
  var tenantId = readArg('tenant', '');
  if (!tenantId) throw new Error('Required argument missing: --tenant=<tenant-id>');
  if (!(await phase0.setupCliCredentials(projectId))) throw new Error('Firebase CLI credentials not found');
  var admin = phase0.loadAdmin(projectId);
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(tenantId);
  var reads = await Promise.all([
    tenantRef.get(),
    tenantRef.collection('StaffPermissions').get(),
    tenantRef.collection('Staff_Links').get(),
    tenantRef.collection('StaffAccessKeys').get(),
    tenantRef.collection('ParentPermissions').get(),
    tenantRef.collection('Parent_Links').get(),
    tenantRef.collection('ParentAccessKeys').get()
  ]);
  if (!reads[0].exists) throw new Error('Tenant not found: ' + tenantId);
  var tenant = reads[0].data() || {};
  console.log(JSON.stringify({
    readOnly: true,
    safetyNote: 'No Firebase document was created, updated, moved, or deleted.',
    projectId: projectId,
    tenantId: tenantId,
    tenantName: tenant.name || tenant.madrasaName || tenant.instituteName || '',
    staffPortal: summarizeStaff(reads[1], reads[2], reads[3]),
    parentPortal: summarizeParents(reads[4], reads[5], reads[6])
  }, null, 2));
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
