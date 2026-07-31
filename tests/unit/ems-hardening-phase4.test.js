import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 4 — P2 Hardening Part 2', function () {
    it('admin panel exposes unified outbox pending count via emsPendingSyncCount', function () {
        var admin = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(admin).toContain('emsPendingSyncCount');
        expect(admin).toContain('ap-outbox-pending-strip');
        expect(admin).toContain('ap-outbox-pending-count');
        expect(admin).toContain('window.apRenderSyncStatus');

        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="ap-outbox-pending-strip"');
        expect(html).toContain('id="ap-sync-status-box"');
    });

    it('offline policy uses Firestore probe instead of navigator.onLine only', function () {
        var policy = fs.readFileSync(path.join(ROOT, 'ems-offline-policy.js'), 'utf8');
        expect(policy).toContain('probeFirestore');
        expect(policy).toContain("source: 'server'");
        expect(policy).toContain('RegistrationMeta');
        expect(policy).toContain('emsScheduleCloudReachabilityProbe');
        expect(policy).toContain('emsEnsureNetworkForCloudSync');
    });

    it('cloud write paths prefer emsIsNetworkAvailable over raw navigator.onLine', function () {
        var offline = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(offline).toContain('emsIsNetworkAvailable');

        var mutation = fs.readFileSync(path.join(ROOT, 'ems-cloud-mutation.js'), 'utf8');
        expect(mutation).toContain('emsIsNetworkAvailable');
    });

    it('global sync button refreshes after reachability probe', function () {
        var sync = fs.readFileSync(path.join(ROOT, 'ems-global-sync.js'), 'utf8');
        expect(sync).toContain('emsScheduleCloudReachabilityProbe');
    });
});
