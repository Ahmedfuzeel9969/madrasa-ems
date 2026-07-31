import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadParentAnnouncementHelpers() {
    var src = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'parent-data.js'), 'utf8');
    function extractFn(name) {
        var re = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
        var m = src.match(re);
        if (!m) throw new Error('Could not extract ' + name);
        return m[0];
    }
    var body = [
        extractFn('normalizeAnnouncementAudience'),
        extractFn('announcementVisibleToParent'),
        'global.normalizeAnnouncementAudience = normalizeAnnouncementAudience;',
        'global.announcementVisibleToParent = announcementVisibleToParent;'
    ].join('\n');
    var ctx = { global: {} };
    vm.runInNewContext(body, ctx, { filename: 'parent-data-helpers.js' });
    return {
        visible: ctx.global.announcementVisibleToParent,
        normalize: ctx.global.normalizeAnnouncementAudience
    };
}

function loadAnnNormalizeItem() {
    var src = fs.readFileSync(path.join(ROOT, 'announcements.js'), 'utf8');
    var m = src.match(/window\.annNormalizeItem\s*=\s*function\s*\([^)]*\)\s*\{[\s\S]*?\n  \};/);
    if (!m) throw new Error('annNormalizeItem not found');
    var ctx = { window: {} };
    ctx.global = ctx;
    vm.runInNewContext(m[0].replace('window.annNormalizeItem', 'global.annNormalizeItem'), ctx, { filename: 'announcements-normalize.js' });
    return ctx.global.annNormalizeItem;
}

describe('Announcements Phase A — Firestore lockdown & server-side targeting', function () {
    it('firestore.rules denies parents direct read on Announcements', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        var block = rules.match(/match \/Announcements\/\{docId\}\s*\{[\s\S]*?\n      \}/);
        expect(block).toBeTruthy();
        expect(block[0]).toContain('allow read: if canReadTenantStaff(madrasaId)');
        expect(block[0]).not.toContain('isParentOf(madrasaId)');
    });

    it('fetchAnnouncements receives studentId from getParentStudentData', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'parent-data.js'), 'utf8');
        expect(src).toMatch(/async function fetchAnnouncements\(db, tenantId, studentId/);
        expect(src).toMatch(/fetchStudentProfile\(db, tenantId, studentId\)/);
        expect(src).toMatch(/view === 'announcements'\) return fetchAnnouncements\(db, tenantId, studentId, context\.auth\.uid\)/);
        expect(src).toMatch(/view === 'teacher_notes'\) return fetchTeacherNotes\(db, tenantId, studentId, context\.auth\.uid\)/);
    });

    it('announcementVisibleToParent excludes staff and teachers audiences', function () {
        var h = loadParentAnnouncementHelpers();
        var profile = { className: 'حفظ پارہ 1', department: 'حفظ' };
        expect(h.visible({ audience: 'staff', title: 'Secret' }, 'STD001', profile)).toBe(false);
        expect(h.visible({ audience: 'teachers', title: 'Secret' }, 'STD001', profile)).toBe(false);
        expect(h.visible({ audience: 'all', status: 'pending', kind: 'decision' }, 'STD001', profile)).toBe(false);
    });

    it('announcementVisibleToParent allows all, parents, and students broadcasts', function () {
        var h = loadParentAnnouncementHelpers();
        var profile = { className: 'A', department: 'X' };
        expect(h.visible({ audience: 'all' }, 'STD001', profile)).toBe(true);
        expect(h.visible({ audience: 'parents' }, 'STD001', profile)).toBe(true);
        expect(h.visible({ audience: 'students' }, 'STD001', profile)).toBe(true);
        expect(h.visible({ audience: 'parent', studentId: 'STD001' }, 'STD001', profile)).toBe(true);
        expect(h.visible({ audience: 'parent', studentId: 'STD002' }, 'STD001', profile)).toBe(false);
    });

    it('announcementVisibleToParent enforces class, dept, and individual targeting', function () {
        var h = loadParentAnnouncementHelpers();
        var profile = { className: 'حفظ پارہ 1', department: 'حفظ' };
        expect(h.visible({
            audience: 'class',
            audienceMeta: { className: 'حفظ پارہ 1' }
        }, 'STD001', profile)).toBe(true);
        expect(h.visible({
            audience: 'class',
            audienceMeta: { className: 'حفظ پارہ 2' }
        }, 'STD001', profile)).toBe(false);
        expect(h.visible({
            audience: 'dept',
            audienceMeta: { dept: 'حفظ' }
        }, 'STD001', profile)).toBe(true);
        expect(h.visible({
            audience: 'dept',
            audienceMeta: { dept: 'عامہ' }
        }, 'STD001', profile)).toBe(false);
        expect(h.visible({
            audience: 'individual',
            audienceMeta: { ids: ['STD001', 'STD009'] }
        }, 'STD001', profile)).toBe(true);
        expect(h.visible({
            audience: 'individual',
            audienceMeta: { ids: ['STD099'] }
        }, 'STD001', profile)).toBe(false);
    });

    it('annNormalizeItem maps Urdu والدین strings to parents not students', function () {
        var normalize = loadAnnNormalizeItem();
        expect(normalize({ audience: 'تمام والدین' }).audience).toBe('parents');
        expect(normalize({ audience: 'والدین کیلئے' }).audience).toBe('parents');
        expect(normalize({ audience: 'تمام طلبہ' }).audience).toBe('students');
        expect(normalize({ audience: 'اساتذہ و طلبہ' }).audience).toBe('staff');
    });
});
