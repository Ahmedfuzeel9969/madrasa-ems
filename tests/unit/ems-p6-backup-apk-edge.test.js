import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P6-F — in-app backup restore guards', function () {
    it('restoreBackup requires confirmed option (source contract)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud', 'backup-service.js'), 'utf8');
        expect(src).toContain('if (!options.confirmed)');
        expect(src).toContain('بحالی کی تصدیق درکار ہے');
        expect(src).toContain("createBackup(uid, 'pre_restore')");
        expect(src).toContain('verifyRestore');
    });

    it('validateBackup rejects missing backup meta', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud', 'backup-service.js'), 'utf8');
        expect(src).toContain("return { valid: false, error: 'بیک اپ نہیں ملا' }");
        expect(src).toContain('checksumOk');
    });

    it('restore pushes errors to report.errors without silent swallow', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud', 'backup-service.js'), 'utf8');
        expect(src).toContain('report.errors');
    });
});

describe('P6-H — APK / build asset parity', function () {
    it('android sync manifest exists after sync workflow', function () {
        var manifestPath = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public', '.ems-android-sync.json');
        expect(fs.existsSync(manifestPath)).toBe(true);
        var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest.distBuiltAt).toBeTruthy();
        expect(manifest.files && manifest.files['ems-idb-engine.js']).toBeTruthy();
        expect(manifest.files && manifest.files['ems-search-index.js']).toBeTruthy();
    });

    it('web and android ems-idb-engine SEARCH_INDEX_VERSION match', function () {
        function readVer(rel) {
            var text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            var m = text.match(/SEARCH_INDEX_VERSION\s*=\s*(\d+)/);
            return m ? parseInt(m[1], 10) : null;
        }
        expect(readVer('ems-idb-engine.js')).toBe(3);
        expect(readVer('android/app/src/main/assets/public/ems-idb-engine.js')).toBe(3);
    });
});
