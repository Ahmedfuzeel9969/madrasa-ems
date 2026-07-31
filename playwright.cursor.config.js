const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: 'ems-sync-cursor-multitab.spec.js',
    timeout: 180000,
    use: {
        baseURL: 'http://127.0.0.1:4176',
        headless: true
    },
    webServer: {
        command: 'npx servor . bench/idb-scale-bench.html 4176',
        port: 4176,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
