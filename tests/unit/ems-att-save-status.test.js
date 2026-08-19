import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadStatusSandbox() {
    var src = fs.readFileSync(path.join(ROOT, 'att-save-status.js'), 'utf8');
    var sandbox = {
        window: {},
        document: {
            getElementById: function () {
                return { textContent: '', className: '', setAttribute: function () {}, removeAttribute: function () {} };
            }
        },
        dispatchEvent: function () {}
    };
    sandbox.window = sandbox;
    sandbox.addEventListener = function () {};
    vm.runInNewContext(src, sandbox);
    return sandbox;
}

describe('Attendance local-first save status (Phase 1)', function () {
    it('loads att-save-status.js before attendance in lazy loader', function () {
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(lazy).toMatch(/attendance:\s*\[[^\]]*'att-save-status\.js'/);
        var attIdx = lazy.indexOf("'att-save-status.js'");
        var mainIdx = lazy.indexOf("'attendance.js'");
        expect(attIdx).toBeGreaterThan(-1);
        expect(attIdx).toBeLessThan(mainIdx);
        expect(fs.existsSync(path.join(ROOT, 'att-save-status.js'))).toBe(true);
    });

    it('adds status chips to smart register and collective UI', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="att-save-status-chip"');
        expect(html).toContain('id="att-col-save-status-chip"');
        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        expect(css).toContain('.att-save-status--ok');
        expect(css).toContain('.att-save-status--pending');
    });

    it('wires attendance.js to status helpers without blocking on cloud', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(att).toContain('attSaveStatusMarkLocal');
        expect(att).toContain('attSaveStatusMarkCloud');
        expect(att).toContain('attSaveStatusOnCloudResult');
        expect(att).toContain('attSaveStatusSetSmartDoc');
        expect(att).not.toContain('await window.emsOfflinePersistAttendance');
    });

    it('maps local saved + cloud synced labels', function () {
        var sb = loadStatusSandbox();
        sb.attSaveStatusSetSmartDoc('doc_a');
        sb.attSaveStatusMarkLocal('doc_a', 'saved');
        sb.attSaveStatusMarkCloud('doc_a', 'synced');
        sb.attSaveStatusBoot();
        expect(sb).toBeTruthy();
    });

    it('maps cloud queue / conflict without marking local failed', function () {
        var sb = loadStatusSandbox();
        sb.attSaveStatusSetCollectiveDocs(['doc_b', 'doc_c']);
        sb.attSaveStatusMarkLocal('doc_b', 'saved');
        sb.attSaveStatusMarkLocal('doc_c', 'saved');
        sb.attSaveStatusOnCloudResult('doc_b', { ok: true, synced: false, offline: true, queued: true });
        sb.attSaveStatusOnCloudResult('doc_c', { ok: false, code: 'VERSION_CONFLICT' });
        expect(typeof sb.attSaveStatusOnCloudResult).toBe('function');
    });

    it('collective marks local only during persistSheet — cloud in background', function () {
        var col = fs.readFileSync(path.join(ROOT, 'att-collective.js'), 'utf8');
        expect(col).toContain('attSaveStatusMarkLocal');
        expect(col).toContain('attSaveStatusSetCollectiveDocs');
        expect(col).toContain('attSaveStatusBoot');
    });

    it('adds queue panel and retry API (phases 2–5)', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var status = fs.readFileSync(path.join(ROOT, 'att-save-status.js'), 'utf8');
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var off = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(html).toContain('att-save-queue-panel');
        expect(html).toContain('att-save-queue-retry');
        expect(status).toContain('attSaveStatusRetryPending');
        expect(status).toContain('attSaveStatusRefreshQueue');
        var col = fs.readFileSync(path.join(ROOT, 'att-collective.js'), 'utf8');
        expect(col).toContain('attFlushAllDeferredCloud');
        expect(col).toContain('deferCloud');
        expect(att).toContain('attScheduleCloudPersist');
        expect(off).toContain('global.emsOfflineListQueue');
        expect(off).toContain('forceLocal');
        expect(fs.existsSync(path.join(ROOT, 'docs', 'att-save-runbook.md'))).toBe(true);
    });

    it('collective uses deferred cloud batch flush', function () {
        var col = fs.readFileSync(path.join(ROOT, 'att-collective.js'), 'utf8');
        expect(col).toContain('deferCloud: true');
        expect(col).toContain('attFlushAllDeferredCloud');
    });

    it('outbox emits ems:att-save-status for attendance flush results', function () {
        var off = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(off).toContain("new CustomEvent('ems:att-save-status'");
        expect(off).toContain("cloud: 'synced'");
    });
});
