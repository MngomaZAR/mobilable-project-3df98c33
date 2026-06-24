import { environment } from './environment';
import { nhost } from './nhostClient';
import { apiClient, hasApiBackend } from './apiClient';
import { getApiAccessToken } from './apiSession';

const hasuraUrl = process.env.EXPO_PUBLIC_HASURA_URL;
const hasuraAnonKey = process.env.EXPO_PUBLIC_HASURA_ANON_KEY;

export const hasHasura = Boolean(hasuraUrl && hasuraAnonKey);

export async function hasuraGQL(query: string, variables?: Record<string, any>) {
  if (environment.backendProvider === 'api') {
    if (!hasApiBackend) throw new Error('Backend API is not configured');
    const token = await getApiAccessToken();
    const response = await apiClient.post<{ data?: any; errors?: Array<{ message?: string }> }>(
      '/graphql',
      { query, variables },
      { token }
    );
    if (response.errors?.length) {
      throw new Error(response.errors.map((e) => e.message ?? 'GraphQL error').join('; '));
    }
    return response.data ?? {};
  }

  if (environment.backendProvider === 'nhost') {
    const response = await nhost.graphql.request({ query, variables });
    if (response.body?.errors && response.body.errors.length > 0) {
      throw new Error(response.body.errors.map((e: any) => e.message).join('; '));
    }
    return response.body?.data ?? {};
  }

  if (!hasHasura) throw new Error('Hasura not configured');
  const res = await fetch(hasuraUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hasuraAnonKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hasura HTTP error: ${res.status} ${text}`);
  }

  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map((e: any) => e.message).join('; '));
  }

  return json.data;
}
