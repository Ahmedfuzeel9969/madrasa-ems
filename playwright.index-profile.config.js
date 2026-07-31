const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: 'ems-index-build-profile.spec.js',
    timeout: 7200000,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4179',
        headless: true,
        actionTimeout: 120000,
        navigationTimeout: 120000
    },
    webServer: {
        command: 'npx servor . bench/index-build-profile.html 4179',
        port: 4179,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
