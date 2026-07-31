import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var backupLib = require('../../scripts/backup-lib.js');

var SIM_DIR = path.join(ROOT, 'backups', '_dr-test-tmp');

describe('Priority 1 — Disaster Recovery System', function () {
    beforeEach(function () {
        if (fs.existsSync(SIM_DIR)) {
            fs.rmSync(SIM_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(SIM_DIR, { recursive: true });
    });

    afterEach(function () {
        if (fs.existsSync(SIM_DIR)) {
            fs.rmSync(SIM_DIR, { recursive: true, force: true });
        }
    });

    it('backup-lib encrypts and decrypts payload with matching checksum', function () {
        var payload = {
            tenantId: 't1',
            registration: { users: [{ id: 'a' }], rejected: [] }
        };
        var enc = backupLib.encryptPayload(payload, 'test-passphrase-12345678');
        expect(enc.format).toBe('ems-dr-bundle');
        expect(enc.encrypted).toBe(true);
        var dec = backupLib.decryptPayload(enc, 'test-passphrase-12345678');
        expect(dec.tenantId).toBe('t1');
    });

    it('wrong passphrase throws on decrypt', function () {
        var enc = backupLib.encryptPayload({ x: 1 }, 'correct-passphrase-123456');
        expect(function () {
            backupLib.decryptPayload(enc, 'wrong-passphrase-123456');
        }).toThrow(/checksum mismatch|Unsupported state/);
    });

    it('inventoryTenantPayload counts all business record types', function () {
        var payload = {
            registration: { users: [{ id: '1' }, { id: '2' }], rejected: [{ id: 'r1' }] },
            attendance: [{ id: 'a1' }],
            complaints: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
            modules: { ems_fee_collections: JSON.stringify([{ id: 'f1' }]) }
        };
        var inv = backupLib.inventoryTenantPayload(payload);
        expect(inv.registrations).toBe(2);
        expect(inv.rejected).toBe(1);
        expect(inv.attendance_registers).toBe(1);
        expect(inv.complaints).toBe(3);
        expect(inv.total_records).toBeGreaterThanOrEqual(7);
    });

    it('compareInventories detects count mismatch', function () {
        var a = { registrations: 10, rejected: 0, attendance_registers: 0, complaints: 0, module_keys: 0, idb_keys: 0, total_records: 10 };
        var b = { registrations: 9, rejected: 0, attendance_registers: 0, complaints: 0, module_keys: 0, idb_keys: 0, total_records: 9 };
        var cmp = backupLib.compareInventories(a, b);
        expect(cmp.ok).toBe(false);
        expect(cmp.diffs[0].field).toBe('registrations');
    });

    it('simulateMachineFailureRecovery — wipe and restore with matching counts', function () {
        var fake = {
            tenantId: 'sim-001',
            registration: {
                users: Array.from({ length: 50 }, function (_, i) { return { id: 'S' + i }; }),
                rejected: []
            },
            attendance: [],
            complaints: [],
            modules: {}
        };
        backupLib.writeJson(path.join(SIM_DIR, 'tenant-export.json'), fake);
        var result = backupLib.simulateMachineFailureRecovery(SIM_DIR, 'sim-passphrase-12345678');
        expect(result.verification.ok).toBe(true);
        expect(fs.existsSync(path.join(SIM_DIR, 'tenant-export.json'))).toBe(true);
        expect(result.inventory.registrations).toBe(50);
    });

    it('disaster-recovery-restore --simulate exits with PASS', function () {
        var out = execSync('node scripts/disaster-recovery-restore.js --simulate --dir=' + SIM_DIR, {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 15000
        });
        expect(out).toContain('[simulate] Verification: PASS');
        expect(out).toContain('Counts match');
    });

    it('disaster-recovery-backup creates dr-manifest with tier checklist', function () {
        execSync('node scripts/disaster-recovery-backup.js --skip-cloud --config-only', {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 20000,
            stdio: 'pipe'
        });
        var latest = fs.readFileSync(path.join(ROOT, 'backups', 'LATEST-DR.txt'), 'utf8').trim();
        var manifestPath = path.join(ROOT, 'backups', latest, 'dr-manifest.json');
        expect(fs.existsSync(manifestPath)).toBe(true);
        var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest.type).toBe('disaster-recovery');
        expect(manifest.tiers.config.ok).toBe(true);
        expect(Array.isArray(manifest.checklist)).toBe(true);
        expect(manifest.recoveryProcedure).toContain('DISASTER-RECOVERY-PROCEDURE');
    });

    it('restore roundtrip from encrypted bundle preserves inventory', function () {
        var fake = {
            tenantId: 'roundtrip-1',
            registration: { users: [{ id: 'u1' }], rejected: [] },
            attendance: [{ id: 'att1', data: {} }],
            complaints: [],
            modules: { ems_fee_collections: '[]' }
        };
        var inv = backupLib.inventoryTenantPayload(fake);
        var bundle = backupLib.encryptPayload({ tenantId: fake.tenantId, export: fake, inventory: inv }, 'roundtrip-pass-12345678');
        var bundlePath = path.join(SIM_DIR, 'test.emsbak');
        backupLib.writeJson(bundlePath, bundle);

        var restoreMod = require('../../scripts/disaster-recovery-restore.js');
        var result = restoreMod.restoreFromBundle(bundlePath, 'roundtrip-pass-12345678', path.join(SIM_DIR, 'out'));
        expect(result.verification.ok).toBe(true);
        expect(result.inventory.registrations).toBe(1);
        expect(result.inventory.attendance_registers).toBe(1);
    });

    it('DISASTER-RECOVERY-PROCEDURE.md documents all recovery scenarios', function () {
        var doc = fs.readFileSync(path.join(ROOT, 'docs', 'DISASTER-RECOVERY-PROCEDURE.md'), 'utf8');
        expect(doc).toContain('Scenario A');
        expect(doc).toContain('tenant-encrypted.emsbak');
        expect(doc).toContain('backup:verify-dr');
        expect(doc).toContain('AES-256-GCM');
    });

    it('backup-service exposes checksum and verifyRestore', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud', 'backup-service.js'), 'utf8');
        expect(src).toContain('verifyRestore');
        expect(src).toContain('validateBackup');
        expect(src).toContain('recordCounts');
        expect(src).toContain('createBackup');
    });

    it('package.json exposes backup:full and backup:verify-dr scripts', function () {
        var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['backup:full']).toBeDefined();
        expect(pkg.scripts['backup:verify-dr']).toBeDefined();
        expect(pkg.scripts['backup:restore']).toBeDefined();
    });
});
