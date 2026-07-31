import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('import-export backward-compatible', function () {
    it('core engine preserves public API surface', function () {
        var ie = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(ie).toContain('parseFile: parseFile');
        expect(ie).toContain('exportData: exportData');
        expect(ie).toContain('commit: commit');
        expect(ie).toContain('legacyQuickImport: legacyQuickImport');
        expect(ie).toContain('createSnapshot: createSnapshot');
    });

    it('uses separate localStorage keys for new features', function () {
        var ie = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(ie).toContain('ems_import_snapshot_v1');
        expect(ie).toContain('ems_import_profiles_v1');
    });

    it('commit uses tenant id not raw auth uid', function () {
        var ie = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(ie).toContain('getImportTenantId');
        expect(ie).toContain('emsGetTenantId');
        expect(ie).not.toMatch(/doc\(user\.uid\)\.collection\('Registrations'\)/);
    });

    it('import records get approved status and date', function () {
        var ie = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(ie).toContain("clean.status = 'approved'");
        expect(ie).toContain('clean.date');
    });

    it('supports staging workflow with process commit', function () {
        var ie = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(ie).toContain('ems_import_staging_v1');
        expect(ie).toContain('stageImportBatch');
        expect(ie).toContain('processPendingImport');
        expect(ie).toContain("status: 'pending'");
        var wiz = fs.readFileSync(path.join(ROOT, 'ems-import-wizard.js'), 'utf8');
        expect(wiz).toContain('emsProcessPendingImport');
        expect(wiz).toContain('Confirm Import');
    });

    it('buildRecords uses batch-unique sequential ids', function () {
        var ie = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(ie).toContain('nextSequentialId');
        expect(ie).toContain('maxExistingIdNum');
        expect(ie).toContain('rec.id = nextSequentialId()');
    });

    it('legacy and smart UI layers exist', function () {
        expect(fs.existsSync(path.join(ROOT, 'ems-import-legacy.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'ems-import-smart.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'docs', 'IMPORT-EXPORT-ARCHITECTURE.md'))).toBe(true);
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('legacy-import-panel');
        expect(html).toContain('smart-import-panel');
        var smart = fs.readFileSync(path.join(ROOT, 'ems-import-smart.js'), 'utf8');
        expect(smart).toContain('openImportWizard');
    });
});
