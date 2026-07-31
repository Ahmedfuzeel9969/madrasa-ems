const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    timeout: 120000,
    use: {
        baseURL: 'http://127.0.0.1:4174',
        headless: true
    },
    webServer: {
        command: 'npx servor . index.html 4174',
        port: 4174,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
