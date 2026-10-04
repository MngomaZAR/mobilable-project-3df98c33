export const publicDocuments = Object.freeze([
  { name: 'Privacy policy', url: 'https://papzii.co.za/privacy' },
  { name: 'Terms of service', url: 'https://papzii.co.za/terms' },
]);

// Availability is necessary, but does not establish legal accuracy or approval.
export async function checkPublicDocuments(fetcher = fetch) {
  const results = [];
  for (const document of publicDocuments) {
    try {
      const response = await fetcher(document.url, {
        headers: { Accept: 'text/html' },
        signal: AbortSignal.timeout(12000),
      });
      const destination = new URL(response.url || document.url);
      const expected = new URL(document.url);
      const contentType = response.headers.get('content-type') || '';
      const approvedDestination = destination.protocol === 'https:' &&
        destination.origin === expected.origin &&
        destination.pathname.replace(/\/$/, '') === expected.pathname;
      let reason;
      if (!response.ok) reason = `HTTP ${response.status}`;
      else if (!approvedDestination) reason = 'redirected away from the public document';
      else if (!contentType.toLowerCase().includes('text/html')) reason = 'not an HTML page';
      else if (!(await response.text()).trim()) reason = 'empty page';
      results.push({ ...document, ok: !reason, status: response.status, ...(reason ? { reason } : {}) });
    } catch {
      results.push({ ...document, ok: false, reason: 'unreachable or timed out' });
    }
  }
  return results;
}
