import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase A4 — registration write-trigger sync', function () {
    it('live-sync module has no Registrations collection onSnapshot', function () {
        var src = fs.readFileSync(path.join(ROOT, 'cloud', 'ems-registration-live-sync.js'), 'utf8');
        expect(src).toContain('emsStartRegistrationWriteSync');
        expect(src).toContain('write_trigger');
        expect(src).not.toContain('.onSnapshot(onSnapshotSuccess');
        expect(src).not.toMatch(/collection\('Registrations'\)[\s\S]*onSnapshot/);
    });

    it('repository exposes meta notify and targeted apply', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('emsRegRepoNotifyRemoteWrite');
        expect(src).toContain('emsRegRepoNotifyRemoteRefresh');
        expect(src).toContain('emsRegRepoEnsureMetaListener');
        expect(src).toContain('applyRemoteChange');
        expect(src).toContain("change.op === 'refresh'");
    });

    it('mutation bus notifies RegistrationMeta after cloud sync', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-cloud-mutation.js'), 'utf8');
        expect(src).toContain('emsCloudEmitMutation');
        expect(src).toContain('emsRegRepoNotifyRemoteWrite');
    });

    it('bootstrap starts write-sync on lite login', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-bootstrap.js'), 'utf8');
        expect(src).toContain('emsStartRegistrationWriteSync');
    });

    it('firestore rules allow RegistrationMeta for tenant staff', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('match /RegistrationMeta/{docId}');
        expect(rules).toContain('canWriteRegistration(madrasaId)');
    });
});
