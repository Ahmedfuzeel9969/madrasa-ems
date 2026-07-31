import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { EMS_BUILD, readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 2 Sprint 4 — lazy load & deferred sync', function () {
    it('ems-lazy-loader.js exposes lazy module API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(src).toContain('emsLazyLoadModule');
        expect(src).toContain('admission');
        expect(src).toContain('superadmin');
    });

    it('sync-engine init uses pullCoreModules not pullAllModules at login', function () {
        var src = readScript(ROOT, 'sync-engine.js');
        expect(src).toContain('pullCoreModules');
        expect(src).toMatch(/init:[\s\S]*pullCoreModules\(uid\)/);
        expect(src).not.toMatch(/init:[\s\S]*pullAllModules\(uid\)/);
    });

    it('direct-firestore init does not pullAll at login', function () {
        var src = readScript(ROOT, 'direct-firestore.js');
        expect(src).toMatch(/init:\s*function[\s\S]*flushQueue\(\)/);
        expect(src).not.toMatch(/init:\s*function[\s\S]*pullAll\(\)/);
    });

    it('complaints cloud init defers pullAll', function () {
        var src = readScript(ROOT, 'complaints-firestore.js');
        expect(src).toMatch(/init:\s*function[\s\S]*flushQueue\(\)/);
        expect(src).not.toMatch(/init:\s*function[\s\S]*pullAll\(\)/);
    });

    it('auth.js lazy-loads modules and defers attendance sync', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('emsLazyLoadModule');
        expect(src).toContain('bootModule');
        expect(src).not.toMatch(/unlockAppScreen[\s\S]*emsStartAttendanceSync/);
        var syncBlock = src.slice(src.indexOf('window.emsStartSyncEngine'), src.indexOf('window.emsPullModuleGroup'));
        expect(syncBlock).not.toMatch(/CmpCloud\.init/);
        expect(src).toContain("'admission': 'Registration'");
        expect(src).toContain("'attendance': 'Attendance'");
    });

    it('attendance sync starts when module opens', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toMatch(/emsOpenAttendance[\s\S]*emsStartAttendanceSync/);
    });

    it('index.html loads lazy loader and omits eager module scripts', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ems-lazy-loader.js');
        expect(html).toContain(EMS_BUILD.CACHE_BUST.syncHardening);
        expect(html).not.toContain('src="admission.js');
        expect(html).not.toContain('src="attendance.js');
        expect(html).not.toContain('src="sa/sa-core.js');
    });
});
