// @ts-check
// Live integration: the saved-records registration table paginates through
// window.emsRepo.page('registrations', …) — not an in-memory slice.
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('Registration list — live emsRepo.page() pagination', function () {
    test('renders repo-backed rows, type filter, and search via the repository', async function ({ page }) {
        test.setTimeout(120000);
        await boot.gotoAndBoot(page, '/index.html');

        await page.waitForFunction(function () {
            return document.querySelector('#reg-users-table tbody');
        }, null, { timeout: 30000 });

        var hasRender = await page.evaluate(function () {
            return typeof window.renderRegTableViaRepo === 'function';
        });
        if (!hasRender) {
            await page.addScriptTag({ url: '/admission.js' });
            await page.waitForFunction(function () {
                return typeof window.renderRegTableViaRepo === 'function';
            }, null, { timeout: 10000 });
        }

        await page.evaluate(async function () {
            window.CURRENT_MADRASA_TENANT_ID = 't-e2e';
            window.emsRequireTenantId = function () { return 't-e2e'; };
            window.getAdmissionTenantId = function () { return 't-e2e'; };
            window._regListState = { page: 1, perPage: 25, q: '' };
            window.EMS_REG_USE_REPO_PAGE = true;
            window.emsRepo.useTenant('t-e2e');
            await window.emsRepo.clear('registrations');
            var rows = [];
            for (var i = 1; i <= 60; i++) {
                rows.push({
                    id: (i % 2 === 0 ? 'STD-' : 'TCH-') + i,
                    type: (i % 2 === 0) ? 'student' : 'teacher',
                    name: 'شخص ' + i,
                    cnic: '1234-' + i,
                    phone: '030' + i,
                    class: (i % 2 === 0) ? ('درجہ ' + (i % 5)) : '',
                    designation: (i % 2 === 0) ? '' : 'استاذ',
                    date: '2026-07-0' + (i % 9),
                    timestamp: i
                });
            }
            await window.emsRepo.bulkPut('registrations', rows);
            if (typeof window.emsIdbSearchIndexEnsure === 'function') {
                await window.emsIdbSearchIndexEnsure('t-e2e__registrations', { force: true });
            }
            window.__e2eRows = rows;
            window.emsRegRepoGetList = function () { return window.__e2eRows; };
            window.emsRegRepoClearSearch = function () { };
            window.dispatchEvent(new Event('ems:users-changed'));
        });

        function rowCount() {
            return page.$$eval('#reg-users-table tbody tr', function (trs) {
                return trs.filter(function (tr) { return !tr.querySelector('td[colspan]'); }).length;
            });
        }

        await boot.renderRegTableAndWait(page);
        expect(await page.evaluate(function () { return window.emsRepo.backendName(); })).toBe('indexeddb');
        expect(await rowCount()).toBe(60);
        expect(await page.textContent('#reg-list-count')).toContain('60');

        await page.evaluate(function () {
            var el = document.getElementById('reg-list-filter');
            if (el) el.value = 'student';
            window._regListState.q = '';
            return window.renderRegTableViaRepo();
        });
        await boot.renderRegTableAndWait(page);
        expect(await rowCount()).toBe(30);
        expect(await page.textContent('#reg-list-count')).toContain('30');

        await page.evaluate(function () {
            var el = document.getElementById('reg-list-filter');
            if (el) el.value = 'all';
            window._regListState.q = 'STD-60';
            return window.renderRegTableViaRepo();
        });
        await boot.renderRegTableAndWait(page);
        expect(await rowCount()).toBe(1);
        expect(await page.textContent('#reg-list-count')).toContain('1');
    });
});
