import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Mirrors attRenderChunkedRows eviction: loaded tracks footer X, dom capped at domMax. */
function simulateDomCap(totalRows, pageSize, domMax) {
    var dom = 0;
    var loaded = 0;
    var offset = 0;
    while (offset < totalRows) {
        var batch = Math.min(pageSize, totalRows - offset);
        dom += batch;
        loaded += batch;
        offset += batch;
        while (dom > domMax) dom--;
    }
    return { dom: dom, loaded: loaded };
}

describe('Attendance P0 Phase 1 — async IDB reports & chunked DOM', function () {
    it('attendance-helper exports async report collector (no localStorage scan)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(src).toContain('global.emsAttCollectReportSheetsAsync');
        expect(src).toContain('global.emsAttReadSheetByKeyAsync');
        expect(src).toContain('emsOfflineListAttendanceKeysAsync');
        expect(src).not.toMatch(/emsAttCollectReportSheetsAsync[\s\S]{0,800}localStorage\.length/);
    });

    it('attendance.js removes sync attCollectReportSheets localStorage loop', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).not.toContain('function attCollectReportSheets');
        expect(src).not.toMatch(/for\s*\(\s*var\s+i\s*=\s*0;\s*i\s*<\s*localStorage\.length/);
        expect(src).toContain('emsAttCollectReportSheetsAsync');
        var genIdx = src.indexOf('window.generateAttReport');
        expect(genIdx).toBeGreaterThan(-1);
        expect(src.substring(genIdx, genIdx + 2500)).toContain('fa-spinner');
        expect(src).toContain('window._attReportRowHtmlCache');
    });

    it('attendance.js defines chunked report & event renderers (50/page, DOM cap)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toContain('ATT_CHUNK_PAGE_SIZE = 50');
        expect(src).toContain('ATT_CHUNK_DOM_MAX = 200');
        expect(src).toContain('function attRenderChunkedRows');
        expect(src).toContain('evictOverflowRows');
        expect(src).toMatch(/دکھائے گئے:[\s\S]{0,80}state\.loaded/);
        var evtIdx = src.indexOf('function renderEventParticipants');
        expect(evtIdx).toBeGreaterThan(-1);
        expect(src.substring(evtIdx, evtIdx + 1200)).toContain('attRenderChunkedRows');
        expect(src).toContain("disposeKey: 'evt'");
        expect(src).toContain("disposeKey: 'report'");
        expect(src).toContain('evt-chunk-foot');
        expect(src).toContain('att-report-chunk-foot');
    });

    it('att-dashboard uses async IDB sheet collection (no localStorage scan)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(src).toContain('attDashCollectSheetsAsync');
        expect(src).toContain('attDashCollectSheetsMapAsync');
        expect(src).toContain('attDashReadSheetAsync');
        expect(src).not.toMatch(/localStorage\.length/);
        expect(src).not.toMatch(/localStorage\.key\s*\(/);
        expect(src).toMatch(/attDashRenderBody[\s\S]{0,1500}attDashCollectSheetsMapAsync/);
    });

    it('DOM cap keeps tbody at 200 rows while loaded count grows to 5000', function () {
        var res = simulateDomCap(5000, 50, 200);
        expect(res.dom).toBe(200);
        expect(res.loaded).toBe(5000);
    });

    it('attPrintReport expands cache then restores chunked view', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toMatch(/attPrintReport[\s\S]{0,500}_attReportRowHtmlCache/);
        expect(src).toMatch(/attPrintReport[\s\S]{0,900}attRenderChunkedRows/);
    });
});
