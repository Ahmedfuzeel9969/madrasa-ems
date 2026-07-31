const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.js'],
        coverage: {
            reporter: ['text', 'lcov'],
            include: ['ems-utils.js']
        }
    }
});
