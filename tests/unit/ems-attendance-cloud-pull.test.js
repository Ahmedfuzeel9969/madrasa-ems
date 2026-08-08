import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance cloud pull (central ems-cloud-pull)', function () {
    it('wires attendance scope through emsCloudPullExecute', function () {
        var pull = fs.readFileSync(path.join(ROOT, 'ems-cloud-pull.js'), 'utf8');
        expect(pull).toContain("pullScope === 'attendance'");
        expect(pull).toContain('pullAttendance(');
        expect(pull).toContain('emsPullAttendanceFromCloud');
        expect(pull).toContain('isDeptPullScope');
        expect(pull).toContain('refreshUIAfterPull(lastResult, pullScope)');
    });

    it('exposes emsPullAttendanceFromCloud in attendance-helper', function () {
        var helper = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(helper).toContain('global.emsPullAttendanceFromCloud');
        expect(helper).toContain("collection('Attendance')");
        expect(helper).toContain('emsOfflineCacheAttendanceFromRemote');
        expect(helper).toContain('attLocalKeyFromCloudDocId');
        expect(helper).toContain('attReconcileLocalRemote');
    });

    it('attendance module has cloud pull button with central data attribute', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="btn-att-cloud-pull"');
        expect(html).toContain('data-ems-cloud-pull="attendance"');
        expect(html).toMatch(/module-attendance[\s\S]*?data-ems-cloud-pull="attendance"/);
    });
});
