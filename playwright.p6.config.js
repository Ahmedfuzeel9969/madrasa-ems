const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: 'ems-p6-soak.spec.js',
    timeout: 7200000,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4180',
        headless: true,
        actionTimeout: 300000,
        navigationTimeout: 120000
    },
    webServer: {
        command: 'npx servor . index.html 4180',
        port: 4180,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
