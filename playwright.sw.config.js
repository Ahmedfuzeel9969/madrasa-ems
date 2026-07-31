const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: 'ems-sw-update.spec.js',
    timeout: 60000,
    use: {
        baseURL: 'http://127.0.0.1:4177',
        headless: true
    },
    webServer: {
        command: 'npx servor . bench/sw-update-bench.html 4177',
        port: 4177,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
