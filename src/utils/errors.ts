/**
 * Error formatting and logging helpers
 */

export function formatAuthError(err: unknown, fallback = 'Authentication failed.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  // Supabase may return { message } or { error_description }
  if ((err as any)?.message) return String((err as any).message);
  if ((err as any)?.error_description) return String((err as any).error_description);
  if ((err as any)?.error) return String((err as any).error);
  return fallback;
}

export function formatErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if ((err as any)?.message) return String((err as any).message);
  if ((err as any)?.error) return String((err as any).error);
  if ((err as any)?.status && (err as any).statusText) return `${(err as any).status} ${(err as any).statusText}`;
  return fallback;
}

export function logError(context: string, err: unknown): void {
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  try {
    const message = (err as any)?.stack || (err as any)?.message || String(err);
    // Keep expected network/runtime issues visible without triggering redbox-style noise in development.
    if (isDev) {
      console.warn(`[AppError] ${context}:`, message);
      return;
    }
    console.error(`[AppError] ${context}:`, message);
  } catch (e) {
    console.warn('[AppError] failed to log error', e);
  }
}
