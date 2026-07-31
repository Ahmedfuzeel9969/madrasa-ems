const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: [
        'ems-rbac-matrix.spec.js',
        'ems-long-session-soak.spec.js'
    ],
    timeout: 3900000,
    use: {
        baseURL: 'http://127.0.0.1:4180',
        headless: true
    },
    webServer: {
        command: 'npx servor . index.html 4180',
        port: 4180,
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
