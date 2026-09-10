import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function quotedValues(source) {
    return Array.from(source.matchAll(/['"]([^'"]+)['"]/g), function (match) {
        return match[1];
    });
}

function loadAdminPanelForSnapshot(seed) {
    const store = new Map(Object.entries(seed || {}));
    const localStorage = {
        getItem(key) { return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(key, String(value)); },
        removeItem(key) { store.delete(key); }
    };
    const document = {
        readyState: 'loading',
        activeElement: null,
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    const context = {
        console,
        Date,
        JSON,
        Math,
        Object,
        Promise,
        Array,
        String,
        Set,
        localStorage,
        document,
        navigator: { onLine: true },
        setInterval() { return 0; },
        setTimeout() { return 0; },
        clearInterval() {},
        clearTimeout() {}
    };
    context.window = context;
    context.window.addEventListener = function () {};
    context.window.PARENT_VIEWS = [{ id: 'attendance', name: 'حاضری', icon: 'fa-calendar-check' }];
    context.window.PARENT_MSG_CATEGORIES = [];
    context.window.emsParentGetAllPerms = function () {
        return JSON.parse(localStorage.getItem('ems_parent_permissions') || '{}');
    };
    context.window.emsParentMigratePerm = function (existing, studentId) {
        return Object.assign({ studentId, status: 'active', views: {}, temporary: {}, history: [] }, existing || {});
    };
    context.window.emsParentTempActive = function (perm, viewId) {
        const item = (perm.temporary || {})[viewId];
        return !!(item && item.expiry && new Date(item.expiry).getTime() > Date.now());
    };
    vm.runInNewContext(read('admin-panel.js'), context, { filename: 'admin-panel.js' });
    return context.window;
}

function loadLayoutBuilder(savedConfig) {
    const localStorage = {
        getItem(key) { return key === 'ems_layout_config' ? JSON.stringify(savedConfig) : null; },
        setItem() {}
    };
    const document = {
        readyState: 'loading',
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    const context = {
        console,
        JSON,
        Object,
        Array,
        localStorage,
        document,
        setTimeout() { return 0; },
        confirm() { return false; }
    };
    context.window = context;
    vm.runInNewContext(read('sys-layout-builder.js'), context, { filename: 'sys-layout-builder.js' });
    return context.window;
}

describe('Admin Panel sub-navigation and permission catalogue order', function () {
    it('uses one eight-button accessible sub-navigation with dashboard first and has no legacy selector', function () {
        const html = read('index.html');
        expect(html).not.toContain('id="main-ap-dropdown"');

        const menuMatch = html.match(/<div class="reg-tabs" id="ap-ribbon-menu"[\s\S]*?<\/div>/);
        expect(menuMatch, 'admin sub-navigation must exist').not.toBeNull();

        const menu = menuMatch[0];
        const panelIds = Array.from(menu.matchAll(/data-ap-panel="([^"]+)"/g), function (match) {
            return match[1];
        });
        const controlledIds = Array.from(menu.matchAll(/aria-controls="([^"]+)"/g), function (match) {
            return match[1];
        });

        expect(panelIds).toEqual([
            'ap-win-dashboard',
            'ap-win-staff',
            'ap-win-templates',
            'ap-win-history',
            'ap-win-parents',
            'ap-win-shared-portal',
            'ap-win-comm',
            'ap-win-backup'
        ]);
        expect(controlledIds).toEqual(panelIds);
        expect(menu.match(/<button\b/g)).toHaveLength(8);
        expect(menu.match(/role="tab"/g)).toHaveLength(8);

        panelIds.forEach(function (panelId) {
            expect(html).toContain('id="' + panelId + '"');
            expect(menu).toContain("window.apSwitchTab('" + panelId + "', this)");
        });
    });

    it('registers the admin sub-navigation as a configurable module menu', function () {
        const src = read('sys-layout-builder.js');
        const defaultMatch = src.match(/'admin-panel'\s*:\s*\{\s*order\s*:\s*\[([^\]]+)\]\s*,\s*hidden\s*:\s*\[\]/);

        expect(defaultMatch, 'admin panel default layout must exist').not.toBeNull();
        expect(quotedValues(defaultMatch[1])).toEqual([
            'ap-win-dashboard',
            'ap-win-staff',
            'ap-win-templates',
            'ap-win-history',
            'ap-win-parents',
            'ap-win-shared-portal',
            'ap-win-comm',
            'ap-win-backup'
        ]);
        expect(src).toMatch(/'admin-panel'\s*:\s*'#ap-ribbon-menu'/);
        expect(src).toContain("adminLayout.order.indexOf('ap-win-dashboard') < 0");
        expect(src).toContain("adminLayout.order.unshift('ap-win-dashboard')");
    });

    it('safely adds the dashboard to an older saved admin-panel layout', function () {
        const oldOrder = [
            'ap-win-staff',
            'ap-win-templates',
            'ap-win-history',
            'ap-win-parents',
            'ap-win-shared-portal',
            'ap-win-comm',
            'ap-win-backup'
        ];
        const layout = loadLayoutBuilder({
            modules: { 'admin-panel': { order: oldOrder, hidden: [] } }
        });
        const config = layout.sysLayoutGetConfig();

        expect(Array.from(config.modules['admin-panel'].order)).toEqual(['ap-win-dashboard', ...oldOrder]);
        expect(config.modules['admin-panel'].hidden).not.toContain('ap-win-dashboard');
    });

    it('connects the dashboard markup to real admin-panel calculations', function () {
        const html = read('index.html');
        const admin = read('admin-panel.js');

        [
            'ap-dash-staff-total',
            'ap-dash-teacher-total',
            'ap-dash-parent-active',
            'ap-dash-module-coverage',
            'ap-dash-recent-history',
            'ap-dashboard-sync-status'
        ].forEach(function (id) {
            expect(html).toContain('id="' + id + '"');
        });
        expect(admin).toContain('function apBuildDashboardSnapshot(nowMs)');
        expect(admin).toContain('window.apBuildDashboardSnapshot = apBuildDashboardSnapshot');
        expect(admin).toContain('window.apRenderDashboard = function (options)');
        expect(admin).toContain("'ap-win-dashboard', 'ap-win-staff'");
        expect(admin).toContain("panelId === 'ap-win-dashboard'");
    });

    it('calculates dashboard totals from registered people and saved permissions', function () {
        const soon = new Date(Date.now() + 3 * 86400000).toISOString();
        const users = [
            { id: 'T-1', type: 'teacher', name: 'استاد اوّل' },
            { id: 'S-1', type: 'staff', name: 'عملہ اوّل' },
            { id: 'S-2', type: 'staff', name: 'عملہ دوم' },
            { id: 'STU-1', type: 'student', name: 'طالب علم' }
        ];
        const staffPerms = {
            'T-1': {
                status: 'active',
                modules: { attendance: true },
                actions: {},
                temporary: { 'attendance.view': { expiry: soon } },
                history: [{ type: 'modules_changed', detail: 'حاضری دی گئی', by: 'مالک', at: new Date().toISOString() }]
            },
            'S-1': { status: 'disabled', modules: { dashboard: true }, actions: {}, temporary: {}, history: [] },
            'S-2': { status: 'active', modules: {}, actions: {}, temporary: {}, history: [] }
        };
        const parentPerms = {
            'STU-1': { status: 'active', views: { attendance: true }, temporary: {}, history: [] }
        };
        const panel = loadAdminPanelForSnapshot({
            ems_full_users: JSON.stringify(users),
            ems_staff_permissions: JSON.stringify(staffPerms),
            ems_parent_permissions: JSON.stringify(parentPerms)
        });

        const snapshot = panel.apBuildDashboardSnapshot();
        expect(snapshot.total).toBe(3);
        expect(snapshot.teachers).toBe(1);
        expect(snapshot.otherStaff).toBe(2);
        expect(snapshot.active).toBe(2);
        expect(snapshot.disabled).toBe(1);
        expect(snapshot.withoutAccess).toBe(1);
        expect(snapshot.activeTemporary).toBe(1);
        expect(snapshot.expiringSoon).toBe(1);
        expect(snapshot.parentActive).toBe(1);
        expect(snapshot.attention).toBe(3);
        expect(snapshot.healthPercent).toBe(33);
        expect(snapshot.coverage.find(function (item) { return item.id === 'attendance'; }).allowed).toBe(1);
        expect(snapshot.recentHistory[0].staff).toBe('استاد اوّل');
    });

    it('keeps the permission catalogue in the same relative order as the real main ribbon', function () {
        const html = read('index.html');
        const admin = read('admin-panel.js');

        const ribbonMatch = html.match(/<div class="ribbon-tabs">([\s\S]*?)<\/div>/);
        const catalogueMatch = admin.match(/window\.ADMIN_STAFF_MODULES\s*=\s*\[([\s\S]*?)\n\s*\];/);
        expect(ribbonMatch, 'main software ribbon must exist').not.toBeNull();
        expect(catalogueMatch, 'permission module catalogue must exist').not.toBeNull();

        const mainRibbonIds = Array.from(ribbonMatch[1].matchAll(/id="tab-([^"]+)"/g), function (match) {
            return match[1];
        });
        const permissionIds = Array.from(catalogueMatch[1].matchAll(/\bid\s*:\s*'([^']+)'/g), function (match) {
            return match[1];
        });
        const comparableMainOrder = mainRibbonIds.filter(function (id) {
            return permissionIds.includes(id);
        });

        expect(permissionIds).toEqual(comparableMainOrder);
        expect(new Set(permissionIds).size).toBe(permissionIds.length);
        expect(admin).toContain("document.querySelectorAll('.ribbon-tabs > .ribbon-tab[id^=\"tab-\"]')");
        expect(admin).toContain('window.apGetOrderedStaffModules = apGetOrderedStaffModules');
    });
});
