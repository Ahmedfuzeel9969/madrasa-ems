const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: 'ems-p6-preprod.spec.js',
    timeout: 7200000,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4181',
        headless: true,
        actionTimeout: 600000,
        navigationTimeout: 120000
    },
    webServer: {
        command: 'npx servor . index.html 4181',
        port: 4181,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
