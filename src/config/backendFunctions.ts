import { supabase } from './supabaseClient';
import { hasNhost, nhost } from './nhostClient';

export type BackendFunctionResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

const normalizePath = (name: string) => (name.startsWith('/') ? name : `/${name}`);

export const invokeBackendFunction = async <T = any>(
  name: string,
  body?: Record<string, any>
): Promise<BackendFunctionResult<T>> => {
  if (hasNhost) {
    const response = await nhost.functions.post<T>(normalizePath(name), body);
    if (response.status >= 300) {
      const message =
        typeof response.body === 'string'
          ? response.body
          : response.body && typeof response.body === 'object' && 'message' in response.body
            ? String((response.body as { message?: unknown }).message ?? `Function ${name} failed`)
            : `Function ${name} failed`;
      return { data: null, error: { message } };
    }
    return { data: response.body ?? null, error: null };
  }

  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    return { data: null, error: { message: error.message || `Function ${name} failed` } };
  }
  return { data: data ?? null, error: null };
};
