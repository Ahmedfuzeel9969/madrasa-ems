import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { EMS_BUILD } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise E10-S1 — Import queue & virtual tables', function () {
    it('ems-import-queue.js exposes chunked queue API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-import-queue.js'), 'utf8');
        expect(src).toContain('emsImportQueueCommit');
        expect(src).toContain('emsImportQueueProcess');
        expect(src).toContain('CHUNK_SIZE = 500');
        expect(src).toContain("'partial'");
    });

    it('ems-import-export.js routes large commits through queue', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(src).toContain('emsImportQueueCommit');
        expect(src).toContain('emsImportCommitDirect');
        expect(src).toContain('emsImportQueueProcess');
    });

    it('lazy loader loads import queue before admission import stack', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        var admissionBlock = src.slice(src.indexOf('admission:'), src.indexOf('attendance:'));
        var idxExport = admissionBlock.indexOf('ems-import-export.js');
        var idxQ = admissionBlock.indexOf('ems-import-queue.js');
        expect(idxQ).toBeGreaterThan(-1);
        expect(idxExport).toBeGreaterThan(-1);
        expect(idxQ).toBeGreaterThan(idxExport);
        expect(src).toContain(EMS_BUILD.CACHE_BUST.syncHardening);
    });

    it('complaints uses DOM pagination; ledger, exams, curriculum use virtual tables', function () {
        var cmp = fs.readFileSync(path.join(ROOT, 'complaints.js'), 'utf8');
        expect(cmp).toContain('cmpRenderPager');
        expect(cmp).toContain('emsGetDomPageSize');
        expect(fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8')).toContain("emsVirtualTableMount('ldg-entry'");
        expect(fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8')).toContain("emsVirtualTableMount('mrk-entry'");
        expect(fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8')).toContain("emsVirtualTableMount('promo-table'");
        expect(fs.readFileSync(path.join(ROOT, 'curriculum.js'), 'utf8')).toContain("emsVirtualTableMount('cur-plan-list'");
    });

    it('bulk import Cloud Function uses 500 batch size', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions/lib/bulk-import-registrations.js'), 'utf8');
        expect(src).toContain('MAX_BATCH = 500');
    });
});
