import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readAppScriptManifest, readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Student list consistency fix (regent12/regent14)', function () {
    it('pipeline debug module exists', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-data-pipeline-debug.js'), 'utf8');
        expect(src).toContain('emsPipelineDebug');
        expect(src).toContain('emsPipelineDebugQuery');
        expect(src).toContain('tenantId');
    });

    it('module boot retries when repo empty but server has data', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-bootstrap.js'), 'utf8');
        expect(src).toContain('checkFirestoreHasRegistrations');
        expect(src).toContain('emsRegRepoBulkHydrate');
        expect(src).toContain('_emptyRetried');
        expect(src).toContain('hydrationFailed');
    });

    it('registration sync does not return lite login when started', function () {
        var src = readScript(ROOT, 'ems-registration-sync.js');
        expect(src).not.toContain('emsBootRegistrationData()');
        expect(src).toContain('emsBootRegistrationModule');
    });

    it('renderRegTable auto-fetches when empty', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('reg_table_empty_auto_fetch');
        expect(src).toContain('emsEnsureRegistrationSync');
    });

    it('switchRegTab uses optional consistency guard before list render', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toMatch(/currentRegType === 'list'[\s\S]*emsGuardRegistrationListRender/);
        expect(src).toContain("typeof window.emsGuardRegistrationListRender === 'function'");
    });

    it('firebase read API in cloud manifest with server-first fetch', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.cloud).toContain('cloud/ems-firebase-read-api.js');
        var fb = readScript(ROOT, 'ems-firebase-read-api.js');
        expect(fb).toContain('emsFirebaseEnsureModuleData');
        expect(fb).toContain('emsFirebaseLoadListForUI');
        expect(fb).toContain("source: 'server'");
    });

    it('repository hydrates IDB then fetches Firestore server page', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('hydrateFromIdb');
        expect(src).toContain("source: 'server'");
    });

    it('admission optionally invokes consistency guard hook (no standalone guard module)', function () {
        var admission = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(admission).toContain('emsGuardRegistrationListRender');
        expect(fs.existsSync(path.join(ROOT, 'ems-consistency-guard.js'))).toBe(false);
    });

    it('bootstrap does not mark boot complete when Firestore has data but repo empty', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-bootstrap.js'), 'utf8');
        expect(src).toContain('var bootComplete = bootCount > 0 || !wrap.fsHasData');
        expect(src).toMatch(/if \(bootCount === 0\) moduleBootPromise = null/);
    });

    it('dashboard optionally ensures report data before insights render', function () {
        var dash = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(dash).toContain('emsEnsureDashboardReportData');
        expect(dash).toContain("typeof window.emsEnsureDashboardReportData === 'function'");
    });

    it('meta listener does not wipe repo on first snapshot', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('metaInitialized');
        expect(src).toContain('bumpMetaLocal');
        expect(src).toContain('refresh_kept_backup');
    });

    it('user access ensureReady does not start live sync at boot', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-user-access.js'), 'utf8');
        expect(src).toContain('startLiveSync: false');
    });

    it('repository uses server-only fetch for initial page', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain("source: 'server'");
        expect(src).toContain('fetchPageFromServer');
    });

    it('emsGetUsersMerged reads repo without boot flag gate', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-user-service.js'), 'utf8');
        expect(src).toMatch(/repoList\(\)/);
        expect(src).toContain('if (list.length)');
    });
});
