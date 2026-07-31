import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 4 — backup & migration safety', function () {
    it('backup-production.js exists and snapshots rules', function () {
        var src = fs.readFileSync(path.join(ROOT, 'scripts', 'backup-production.js'), 'utf8');
        expect(src).toContain('firestore.rules');
        expect(src).toContain('manifest.json');
        expect(src).toContain('checkStorageApi');
    });

    it('npm run backup:snapshot creates manifest', function () {
        execSync('node scripts/backup-production.js --snapshot-only --skip-cloud-checks', {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 15000
        });
        var latest = fs.readFileSync(path.join(ROOT, 'backups', 'LATEST.txt'), 'utf8').trim();
        var manifestPath = path.join(ROOT, 'backups', latest, 'manifest.json');
        expect(fs.existsSync(manifestPath)).toBe(true);
        var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest.files.length).toBeGreaterThan(3);
        expect(manifest.checklist).toBeDefined();
    });

    it('PHASE4-BACKUP-PROTOCOL.md documents workflow', function () {
        var doc = fs.readFileSync(path.join(ROOT, 'docs', 'PHASE4-BACKUP-PROTOCOL.md'), 'utf8');
        expect(doc).toContain('backup:snapshot');
        expect(doc).toContain('deploy:safe');
        expect(doc).toContain('rollback');
    });

    it('ems-perf-settings exposes tenant backup helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-perf-settings.js'), 'utf8');
        expect(src).toContain('emsPerfDownloadTenantBackup');
        expect(src).toContain('emsPerfMigrationChecklist');
    });

    it('DISASTER-RECOVERY-PROCEDURE.md documents workflow', function () {
        var doc = fs.readFileSync(path.join(ROOT, 'docs', 'DISASTER-RECOVERY-PROCEDURE.md'), 'utf8');
        expect(doc).toContain('backup:full');
        expect(doc).toContain('backup:verify-dr');
        expect(doc).toContain('Scenario A');
    });

    it('package.json exposes backup and deploy:safe scripts', function () {
        var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['backup:snapshot']).toBeDefined();
        expect(pkg.scripts['deploy:safe']).toBeDefined();
    });
});
