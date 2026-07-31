import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance P1 Phase 2 — performance polish & sync', function () {
    it('ATT-P1-1: saveAttState debounces dashboard render when panel visible', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toContain('function attScheduleDashboardRefreshFromSave');
        expect(src).toContain('ATT_DASH_SAVE_RENDER_DEBOUNCE_MS');
        expect(src).toMatch(/attScheduleDashboardRefreshFromSave[\s\S]{0,500}attPanelIsVisible\('att-dashboard-panel'\)/);
        var saveIdx = src.indexOf('function saveAttState');
        expect(saveIdx).toBeGreaterThan(-1);
        var saveBlock = src.substring(saveIdx, saveIdx + 2200);
        expect(saveBlock).toContain('attScheduleDashboardRefreshFromSave');
        expect(saveBlock).not.toMatch(/renderAttDashboard\(\)/);
    });

    it('ATT-P1-3: attendance-helper is SSOT for attendance key listing', function () {
        var helper = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        var offline = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(helper).toContain('global.__emsAttKeyListFromHelper');
        expect(helper).toContain('global.__emsAttKeyListAsyncFromHelper');
        expect(helper).toContain('emsIdbKvKeysByPrefix');
        expect(offline).toContain('SSOT delegator');
        expect(offline).toContain('__emsAttKeyListFromHelper');
        expect(offline).not.toMatch(/emsOfflineListAttendanceKeys[\s\S]{0,400}localStorage\.length/);
        expect(offline).toMatch(/attIndexAddKey[\s\S]{0,300}emsAttOfflineKeyIndexInvalidate/);
    });

    it('ATT-P1-4: event attendance uses outbox + patch sync helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toContain('window.attSaveEventAttendance');
        expect(src).toContain('window.attDeleteEventAttendance');
        expect(src).toContain('attComputeEventCloudPatch');
        expect(src).toContain('attEventCloudDocId');
        expect(src).toContain('attEnqueueEventsDbSync');
        expect(src).toContain('emsOfflineEnqueueSyncModule');
        expect(src).toContain('emsOfflinePersistAttendance');
        var fnIdx = src.indexOf('window.attSaveEventAttendance');
        expect(fnIdx).toBeGreaterThan(-1);
        expect(src.substring(fnIdx, fnIdx + 1200)).toContain('attEnqueueEventsDbSync');
        var saveBtnIdx = src.indexOf("btn-save-event-att");
        expect(saveBtnIdx).toBeGreaterThan(-1);
        expect(src.substring(saveBtnIdx, saveBtnIdx + 1200)).toContain('attSaveEventAttendance');
    });

    it('ATT-P1-6: stale dash-attendance-percent replaced with dash-att-rate', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).not.toContain('dash-attendance-percent');
        expect(src).toContain("getElementById('dash-att-rate')");
    });
});
