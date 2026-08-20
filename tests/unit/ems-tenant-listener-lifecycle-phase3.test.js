/**
 * PHASE 3 — Listener lifecycle + in-flight async protection during tenant switch
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var TENANT_A = 'tenant-A';
var TENANT_B = 'tenant-B';

function loadEnv() {
    var physical = Object.create(null);
    var stops = { att: 0, reg: 0, dash: 0, dashStats: 0, moduleSummaries: 0 };
    var sb = {
        physical: physical,
        _stops: stops,
        console: console,
        Promise: Promise,
        CustomEvent: function (n, i) { this.type = n; this.detail = i && i.detail; },
        dispatchEvent: function () {},
        CURRENT_MADRASA_TENANT_ID: null,
        EMS_ACTIVE_TENANT_ID: null,
        EMS_TENANT_STORAGE_READY: false,
        emsStopAttendanceSync: function () { stops.att++; },
        emsStopRegistrationLiveSync: function () { stops.reg++; },
        emsStopDashboardLive: function () { stops.dash++; },
        emsStopDashboardStatsListener: function () { stops.dashStats++; },
        emsStopModuleSummariesListener: function () { stops.moduleSummaries++; },
        localStorage: {
            getItem: function (k) { return physical[k] != null ? physical[k] : null; },
            setItem: function (k, v) { physical[k] = String(v); },
            removeItem: function (k) { delete physical[k]; }
        }
    };
    sb.window = sb;
    sb.global = sb;
    sb.globalThis = sb;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8'), sb);
    return sb;
}

describe('Phase 3 — TASK 3.1 central listener teardown on tenant switch', function () {
    var env;
    beforeEach(function () { env = loadEnv(); });

    it('all five listener-stop functions called on A → B switch', function () {
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        env.EMS_ACTIVE_TENANT_ID = TENANT_A;
        env.emsActivateTenantStorage(TENANT_B);
        expect(env._stops.att).toBeGreaterThan(0);
        expect(env._stops.reg).toBeGreaterThan(0);
        expect(env._stops.dash).toBeGreaterThan(0);
        expect(env._stops.dashStats).toBeGreaterThan(0);
        expect(env._stops.moduleSummaries).toBeGreaterThan(0);
    });

    it('first activation also runs central teardown (safe/idempotent)', function () {
        env.emsActivateTenantStorage(TENANT_A);
        expect(env._stops.att).toBeGreaterThanOrEqual(1);
    });

    it('stopTenantBoundListenersForTransition is called before identity flip', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8');
        var block = src.slice(
            src.indexOf('global.emsActivateTenantStorage = function'),
            src.indexOf('global.emsLiteLoginPrepare = function')
        );
        var stopIdx = block.indexOf('stopTenantBoundListenersForTransition');
        var activeIdx = block.indexOf('EMS_ACTIVE_TENANT_ID = tenantId');
        expect(stopIdx).toBeGreaterThan(-1);
        expect(activeIdx).toBeGreaterThan(-1);
        expect(stopIdx).toBeLessThan(activeIdx);
    });

    it('source audit: setupLiveAttendanceListener captures listenerTenantId + generation', function () {
        var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        var block = att.slice(
            att.indexOf('function setupLiveAttendanceListener'),
            att.indexOf('\nfunction attHasValidRegisterSession')
        );
        expect(block).toContain('listenerTenantId');
        expect(block).toContain('listenerGeneration');
        expect(block).toContain('attSnapshotMayMutateTenantState');
    });
});

describe('Phase 3 — TASK 3.2 generation guard on async callbacks', function () {
    var env;
    beforeEach(function () { env = loadEnv(); });

    it('emsAssertTenantBoundMutation rejects stale generation after ready', function () {
        env.EMS_ACTIVE_TENANT_ID = TENANT_A;
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        env.EMS_TENANT_STORAGE_READY = true;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        var gen0 = env.emsGetTenantGeneration();
        env.emsActivateTenantStorage(TENANT_B);
        env.EMS_TENANT_STORAGE_READY = true;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        var result = env.emsAssertTenantBoundMutation(TENANT_A, gen0);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('STALE_GENERATION');
    });

    it('emsAssertTenantBoundMutation rejects wrong source tenant (same generation, ready)', function () {
        env.emsActivateTenantStorage(TENANT_B);
        env.EMS_TENANT_STORAGE_READY = true;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        var gen = env.emsGetTenantGeneration();
        var result = env.emsAssertTenantBoundMutation(TENANT_A, gen);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('TENANT_MISMATCH');
    });

    it('emsAssertTenantBoundMutation rejects during transition', function () {
        env.EMS_ACTIVE_TENANT_ID = TENANT_A;
        env.CURRENT_MADRASA_TENANT_ID = TENANT_A;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = true;
        var result = env.emsAssertTenantBoundMutation(TENANT_A, 0);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('TENANT_TRANSITION');
    });

    it('emsAssertTenantBoundMutation passes when source matches canonical and generation current', function () {
        env.emsActivateTenantStorage(TENANT_A);
        env.EMS_TENANT_STORAGE_READY = true;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        var gen = env.emsGetTenantGeneration();
        var result = env.emsAssertTenantBoundMutation(TENANT_A, gen);
        expect(result.ok).toBe(true);
        expect(result.tenantId).toBe(TENANT_A);
    });

    it('rapid A→B→A: stale gen from A-first-era rejects, current gen passes', function () {
        env.emsActivateTenantStorage(TENANT_A);
        var genA1 = env.emsGetTenantGeneration();
        env.emsActivateTenantStorage(TENANT_B);
        env.emsActivateTenantStorage(TENANT_A);
        env.EMS_TENANT_STORAGE_READY = true;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        expect(env.emsAssertTenantBoundMutation(TENANT_A, genA1).ok).toBe(false);
        expect(env.emsAssertTenantBoundMutation(TENANT_A, env.emsGetTenantGeneration()).ok).toBe(true);
    });

    it('logout bumps generation; post-logout callback rejected', function () {
        env.emsActivateTenantStorage(TENANT_A);
        var gen = env.emsGetTenantGeneration();
        env.EMS_TENANT_STORAGE_READY = true;
        env.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        // simulate logout
        env.EMS_TENANT_GENERATION = gen + 1;
        env.EMS_ACTIVE_TENANT_ID = null;
        env.CURRENT_MADRASA_TENANT_ID = null;
        expect(env.emsAssertTenantBoundMutation(TENANT_A, gen).ok).toBe(false);
    });
});
