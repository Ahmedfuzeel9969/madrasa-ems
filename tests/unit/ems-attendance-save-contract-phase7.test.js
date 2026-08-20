import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadNormalize() {
    var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
    var start = src.indexOf('function isSoftCloudCode');
    var end = src.indexOf('function isAttendanceQueueType');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    var sandbox = { console: console };
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(
        src.slice(start, end)
        + '\nthis.emsNormalizeCloudResult = global.emsNormalizeCloudResult;',
        sandbox
    );
    return sandbox;
}

function loadStatus() {
    var n = loadNormalize();
    var els = Object.create(null);
    n.document = {
        getElementById: function (id) {
            if (!els[id]) {
                els[id] = {
                    textContent: '',
                    className: '',
                    innerHTML: '',
                    setAttribute: function () {},
                    removeAttribute: function () {},
                    classList: { toggle: function () {}, contains: function () { return true; }, add: function () {}, remove: function () {} },
                    addEventListener: function () {}
                };
            }
            return els[id];
        },
        readyState: 'complete'
    };
    n.addEventListener = function () {};
    n.dispatchEvent = function () {};
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'att-save-status.js'), 'utf8'), n);
    n._chip = n.document.getElementById('att-save-status-chip');
    return n;
}

describe('Phase 7 — save result contract (TASK 7.1)', function () {
    it('keeps error/code and does not mark permission failure as cloud-saved or offline', function () {
        var api = loadNormalize();
        var res = api.emsNormalizeCloudResult({
            ok: true,
            synced: false,
            offline: true,
            queued: true,
            error: 'Missing or insufficient permissions.',
            code: 'PERMISSION_DENIED'
        }, { localSaved: true });
        expect(res.localSaved).toBe(true);
        expect(res.cloudState).toBe('failed');
        expect(res.synced).toBe(false);
        expect(res.offline).toBe(false);
        expect(res.queued).toBe(false);
        expect(res.code).toBe('PERMISSION_DENIED');
        expect(res.error).toMatch(/permission/i);
    });

    it('maps local+queued, local+synced, and local failure distinctly', function () {
        var api = loadNormalize();
        var queued = api.emsNormalizeCloudResult({ synced: false, offline: true, queued: true }, { localSaved: true });
        expect(queued.cloudState).toBe('offline');
        expect(queued.synced).toBe(false);
        var synced = api.emsNormalizeCloudResult({ synced: true }, { localSaved: true });
        expect(synced.cloudState).toBe('synced');
        expect(synced.synced).toBe(true);
        var localFail = api.emsNormalizeCloudResult({ ok: false, error: 'quota' }, { localSaved: false });
        expect(localFail.localSaved).toBe(false);
        expect(localFail.ok).toBe(false);
    });

    it('shows required UI labels for the four save outcomes', function () {
        var sb = loadStatus();
        sb.attSaveStatusSetSmartDoc('att_rec_2026-08_teachers__all');
        sb.attSaveStatusMarkLocal('att_rec_2026-08_teachers__all', 'saved');
        sb.attSaveStatusOnCloudResult('att_rec_2026-08_teachers__all', { synced: true });
        expect(sb._chip.textContent).toBe('کلاؤڈ پر محفوظ');

        sb.attSaveStatusOnCloudResult('att_rec_2026-08_teachers__all', { synced: false, offline: true, queued: true });
        expect(sb._chip.textContent).toBe('مقامی طور پر محفوظ');

        sb.attSaveStatusOnCloudResult('att_rec_2026-08_teachers__all', {
            ok: false, synced: false, code: 'PERMISSION_DENIED', error: 'denied'
        });
        expect(sb._chip.textContent).toBe('مقامی طور پر محفوظ — کلاؤڈ پر ناکام');

        sb.attSaveStatusMarkLocal('att_rec_2026-08_teachers__all', 'failed');
        expect(sb._chip.textContent).toBe('اس آلے پر محفوظ ناکام');
    });

    it('persist wrap preserves cloud error/code instead of dropping them', function () {
        var off = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        var persist = off.slice(off.indexOf('global.emsOfflinePersistAttendance'), off.indexOf('global.emsOfflinePersistRegistration'));
        expect(persist).toContain('normalizeCloudResult(syncRes');
        expect(persist).toContain('localSaved: true');
        expect(off).toContain("cloud: (normalizeCloudResult(res, { localSaved: true }).cloudState)");
    });
});
