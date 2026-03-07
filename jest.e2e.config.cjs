const baseConfig = require('./jest.config.cjs');

module.exports = {
  ...baseConfig,
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  testMatch: ['**/__tests__/e2e/**/*.e2e.test.[jt]s?(x)'],
  setupFilesAfterEnv: [], // Remove RN mocks from node E2E tests
  testEnvironment: 'node', // Use Node environment for network requests in E2E
  preset: undefined,
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
};
