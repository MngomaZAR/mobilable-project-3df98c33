/**
 * Self-hosted crash reporting — stores error details in Supabase `crash_logs`.
 * No external accounts, no API keys needed.
 */
import { supabase } from '../config/supabaseClient';
import { Platform } from 'react-native';

const APP_VERSION = '1.0.0';

export const captureError = async (
  error: Error | unknown,
  context: { screen?: string; userId?: string; extra?: Record<string, any> } = {},
) => {
  const err = error instanceof Error ? error : new Error(String(error));
  try {
    await supabase.from('crash_logs').insert({
      user_id: context.userId ?? null,
      error_message: err.message ?? 'Unknown error',
      error_stack: err.stack ?? null,
      screen: context.screen ?? null,
      context: context.extra ?? {},
      platform: Platform.OS,
      app_version: APP_VERSION,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Must never throw — crash reporter cannot crash the app
  }
  // Also log locally in development
  if (__DEV__) {
    console.error('[CrashReport]', err.message, '\n', err.stack);
  }
};

/** Wrap an async function in a crash-safe try/catch */
export const withCrashReporting = <T>(
  fn: () => Promise<T>,
  context?: { screen?: string; userId?: string },
): Promise<T | undefined> => {
  return fn().catch((err) => {
    captureError(err, context ?? {});
    return undefined;
  });
};
