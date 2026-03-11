module.exports = {
  preset: 'jest-expo',
  // FIX: Remove manual ts-jest override — jest-expo's preset already handles
  // TypeScript + JSX via babel-jest. Manual ts-jest override breaks JSX in .tsx tests.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '<rootDir>/__tests__/e2e/',
    '<rootDir>/__tests__/hasura/',
    '<rootDir>/__tests__/hasura.e2e.test.ts', // FIX: skip standalone hasura e2e test in CI
  ],
  testTimeout: 20000,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
};
