import { AppState } from 'react-native';
import { startForegroundRefresh } from '../src/services/foregroundRefresh';

let stateListener: (state: string) => void;
const remove = jest.fn();
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const changeState = (state: string) => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: state });
  stateListener(state);
};

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback: any) => {
    stateListener = callback;
    return { remove };
  });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); remove.mockClear(); });

test('refreshes immediately, pauses in background and resumes immediately', async () => {
  const refresh = jest.fn(async () => {});
  const stop = startForegroundRefresh(refresh, jest.fn());
  await flush();
  expect(refresh).toHaveBeenCalledTimes(1);
  changeState('background');
  jest.advanceTimersByTime(30000);
  expect(refresh).toHaveBeenCalledTimes(1);
  changeState('active');
  await flush();
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
  jest.advanceTimersByTime(60000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('does not overlap slow requests or schedule work after disposal', async () => {
  let resolve!: () => void;
  const refresh = jest.fn(() => new Promise<void>(done => { resolve = done; }));
  const stop = startForegroundRefresh(refresh, jest.fn());
  changeState('background');
  changeState('active');
  jest.advanceTimersByTime(60000);
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
  resolve();
  await flush();
  expect(jest.getTimerCount()).toBe(0);
});

test('backs off failures and restores normal polling after recovery', async () => {
  const refresh = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const error = jest.fn();
  const stop = startForegroundRefresh(refresh, error);
  await flush();
  expect(error).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(19999);
  expect(refresh).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await flush();
  expect(refresh).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(10000);
  await flush();
  expect(refresh).toHaveBeenCalledTimes(3);
  stop();
});
