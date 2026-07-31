import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P1 — dashboard attendance IDB index (no localStorage scan)', function () {
    it('ems-idb-engine exposes prefix KV scan', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idb-engine.js'), 'utf8');
        expect(src).toContain('emsIdbKvKeysByPrefix');
        expect(src).toContain('IDBKeyRange.bound');
    });

    it('attendance-helper uses indexed month loaders', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(src).toContain('emsOfflineListAttendanceKeysAsync');
        expect(src).toContain('emsOfflineLoadAttendanceSheetsForMonth');
        expect(src).not.toMatch(/emsFetchTodayAttendanceFromCache[\s\S]{0,500}localStorage\.length/);
    });

    it('dashboard.js removes localStorage scan for offline attendance', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsDash360CollectAttendanceAsync');
        expect(src).toContain('emsOfflineLoadAttendanceSheetsForMonth');
        expect(src).toContain('emsFetchTodayAttendanceFromCache');
        expect(src).not.toMatch(/for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*localStorage\.length/);
    });

    it('ems-data-cache invalidates attendance key index on att_rec write', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-data-cache.js'), 'utf8');
        expect(src).toContain('emsAttOfflineKeyIndexInvalidate');
    });
});
