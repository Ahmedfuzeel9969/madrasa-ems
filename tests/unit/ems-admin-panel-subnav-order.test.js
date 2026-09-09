import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
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

describe('Admin Panel sub-navigation and permission catalogue order', function () {
    it('uses one seven-button accessible sub-navigation and has no legacy selector', function () {
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
            'ap-win-staff',
            'ap-win-templates',
            'ap-win-history',
            'ap-win-parents',
            'ap-win-shared-portal',
            'ap-win-comm',
            'ap-win-backup'
        ]);
        expect(controlledIds).toEqual(panelIds);
        expect(menu.match(/<button\b/g)).toHaveLength(7);
        expect(menu.match(/role="tab"/g)).toHaveLength(7);

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
            'ap-win-staff',
            'ap-win-templates',
            'ap-win-history',
            'ap-win-parents',
            'ap-win-shared-portal',
            'ap-win-comm',
            'ap-win-backup'
        ]);
        expect(src).toMatch(/'admin-panel'\s*:\s*'#ap-ribbon-menu'/);
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
