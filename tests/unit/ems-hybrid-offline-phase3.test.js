import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Hybrid Offline-First Phase 3', function () {
    it('ems-offline-write.js exists with module APIs', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('emsOfflinePersistRegistration');
        expect(src).toContain('emsOfflinePersistAttendance');
        expect(src).toContain('emsOfflinePersistFeeRecord');
        expect(src).toContain('emsOfflineDeleteRegistration');
        expect(src).toContain('emsOfflineFlushRow');
    });

    it('admission.js uses offline registration persist', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('emsOfflinePersistRegistration');
        expect(src).toContain('emsOfflineDeleteRegistration');
    });

    it('attendance.js uses offline attendance persist', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toContain('emsOfflinePersistAttendance');
    });

    it('finance.js uses delta module save for fee collections', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('autoDelta: true');
        expect(src).toContain('emsSaveModuleData');
    });

    it('post-auth loader includes offline-write + mutation bus', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        expect(src).toContain('ems-offline-write.js');
        expect(src).toContain('ems-cloud-mutation.js');
    });
});
