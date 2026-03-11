import '@testing-library/jest-native/extend-expect';
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

// FIX: capture the REAL console.warn BEFORE jest.spyOn replaces it
// so we don't call the mock from within the mock (infinite recursion)
const _realWarn = console.warn.bind(console);
jest.spyOn(console, 'warn').mockImplementation((...args) => {
  const msg = String(args[0] ?? '');
  if (
    msg.includes('Animated:') ||
    msg.includes('Reanimated') ||
    msg.includes('componentWillReceiveProps')
  ) return;
  _realWarn(...args);
});
