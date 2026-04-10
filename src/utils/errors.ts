/**
 * Error formatting and logging helpers
 */

const toErrorShape = (err: unknown): Record<string, unknown> =>
  err && typeof err === 'object' ? (err as Record<string, unknown>) : {};

export function formatAuthError(err: unknown, fallback = 'Authentication failed.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  const shape = toErrorShape(err);
  // Supabase may return { message } or { error_description }
  if (shape.message) return String(shape.message);
  if (shape.error_description) return String(shape.error_description);
  if (shape.error) return String(shape.error);
  return fallback;
}

export function formatErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  const shape = toErrorShape(err);
  if (shape.message) return String(shape.message);
  if (shape.error) return String(shape.error);
  if (shape.status && shape.statusText) return `${shape.status} ${shape.statusText}`;
  return fallback;
}

export function logError(context: string, err: unknown): void {
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  try {
    const shape = toErrorShape(err);
    const message = String(shape.stack || shape.message || err);
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
