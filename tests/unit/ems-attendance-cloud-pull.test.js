import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance cloud pull (central ems-cloud-pull)', function () {
    it('wires attendance scope through emsCloudPullExecute', function () {
        var pull = fs.readFileSync(path.join(ROOT, 'ems-cloud-pull.js'), 'utf8');
        expect(pull).toContain("pullScope === 'attendance'");
        expect(pull).toContain('pullAttendance(');
        expect(pull).toContain('emsPullAttendanceFromCloud');
        expect(pull).toContain('isDeptPullScope');
        expect(pull).toContain('refreshUIAfterPull(lastResult, pullScope)');
        expect(pull).toContain("res.timetablePulled");
        expect(pull).toContain("' اساتذہ'");
    });

    it('waits for the actual attendance recovery helper and never claims a settings-only pull restored attendance', function () {
        var pull = fs.readFileSync(path.join(ROOT, 'ems-cloud-pull.js'), 'utf8');
        var loader = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        expect(pull).toContain('ensureAttendanceCloudRecoveryReady');
        expect(pull).toContain('emsEnsurePostAuthDeferredScripts');
        expect(pull).toContain("emsLazyLoadModule('attendance')");
        expect(pull).toContain('attendance_recovery_helper_unavailable');
        expect(pull).toContain('recoverAttendanceRosterIfNeeded');
        expect(pull).toContain('emsForceCloudDisasterRecoverySync(tenantId');
        var rosterStart = pull.indexOf('function recoverAttendanceRosterIfNeeded');
        var rosterEnd = pull.indexOf('\n    function pullAttendance', rosterStart);
        var rosterBlock = pull.slice(rosterStart, rosterEnd);
        expect(rosterBlock).not.toMatch(/if\s*\(localCount\s*>\s*0\)/);
        expect(rosterBlock).toContain('previousLocalCount');
        expect(pull).toContain('rosterRecovered');
        expect(pull).toContain('attendance_roster_recovery_failed');
        expect(pull).toContain('updateAttendanceRecoveryStatus');
        expect(pull).toContain('att-cloud-recovery-status');
        expect(pull).not.toContain('attendance_settings_fallback');
        expect(pull).toContain('resolvePullTarget(pullScope)');
        expect(loader).toContain('global.emsEnsurePostAuthDeferredScripts');
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(lazy).toMatch(/attendance:\s*\['attendance-helper\.js'/);
    });

    it('exposes emsPullAttendanceFromCloud in attendance-helper', function () {
        var helper = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(helper).toContain('global.emsPullAttendanceFromCloud');
        expect(helper).toContain("collection('Attendance')");
        expect(helper).toContain('emsOfflineCacheAttendanceFromRemote');
        expect(helper).toContain('attLocalKeyFromCloudDocId');
        expect(helper).toContain('attReconcileLocalRemote');
        expect(helper).toContain('emsPullAttendanceTimetableFromCloud');
        expect(helper).toContain('timetableTeacherCount');
        expect(helper).toContain("excludeKeys: ['ems_att_periods']");
        expect(helper).toContain('emsNormalizeAttendanceCloudDocument');
        expect(helper).toContain('opts.preferCloud !== false');
    });

    it('confirmed cloud recovery really replaces a newer empty local register', async function () {
        var helper = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        var cached = null;
        var remote = {
            locked: true,
            timestamp: 100,
            records: { 'STD-1': { '3': 'ح' } },
            periodRecords: {}
        };
        var local = {
            locked: true,
            timestamp: 999,
            records: {},
            periodRecords: {}
        };
        var snap = {
            forEach: function (fn) {
                fn({
                    id: 'att_rec_2026-08_students_اولی_all',
                    data: function () { return remote; }
                });
            }
        };
        var col = { get: function () { return Promise.resolve(snap); } };
        var sandbox = {
            console: console,
            Promise: Promise,
            Date: Date,
            Intl: Intl,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            navigator: { onLine: true },
            localStorage: { getItem: function () { return null; }, length: 0 },
            emsGetTenantId: function () { return 'tenant-1'; },
            getDbOrNull: function () { return {}; },
            emsFirestoreSubColRef: function () { return col; },
            emsPullModuleGroup: function () { return Promise.resolve({ pulled: 0 }); },
            emsPullAttendanceTimetableFromCloud: function () { return Promise.resolve({ ok: true, count: 2 }); },
            emsOfflineGetCachedAttendance: function () { return Promise.resolve(local); },
            emsOfflineCacheAttendanceFromRemote: function (id, data) {
                cached = data;
                return Promise.resolve({ ok: true });
            },
            emsInvalidateAttDashboardCache: function () {}
        };
        sandbox.window = sandbox;
        vm.runInNewContext(helper, sandbox);

        var result = await sandbox.emsPullAttendanceFromCloud('tenant-1');
        expect(result.ok).toBe(true);
        expect(cached.records['STD-1']['3']).toBe('ح');
        expect(cached.timestamp).toBe(100);
    });

    it('cloud recovery never overwrites a locally saved attendance patch still waiting in outbox', async function () {
        var helper = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        var cacheCalls = 0;
        var local = { timestamp: 200, records: { 'STD-1': { '3': 'غ' } } };
        var remote = { timestamp: 100, records: { 'STD-1': { '3': 'ح' } } };
        var snap = {
            forEach: function (fn) {
                fn({
                    id: 'att_rec_2026-08_students_اولی_all',
                    data: function () { return remote; }
                });
            }
        };
        var sandbox = {
            console: console,
            Promise: Promise,
            Date: Date,
            Intl: Intl,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            navigator: { onLine: true },
            localStorage: { getItem: function () { return null; }, length: 0 },
            emsGetTenantId: function () { return 'tenant-1'; },
            getDbOrNull: function () { return {}; },
            emsFirestoreSubColRef: function () { return { get: function () { return Promise.resolve(snap); } }; },
            emsPullModuleGroup: function () { return Promise.resolve({ pulled: 0 }); },
            emsPullAttendanceTimetableFromCloud: function () { return Promise.resolve({ ok: true, count: 2 }); },
            emsOfflineGetCachedAttendance: function () { return Promise.resolve(local); },
            emsOfflineHasPendingAttendanceMutation: function (tenantId, docId) {
                return Promise.resolve(tenantId === 'tenant-1' && docId === 'att_rec_2026-08_students_اولی_all');
            },
            emsOfflineCacheAttendanceFromRemote: function () {
                cacheCalls++;
                return Promise.resolve({ ok: true });
            },
            emsInvalidateAttDashboardCache: function () {}
        };
        sandbox.window = sandbox;
        vm.runInNewContext(helper, sandbox);

        var result = await sandbox.emsPullAttendanceFromCloud('tenant-1');
        expect(result.ok).toBe(true);
        expect(result.pendingLocalKept).toBe(1);
        expect(result.updated).toBe(0);
        expect(cacheCalls).toBe(0);
        expect(local.records['STD-1']['3']).toBe('غ');
    });

    it('rejects a cloud pull whose requested tenant differs from the verified active madrasa', async function () {
        var helper = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        var sandbox = {
            console: console,
            Promise: Promise,
            Date: Date,
            Intl: Intl,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            navigator: { onLine: true },
            localStorage: { getItem: function () { return null; }, length: 0 },
            emsGetCanonicalTenantId: function () { return 'tenant-verified'; }
        };
        sandbox.window = sandbox;
        vm.runInNewContext(helper, sandbox);

        var result = await sandbox.emsPullAttendanceFromCloud('tenant-wrong');
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('tenant_mismatch');
        expect(result.verifiedTenantId).toBe('tenant-verified');
    });

    it('attendance module has cloud pull button with central data attribute', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="btn-att-cloud-pull"');
        expect(html).toContain('data-ems-cloud-pull="attendance"');
        expect(html).toMatch(/module-attendance[\s\S]*?data-ems-cloud-pull="attendance"/);
        expect(html).toContain('Firebase سے حاضری اور صرف تصدیق شدہ نظام الاوقات بحال کریں');
    });

    it('pulls only a verified canonical timetable that cannot weaken an existing local timetable', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var start = src.indexOf('window.emsPullAttendanceTimetableFromCloud');
        var end = src.indexOf('\nfunction attHealTimetableLocally', start);
        var block = src.slice(start, end);
        expect(block.indexOf("doc('Attendance__ems_att_periods')") >= 0
            || block.indexOf('attTimetableCanonicalCloudRef') >= 0).toBe(true);
        expect(block).toContain('verifiedTenantId');
        expect(block).toContain('manual_verified_canonical');
        expect(block).toContain('attShouldAcceptRemoteTimetable');
        expect(block).toContain('attVerifyRemoteTimetableOwnership');
        expect(block).toContain('cloud_timetable_rejected');
        expect(block).toContain('attApplyTimetableHealChoice');
        expect(block).toContain('period.teacherId || period.teacherName');
        expect(block).toContain('teacherCount');
        expect(block).toContain('attRefreshTimetableUi');
    });
});
