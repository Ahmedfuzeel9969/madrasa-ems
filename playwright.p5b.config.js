const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: [
        'ems-multi-device-sync.spec.js',
        'ems-offline-crud-reconnect.spec.js'
    ],
    timeout: 180000,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4178',
        headless: true
    },
    webServer: {
        command: 'npx servor . bench/sync-bench.html 4178',
        port: 4178,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
