import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readAppScriptManifest, readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 2 Sprint 2 — dashboard stats & deferred sync', function () {
    it('tenant-dashboard-stats cloud function module exists', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions/lib/tenant-dashboard-stats.js'), 'utf8');
        expect(src).toContain('DashboardStats');
        expect(src).toContain('refreshTenantDashboardStats');
        expect(src).toContain('onRegistrationStatsWrite');
        expect(src).toContain('FeeSummary');
    });

    it('functions index exports tenant dashboard stats', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
        expect(src).toContain('refreshTenantDashboardStats');
        expect(src).toContain('onFeeCollectionStatsWrite');
    });

    it('ems-dashboard-stats.js client module', function () {
        var src = readScript(ROOT, 'ems-dashboard-stats.js');
        expect(src).toContain('emsStartDashboardStatsListener');
        expect(src).toContain('emsApplyDashboardStats');
    });

    it('deferred registration sync', function () {
        var src = readScript(ROOT, 'ems-registration-sync.js');
        expect(src).toContain('emsEnsureRegistrationSync');
        var auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(auth).not.toContain('emsStartRegistrationSync()');
    });

    it('attendance-helper uses month-scoped query', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(src).toContain('fetchAttendanceDocsForMonth');
        expect(src).toContain("FieldPath.documentId()");
        expect(src).not.toMatch(/collection\('Attendance'\)\s*\n\s*\.get\(\)/);
    });

    it('dashboard uses stats listener and reduced polling', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsStartDashboardStatsListener');
        expect(src).toContain('120000');
        expect(src).toContain('useServerKpis');
    });

    it('firestore rules allow read DashboardStats', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('DashboardStats');
        expect(rules).toContain('FeeSummary');
    });

    it('post-auth bundle loads S2 scripts', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.combined).toContain('ems-dashboard-stats.js');
        expect(m.combined).toContain('ems-registration-sync.js');
    });
});
