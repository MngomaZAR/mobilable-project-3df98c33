import { AppState } from 'react-native';

// API deployments do not expose the legacy database subscription transport.
export const startForegroundRefresh = (
  refresh: () => Promise<void>,
  onError: (error: unknown) => void,
  intervalMs = 10000,
) => {
  let disposed = false;
  let inFlight = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => AppState.currentState === 'active';
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const run = async () => {
    clearTimer();
    if (disposed || inFlight || !active()) return;
    inFlight = true;
    try {
      await refresh();
      failures = 0;
    } catch (error) {
      failures += 1;
      onError(error);
    } finally {
      inFlight = false;
      if (!disposed && active()) {
        timer = setTimeout(() => { void run(); }, Math.min(intervalMs * 2 ** failures, 60000));
      }
    }
  };
  const subscription = AppState.addEventListener('change', (state) => {
    clearTimer();
    if (state === 'active') void run();
  });
  void run();
  return () => {
    disposed = true;
    clearTimer();
    subscription.remove();
  };
};
