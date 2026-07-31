const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: 'ems-idb-scale-bench.spec.js',
    timeout: 10800000,
    use: {
        baseURL: 'http://127.0.0.1:4174',
        headless: true,
        actionTimeout: 120000,
        navigationTimeout: 120000
    },
    webServer: {
        command: 'npx servor . bench/idb-scale-bench.html 4174',
        port: 4174,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
