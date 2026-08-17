export default {
    testEnvironment: 'node',
    transform: {},
    setupFiles: ['<rootDir>/scripts/jest-setup.mjs'],
    testMatch: [
        '<rootDir>/src/**/*.test.js',
        '<rootDir>/tests/**/*.test.js',
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '\\.node\\.test\\.js$',
    ],
};
