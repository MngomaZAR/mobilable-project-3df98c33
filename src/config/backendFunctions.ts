import { supabase, supabaseFunctionUrl, supabasePublishableKey } from './supabaseClient';
import { hasNhost, nhost } from './nhostClient';

export type BackendFunctionResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

const normalizePath = (name: string) => (name.startsWith('/') ? name : `/${name}`);

const parseFunctionMessage = (body: unknown, fallback: string) => {
  if (!body) return fallback;
  if (typeof body === 'string') return body || fallback;
  if (typeof body === 'object') {
    const shape = body as Record<string, unknown>;
    if (shape.message) return String(shape.message);
    if (shape.error) return String(shape.error);
    if (shape.error_description) return String(shape.error_description);
  }
  return fallback;
};

const readResponseBody = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

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

  if (!supabaseFunctionUrl || !supabasePublishableKey) {
    return { data: null, error: { message: 'Backend is not configured for this build.' } };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? supabasePublishableKey;
  const response = await fetch(`${supabaseFunctionUrl}${normalizePath(name)}`, {
    method: 'POST',
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-client-info': 'papzi-app',
    },
    body: JSON.stringify(body ?? {}),
  });
  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    return {
      data: null,
      error: {
        message: parseFunctionMessage(responseBody, `Function ${name} failed (${response.status}).`),
      },
    };
  }
  return { data: (responseBody as T) ?? null, error: null };
};
