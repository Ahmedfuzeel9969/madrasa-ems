import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Smart register cloud save status', function () {
    it('binds each smart-register sheet to local and cloud status updates', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toContain('attSaveStatusSetSmartDoc(cloudDocId)');
        expect(src).toContain("attSaveStatusMarkLocal(cloudDocId, 'saved')");
        expect(src).toContain('attSaveStatusOnCloudResult(p.cloudDocId, res');
        expect(src).toContain("code: 'OUTBOX_UNAVAILABLE'");
    });

    it('uses only clear local, cloud success, and cloud failure labels', function () {
        var src = fs.readFileSync(path.join(ROOT, 'att-save-status.js'), 'utf8');
        expect(src).toContain("local_only: 'مقامی طور پر محفوظ'");
        expect(src).toContain("local_and_cloud: 'کلاؤڈ پر محفوظ'");
        expect(src).toContain("cloud_failed: 'کلاؤڈ پر ناکام'");
        expect(src).not.toContain("'اس آلے پر محفوظ ✓ · سنک انتظار…'");
    });

    it('does not classify a Firebase flush error as offline success', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('var failed = !!(res && (res.error || res.code));');
        expect(src).toContain('ok: !failed');
        expect(src).toContain('offline: !synced && !failed');
    });
});
