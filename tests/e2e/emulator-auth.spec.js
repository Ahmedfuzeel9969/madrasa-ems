// @ts-check
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('Identity gate mock auth flow', function () {
    test.beforeEach(async function ({ page }) {
        await page.addInitScript(function () { window.EMS_OFFLINE_ONLY = false; });
        await page.goto('/index.html');
        await boot.waitForLandingReady(page);
        await page.waitForFunction(function () {
            return typeof window.emsRunIdentityGate === 'function';
        }, null, { timeout: 90000 });
        await page.evaluate(function () {
            window.__EMS_E2E_SUPPRESS_LANDING__ = true;
            if (typeof window.emsShowLanding === 'function' && !window.__emsShowLandingOrig) {
                window.__emsShowLandingOrig = window.emsShowLanding;
                window.emsShowLanding = function () {
                    if (window.__EMS_E2E_SUPPRESS_LANDING__) return;
                    return window.__emsShowLandingOrig.apply(this, arguments);
                };
            }
        });
    });

    test('denies access when no portal selected', async function ({ page }) {
        var denied = await page.evaluate(function () {
            if (typeof window.emsClearIntendedPortal === 'function') {
                window.emsClearIntendedPortal();
            } else {
                sessionStorage.removeItem('ems_intended_portal');
                window.EMS_INTENDED_PORTAL = null;
            }
            window.emsRunIdentityGate(
                { uid: 'e2e-user-1', email: 'e2e@test.com' },
                { tenantId: 'tenant-1', role: 'staff' }
            );
            var panel = document.getElementById('ems-access-denied-panel');
            if (!panel) return { ok: false, reason: 'missing-panel' };
            return {
                ok: window.getComputedStyle(panel).display !== 'none',
                display: window.getComputedStyle(panel).display,
                portal: typeof window.emsGetIntendedPortal === 'function'
                    ? window.emsGetIntendedPortal()
                    : null,
                message: (document.getElementById('ems-access-denied-msg') || {}).textContent || ''
            };
        });
        expect(denied.ok, JSON.stringify(denied)).toBe(true);
        await expect(page.locator('#ems-access-denied-panel')).toBeVisible({ timeout: 5000 });
    });

    test('teacher with staff link shows access key panel', async function ({ page }) {
        await page.evaluate(function () {
            sessionStorage.setItem('ems_intended_portal', 'teacher');
            window.EMS_INTENDED_PORTAL = 'teacher';
            window.EMS_TENANT_SECURITY_POLICY = {
                requireAccessKey: true,
                requireTrustedDeviceForStaff: false
            };
            window.emsGetTenantSecurityPolicy = function () { return window.EMS_TENANT_SECURITY_POLICY; };
            window.emsEnsureTenantSecurityPolicy = function () {
                return Promise.resolve(window.EMS_TENANT_SECURITY_POLICY);
            };
            window.emsCheckTrustedDevice = function () { return Promise.resolve({ trusted: true }); };
            window.emsCheckMfaComplianceForPortal = function () { return Promise.resolve({ compliant: true }); };
            window.emsValidateEmailDomainForPortal = function () { return Promise.resolve({ allowed: true }); };
            window.emsValidateLoginCountryForPortal = function () { return Promise.resolve({ allowed: true }); };
            window.emsValidateLoginIpForPortal = function () { return Promise.resolve({ allowed: true }); };
            window.emsGetTeacherAccessKeyHash = function () {
                return Promise.resolve('mock-hash-value');
            };
            window.emsRunIdentityGate(
                { uid: 'e2e-teacher-1', email: 'teacher@test.com' },
                {
                    tenantId: 'tenant-1',
                    role: 'staff',
                    link: { staffId: 'STF001', status: 'active' }
                }
            );
        });
        await page.waitForFunction(function () {
            var p = document.getElementById('ems-access-key-panel');
            return p && window.getComputedStyle(p).display !== 'none';
        }, null, { timeout: 10000 });
        await expect(page.locator('#ems-access-key-input')).toBeAttached();
    });

    test('parent with link shows access key panel', async function ({ page }) {
        await page.evaluate(function () {
            sessionStorage.setItem('ems_intended_portal', 'parent');
            window.EMS_INTENDED_PORTAL = 'parent';
            window.EMS_TENANT_SECURITY_POLICY = {
                requireAccessKey: true,
                requireTrustedDeviceForParents: false
            };
            window.emsGetTenantSecurityPolicy = function () { return window.EMS_TENANT_SECURITY_POLICY; };
            window.emsEnsureTenantSecurityPolicy = function () {
                return Promise.resolve(window.EMS_TENANT_SECURITY_POLICY);
            };
            window.emsCheckTrustedDevice = function () { return Promise.resolve({ trusted: true }); };
            window.emsCheckMfaComplianceForPortal = function () { return Promise.resolve({ compliant: true }); };
            window.emsValidateEmailDomainForPortal = function () { return Promise.resolve({ allowed: true }); };
            window.emsValidateLoginCountryForPortal = function () { return Promise.resolve({ allowed: true }); };
            window.emsValidateLoginIpForPortal = function () { return Promise.resolve({ allowed: true }); };
            window.emsGetParentAccessKeyHashes = function () {
                return Promise.resolve(['mock-hash']);
            };
            window.emsRunIdentityGate(
                { uid: 'e2e-parent-1', email: 'parent@test.com' },
                {
                    tenantId: 'tenant-1',
                    role: 'parent',
                    link: { studentIds: ['STD001'], status: 'active' }
                }
            );
        });
        await page.waitForFunction(function () {
            var p = document.getElementById('ems-access-key-panel');
            return p && window.getComputedStyle(p).display !== 'none';
        }, null, { timeout: 10000 });
        await expect(page.locator('#ems-access-key-input')).toBeAttached();
    });

    test('tenant security policy module loaded', async function ({ page }) {
        var ok = await page.evaluate(function () {
            return typeof window.emsLoadTenantSecurityPolicy === 'function'
                && typeof window.EMS_DEFAULT_SECURITY_POLICY === 'object';
        });
        expect(ok).toBe(true);
    });
});
