#!/usr/bin/env node
'use strict';

/**
 * READ ONLY — pre-deploy compatibility gate for stricter Attendance RBAC.
 * It detects active staff links that would lose attendance access because a
 * legacy permission record has module=true but no explicit actions.view=true.
 */
var fs = require('fs');
var path = require('path');
var phase0 = require('./attendance-phase0-snapshot');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';

function readArg(name, fallback) {
  var prefix = '--' + name + '=';
  var found = process.argv.find(function (arg) { return arg.indexOf(prefix) === 0; });
  return found ? found.slice(prefix.length) : fallback;
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function permissionRow(linkDoc, permissionsById) {
  var link = linkDoc.data() || {};
  var staffId = String(link.staffId || '').trim();
  var permission = permissionsById[staffId] || null;
  var modules = permission && permission.modules && typeof permission.modules === 'object'
    ? permission.modules : {};
  var actions = permission && permission.actions && permission.actions.attendance
    && typeof permission.actions.attendance === 'object'
    ? permission.actions.attendance : {};
  var temporary = permission && permission.temporary && typeof permission.temporary === 'object'
    ? permission.temporary : {};
  var now = Date.now();
  function tempActive(action) {
    var item = temporary['attendance.' + action];
    return !!(item && Number(item.expiryAt) > now);
  }
  var view = actions.view === true || tempActive('view');
  return {
    authUid: linkDoc.id,
    staffId: staffId,
    linkStatus: String(link.status || ''),
    permissionExists: !!permission,
    permissionStatus: permission ? String(permission.status || '') : '',
    attendanceModule: modules.attendance === true,
    actions: {
      view: view,
      create: actions.create === true || tempActive('create'),
      edit: actions.edit === true || tempActive('edit'),
      delete: actions.delete === true || tempActive('delete')
    },
    legacyModuleWithoutView: modules.attendance === true && !view,
    wouldLoseAttendanceRead: !view
  };
}

function summarizePermissionReadiness(staffLinksSnap, permissionsSnap) {
  var permissionsById = Object.create(null);
  permissionsSnap.forEach(function (doc) { permissionsById[doc.id] = doc.data() || {}; });
  var rows = staffLinksSnap.docs
    .filter(function (doc) { return String((doc.data() || {}).status || '') === 'active'; })
    .map(function (doc) { return permissionRow(doc, permissionsById); })
    .sort(function (a, b) { return a.authUid.localeCompare(b.authUid); });
  return {
    activeStaffLinks: rows.length,
    explicitAttendanceView: rows.filter(function (row) { return row.actions.view; }).length,
    legacyModuleWithoutView: rows.filter(function (row) { return row.legacyModuleWithoutView; }).length,
    missingPermissionRecord: rows.filter(function (row) { return !row.permissionExists; }).length,
    wouldLoseAttendanceRead: rows.filter(function (row) { return row.wouldLoseAttendanceRead; }).length,
    staff: rows
  };
}

async function main() {
  var projectId = readArg('project', PROJECT);
  var outPath = path.resolve(ROOT, readArg(
    'out', path.join('backups', 'attendance-permission-readiness-' + stampNow() + '.json')
  ));
  if (!(await phase0.setupCliCredentials(projectId))) throw new Error('Firebase CLI credentials not found');
  var admin = phase0.loadAdmin(projectId);
  var db = admin.firestore();
  var tenantSnap = await db.collection('All_Madrasas').get();
  var tenants = [];
  for (var i = 0; i < tenantSnap.docs.length; i++) {
    var tenantDoc = tenantSnap.docs[i];
    var base = tenantDoc.ref;
    var reads = await Promise.all([
      base.collection('Staff_Links').get(),
      base.collection('StaffPermissions').get()
    ]);
    var profile = tenantDoc.data() || {};
    tenants.push({
      tenantId: tenantDoc.id,
      tenantName: profile.name || profile.madrasaName || profile.instituteName || '',
      readiness: summarizePermissionReadiness(reads[0], reads[1])
    });
  }
  tenants.sort(function (a, b) { return a.tenantId.localeCompare(b.tenantId); });
  var affected = tenants.filter(function (tenant) {
    return tenant.readiness.wouldLoseAttendanceRead > 0;
  });
  var result = {
    version: 1,
    mode: 'read_only',
    createdAt: new Date().toISOString(),
    projectId: projectId,
    tenantCount: tenants.length,
    safeToDeployStrictAttendanceRead: affected.length === 0,
    affectedTenantCount: affected.length,
    affectedActiveStaffCount: affected.reduce(function (sum, tenant) {
      return sum + tenant.readiness.wouldLoseAttendanceRead;
    }, 0),
    tenants: tenants,
    safetyNote: 'No Firebase document was created, updated, moved, or deleted.'
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: result.safeToDeployStrictAttendanceRead,
    output: outPath,
    tenantCount: result.tenantCount,
    affectedTenantCount: result.affectedTenantCount,
    affectedActiveStaffCount: result.affectedActiveStaffCount,
    affectedTenants: affected.map(function (tenant) {
      return {
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        affected: tenant.readiness.wouldLoseAttendanceRead,
        legacyModuleWithoutView: tenant.readiness.legacyModuleWithoutView,
        missingPermissionRecord: tenant.readiness.missingPermissionRecord
      };
    })
  }, null, 2));
  if (!result.safeToDeployStrictAttendanceRead) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(function (error) {
    console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
    process.exit(1);
  });
}

module.exports = {
  permissionRow: permissionRow,
  summarizePermissionReadiness: summarizePermissionReadiness
};
