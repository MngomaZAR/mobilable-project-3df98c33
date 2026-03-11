import '@testing-library/jest-native/extend-expect';
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Mock React Native Reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

// Silence default console warnings during tests
jest.spyOn(console, 'warn').mockImplementation((...args) => {
  const msg = args[0] || '';
  if (
    msg.includes('Animated:') ||
    msg.includes('Reanimated') ||
    msg.includes('componentWillReceiveProps')
  ) {
    return;
  }
  console.warn(...args);
});
