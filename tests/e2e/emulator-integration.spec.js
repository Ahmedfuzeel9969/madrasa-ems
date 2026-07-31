// @ts-check
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('Phase 7 policy enforcement + emulator seed', function () {
    test.beforeEach(async function ({ page }) {
        await page.addInitScript(function () { window.EMS_OFFLINE_ONLY = false; });
        await page.goto('/index.html');
        await boot.waitForCloudStack(page);
    });

    test('teacher skips access key when requireAccessKey is false', async function ({ page }) {
        await page.evaluate(function () {
            sessionStorage.setItem('ems_intended_portal', 'teacher');
            window.EMS_INTENDED_PORTAL = 'teacher';
            window.EMS_TENANT_SECURITY_POLICY = { requireAccessKey: false };
            window.EMS_TENANT_POLICY_TENANT = 'tenant-policy-off';
            window.emsEnsureTenantSecurityPolicy = function () {
                return Promise.resolve(window.EMS_TENANT_SECURITY_POLICY);
            };
            window.__teacherGateCompleted = false;
            window.emsAuthContinueAsTeacher = function () {
                window.__teacherGateCompleted = true;
            };
            window.emsRunIdentityGate(
                { uid: 'policy-off-teacher', email: 'teacher@test.com' },
                {
                    tenantId: 'tenant-policy-off',
                    role: 'staff',
                    link: { staffId: 'STF001', status: 'active' }
                }
            );
        });
        await page.waitForFunction(function () { return window.__teacherGateCompleted === true; });
        await expect(page.locator('#ems-access-key-panel')).toBeHidden();
    });

    test('parent skips access key when requireAccessKey is false', async function ({ page }) {
        await page.evaluate(function () {
            sessionStorage.setItem('ems_intended_portal', 'parent');
            window.EMS_INTENDED_PORTAL = 'parent';
            window.EMS_TENANT_SECURITY_POLICY = { requireAccessKey: false };
            window.emsEnsureTenantSecurityPolicy = function () {
                return Promise.resolve(window.EMS_TENANT_SECURITY_POLICY);
            };
            window.__parentGateCompleted = false;
            window.emsAuthContinueAsParent = function () {
                window.__parentGateCompleted = true;
            };
            window.emsRunIdentityGate(
                { uid: 'policy-off-parent', email: 'parent@test.com' },
                {
                    tenantId: 'tenant-policy-off',
                    role: 'parent',
                    link: { studentIds: ['STD001'], status: 'active' }
                }
            );
        });
        await page.waitForFunction(function () { return window.__parentGateCompleted === true; });
        await expect(page.locator('#ems-access-key-panel')).toBeHidden();
    });

    test('admin export security log function is wired in admin panel', async function ({ page }) {
        await boot.waitForLazyModule(page, 'admin-panel');
        var ok = await page.evaluate(function () {
            return typeof window.apExportSecurityLog === 'function'
                && typeof window.apLoadLoginSessions === 'function'
                && typeof window.apLoadNotificationAnalytics === 'function'
                && typeof window.emsRegisterLoginSession === 'function'
                && typeof window.emsGetDeviceId === 'function'
                && typeof window.apRetryAllFailedNotifications === 'function';
        });
        expect(ok).toBe(true);
    });
});

test.describe('Emulator Firestore seed verification', function () {
    test.skip(!process.env.RUN_EMULATOR_E2E, 'Set RUN_EMULATOR_E2E=1 with emulators running');

    test('seeded tenant security policy exists', async function () {
        process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
        var admin = require('../../functions/node_modules/firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({ projectId: 'demo-madrasa-ems' });
        }
        var db = admin.firestore();
        var snap = await db.collection('All_Madrasas').doc('emulator-tenant-1')
            .collection('TenantSettings').doc('securityPolicy').get();
        expect(snap.exists).toBe(true);
        expect(snap.data().notifyOwnerOnKeyExpiry).toBe(true);
        expect(snap.data().requireAccessKey).toBe(true);
    });
});
