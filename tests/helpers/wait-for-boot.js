// @ts-check
/** Shared Playwright waits for lazy cloud loader + post-auth boot on dist/root shells. */

async function waitForCloudStack(page, timeoutMs) {
    timeoutMs = timeoutMs || 90000;
    await page.waitForFunction(function () {
        return typeof window.emsLoadCloudStack === 'function'
            && typeof window.EmsCloudManifest === 'object';
    }, null, { timeout: timeoutMs });
    await page.evaluate(function () {
        window.EMS_OFFLINE_ONLY = false;
        return window.emsLoadCloudStack();
    });
    await page.waitForFunction(function () {
        return typeof window.emsRunIdentityGate === 'function'
            && typeof window.emsIsIdentityVerified === 'function';
    }, null, { timeout: timeoutMs });
}

async function waitForLazyModule(page, modId, timeoutMs) {
    timeoutMs = timeoutMs || 90000;
    await page.evaluate(function (id) {
        if (typeof window.emsLazyLoadModule === 'function') {
            return window.emsLazyLoadModule(id);
        }
        return Promise.resolve({ skipped: true });
    }, modId);
    if (modId === 'superadmin') {
        await page.waitForFunction(function () {
            return typeof window.saInitNavigation === 'function'
                && typeof window.initSuperAdminPanel === 'function';
        }, null, { timeout: timeoutMs });
    }
}

async function waitForPostAuthRepo(page, timeoutMs) {
    timeoutMs = timeoutMs || 90000;
    await page.evaluate(function () {
        if (typeof window.emsEnsurePostAuthScripts === 'function') {
            return window.emsEnsurePostAuthScripts();
        }
        return Promise.resolve();
    });
    await page.waitForFunction(function () {
        return window.emsRepo
            && typeof window.emsRepo.page === 'function'
            && (typeof window.emsRegRepoUpsert === 'function'
                || typeof window.emsRegRepoInit === 'function');
    }, null, { timeout: timeoutMs });
}

async function gotoAndBoot(page, url) {
    await page.addInitScript(function () {
        window.EMS_OFFLINE_ONLY = false;
    });
    await page.goto(url || '/index.html');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(function () {
        return typeof window.emsRepo === 'object'
            && typeof window.emsLoadCloudStack === 'function';
    }, null, { timeout: 60000 });
    await waitForCloudStack(page);
    await waitForPostAuthRepo(page);
}

async function waitForLandingReady(page, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    await page.waitForFunction(function () {
        return !document.documentElement.classList.contains('ems-booting');
    }, null, { timeout: timeoutMs });
    await page.waitForFunction(function () {
        return document.querySelectorAll('.ems-portal-card').length >= 5;
    }, null, { timeout: timeoutMs });
}

async function activateAdmissionModule(page) {
    await page.evaluate(function () {
        window.emsIsAdmissionModuleActive = function () { return true; };
        var mod = document.getElementById('module-admission');
        if (mod) mod.classList.add('active');
    });
}

async function renderRegTableAndWait(page, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    await activateAdmissionModule(page);
    await page.evaluate(function () {
        return window.renderRegTableViaRepo();
    });
    await page.waitForFunction(function () {
        var tbody = document.querySelector('#reg-users-table tbody');
        if (!tbody) return false;
        var trs = tbody.querySelectorAll('tr');
        if (!trs.length) return false;
        var first = trs[0];
        if (first.querySelector('td[colspan]')) {
            var txt = (first.textContent || '').trim();
            if (/لوڈ|loading/i.test(txt)) return false;
            if (/کوئی ریکارڈ نہیں/.test(txt)) return true;
        }
        return true;
    }, null, { timeout: timeoutMs });
}

module.exports = {
    waitForCloudStack: waitForCloudStack,
    waitForLazyModule: waitForLazyModule,
    waitForPostAuthRepo: waitForPostAuthRepo,
    gotoAndBoot: gotoAndBoot,
    waitForLandingReady: waitForLandingReady,
    activateAdmissionModule: activateAdmissionModule,
    renderRegTableAndWait: renderRegTableAndWait
};
