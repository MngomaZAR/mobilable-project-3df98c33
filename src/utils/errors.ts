/**
 * Error formatting and logging for app/Supabase errors.
 */

export function logError(label: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (__DEV__) {
    console.warn(`[${label}]`, message, err);
  }
}

export function formatErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string') {
    return (err as any).message;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}

export function formatAuthError(err: unknown, fallback = 'Authentication failed.'): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string') {
    return (err as any).message;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}
