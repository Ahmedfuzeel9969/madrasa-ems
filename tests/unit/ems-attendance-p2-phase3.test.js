import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance P2 Phase 3 — tech debt & polish', function () {
    it('ATT-P2-3: event participant search uses live filter (no full option dump)', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(js).toContain('ATT_SEARCH_MAX = 50');
        expect(js).toContain('evtFilterUsersForSearch');
        expect(js).toContain('evtRenderParticipantSearchResults');
        expect(js).toContain('evtResolveSelectedParticipantUid');
        expect(js).not.toMatch(/evt-participant-search[\s\S]{0,400}\.map\(\s*\(\s*u\s*\)\s*=>\s*`<option/);
        expect(html).toContain('id="evt-participant-search"');
        expect(html).toContain('id="evt-participant-results"');
        expect(html).not.toMatch(/id="evt-participant-search"[\s\S]{0,80}<option/);
    });

    it('ATT-P2-5: holidays and symbols sync via outbox helpers', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('function attPersistConfigBlob');
        expect(js).toContain('function attEnqueueSyncModuleBlob');
        expect(js).toMatch(/saveSymbols[\s\S]{0,400}attPersistConfigBlob\('ems_att_symbols'/);
        expect(js).toMatch(/btn-add-holiday[\s\S]{0,800}attPersistConfigBlob\(ATT_HOLIDAYS_KEY/);
        expect(js).toMatch(/deleteHoliday[\s\S]{0,600}attPersistConfigBlob\(ATT_HOLIDAYS_KEY/);
        expect(js).toContain('emsOfflineEnqueueSyncModule');
    });

    it('ATT-P2-2: hidden bulk admin tab removed from UI and JS', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var layout = fs.readFileSync(path.join(ROOT, 'sys-layout-builder.js'), 'utf8');
        expect(html).not.toContain('att-bulk-admin');
        expect(html).not.toContain('bulkPreview');
        expect(layout).not.toContain('att-bulk-admin');
        expect(js).not.toContain('window.bulkPreview');
        expect(js).not.toContain('window.bulkCommit');
        expect(js).not.toContain('att-bulk-admin');
    });
});
