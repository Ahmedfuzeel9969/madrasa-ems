const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: 'ems-outbox-multitab.spec.js',
    timeout: 120000,
    use: {
        baseURL: 'http://127.0.0.1:4175',
        headless: true
    },
    webServer: {
        command: 'npx servor . bench/idb-scale-bench.html 4175',
        port: 4175,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
