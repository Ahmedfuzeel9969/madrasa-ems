const { defineConfig } = require('@playwright/test');

/** Production dist harness — excludes P5B soak/bench and dedicated bench-port suites. */
const DIST_EXCLUDE = [
    '**/ems-idb-scale-bench.spec.js',
    '**/ems-index-build-profile.spec.js',
    '**/ems-long-session-soak.spec.js',
    '**/ems-multi-device-sync.spec.js',
    '**/ems-offline-crud-reconnect.spec.js',
    '**/ems-rbac-matrix.spec.js',
    '**/ems-outbox-multitab.spec.js',
    '**/ems-sync-cursor-multitab.spec.js',
    '**/ems-sw-update.spec.js'
];

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testIgnore: DIST_EXCLUDE,
    timeout: 90000,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        headless: true
    },
    webServer: {
        command: 'npx servor dist index.html 4173',
        port: 4173,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
