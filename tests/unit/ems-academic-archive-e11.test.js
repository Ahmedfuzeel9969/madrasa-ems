import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readAppScriptManifest, readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise E11-S1 — Historical archiving', function () {
    it('ems-academic-archive.js exposes 2-year window helpers', function () {
        var src = readScript(ROOT, 'ems-academic-archive.js');
        expect(src).toContain('emsArchiveCutoffMonth');
        expect(src).toContain('emsArchivePruneLocalStorage');
        expect(src).toContain('emsArchiveRunYear');
        expect(src).toContain('MAX_MONTHS = 24');
    });

    it('tenant-academic-archive CF exports archiveTenantAcademicYear', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions/lib/tenant-academic-archive.js'), 'utf8');
        expect(src).toContain('Archive_Attendance');
        expect(src).toContain('Archive_Finance');
        expect(src).toContain('Archive_Meta');
    });

    it('functions index exports archiveTenantAcademicYear', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
        expect(src).toContain('archiveTenantAcademicYear');
    });

    it('modules filter by archive window', function () {
        expect(fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8')).toContain('emsArchiveFilterFeeCollections');
        expect(fs.readFileSync(path.join(ROOT, 'ledger.js'), 'utf8')).toContain('emsArchiveFilterByDate');
        expect(fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8')).toContain('emsArchiveMonthInWindow');
        expect(fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8')).toContain('emsArchivePruneLocalStorage');
    });

    it('firestore rules declare Archive_* collections', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('Archive_Meta');
        expect(rules).toContain('Archive_Ledger');
    });

    it('post-auth bundle loads ems-academic-archive.js', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.combined).toContain('ems-academic-archive.js');
        expect(m.html).toContain('emsPerfArchiveAcademicYear');
    });
});
