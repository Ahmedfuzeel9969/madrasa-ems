import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Curriculum ↔ Exams central library link', function () {
    it('curSyncFromLibrary uses durable library reader (attReadLibraryBooks)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'curriculum.js'), 'utf8');
        expect(src).toContain('function curReadLibraryBooks');
        expect(src).toContain('attReadLibraryBooks');
        expect(src).toContain('emsDurableReadRaw');
        expect(src).toContain('window.curSyncFromLibrary');
        var syncIdx = src.indexOf('window.curSyncFromLibrary = function');
        var syncBody = src.slice(syncIdx, syncIdx + 2200);
        expect(syncBody).toContain('curReadLibraryBooks()');
        expect(syncBody).not.toMatch(/readJson\(LIB_KEY/);
        expect(syncBody).toContain('fromCentralLibrary');
        expect(syncBody).toContain('curPersistPlans');
    });

    it('loads library/plans from IndexedDB before planning UI', function () {
        var src = fs.readFileSync(path.join(ROOT, 'curriculum.js'), 'utf8');
        expect(src).toContain('function curEnsureLibraryReady');
        expect(src).toContain('emsDurableEnsureKey');
        expect(src).toContain('curEnsureLibraryReady().then');
        expect(src).toContain('window.curInitModule');
        expect(src).toContain('window.curRenderPlanning');
        var initIdx = src.indexOf('window.curInitModule = function');
        expect(src.slice(initIdx, initIdx + 900)).toContain('curEnsureLibraryReady');
        expect(src).toMatch(/window\.curRenderPlanning\s*=\s*function[\s\S]*?curEnsureLibraryReady\(\)\.then\(paint\)/);
    });

    it('library plans stay visible across departments', function () {
        var src = fs.readFileSync(path.join(ROOT, 'curriculum.js'), 'utf8');
        expect(src).toContain('function getDeptPlans');
        var idx = src.indexOf('function getDeptPlans');
        var body = src.slice(idx, idx + 900);
        expect(body).toContain('fromCentralLibrary');
        expect(body).toContain('libSet');
    });

    it('planning UI labels point at exams central library', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('cur-plan-book-select');
        expect(html).toContain('امتحانات کی مرکزی کتب خانہ سے خودکار');
        expect(html).toContain('مرکزی کتب خانہ سے sync');
    });

    it('exam library refresh re-renders curriculum planning when open', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('curEnsureLibraryReady');
        expect(src).toContain('curSyncFromLibrary');
        expect(src).toContain('curRenderPlanning');
        expect(src).toContain('module-curriculum');
    });
});
