import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { sessionStorage } from '../../src/services/sessionStorage';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const KEY = 'papziApiSession';
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

describe('session persistence', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it.each(['ios', 'android'] as const)('writes native sessions only to SecureStore on %s', async os => {
    jest.replaceProperty(Platform, 'OS', os);
    await sessionStorage.setItem('session');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(KEY, 'session', OPTIONS);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
  });

  it('prefers the secure value and removes a leftover plaintext session', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('secured');
    expect(await sessionStorage.getItem()).toBe('secured');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(KEY, OPTIONS);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
  });

  it('removes legacy storage only after migration succeeds', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('legacy');
    let finish!: () => void;
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(() => {
      started();
      return new Promise<void>(resolve => { finish = resolve; });
    });
    const reading = sessionStorage.getItem();
    await writing;
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    finish();
    expect(await reading).toBe('legacy');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(KEY, 'legacy', OPTIONS);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
  });

  it('retains legacy data when migration fails and reports the failure', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('legacy');
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('unavailable'));
    await expect(sessionStorage.getItem()).rejects.toThrow('unavailable');
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('does not fall back to plaintext when secure reads or writes fail', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('locked'));
    await expect(sessionStorage.getItem()).rejects.toThrow('locked');
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('full'));
    await expect(sessionStorage.setItem('new')).rejects.toThrow('full');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('attempts both native and legacy deletion and surfaces failures', async () => {
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('delete failed'));
    await expect(sessionStorage.removeItem()).rejects.toThrow('delete failed');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(KEY, OPTIONS);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    await expect(sessionStorage.removeItem()).resolves.toBeUndefined();
  });

  it('keeps sign-out deletion behind a pending native write', async () => {
    let finish!: () => void;
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(() => {
      started();
      return new Promise<void>(resolve => { finish = resolve; });
    });
    const saving = sessionStorage.setItem('new');
    const clearing = sessionStorage.removeItem();
    await writing;
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    finish();
    await Promise.all([saving, clearing]);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps migration behind reads and ahead of sign-out deletion', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('legacy');
    let finish!: () => void;
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(() => {
      started();
      return new Promise<void>(resolve => { finish = resolve; });
    });
    const reading = sessionStorage.getItem();
    const clearing = sessionStorage.removeItem();
    await writing;
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    finish();
    await Promise.all([reading, clearing]);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('preserves browser storage without invoking native APIs', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('browser');
    expect(await sessionStorage.getItem()).toBe('browser');
    await sessionStorage.setItem('next');
    await sessionStorage.removeItem();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(KEY, 'next');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});
