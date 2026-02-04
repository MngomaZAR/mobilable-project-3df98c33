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
  try {
    const message = (err as any)?.stack || (err as any)?.message || String(err);
    // eslint-disable-next-line no-console
    console.error(`[AppError] ${context}:`, message);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[AppError] failed to log error', e);
  }
}
