import { useEffect, useState } from 'react';
import { apiClient } from '../config/apiClient';
import { getApiSession, getCachedApiSession } from '../config/apiSession';
import { isServiceRestricted, recordServiceAccess, ServiceFeature } from '../config/betaPolicy';
import { environment } from '../config/environment';
import { useAppData } from '../store/AppDataContext';

type Access = { user_id: string; expires_at: string; permissions: Record<ServiceFeature, boolean>; controlled_test: boolean; payment_limit_zar: string | null };

export const useServiceAccess = () => {
  const { state } = useAppData();
  const userId = state.currentUser?.id;
  const [result, setResult] = useState<(Access & { token: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (environment.backendProvider !== 'api' || !userId) { setResult(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      setLoading(true);
      try {
        const session = await getApiSession();
        if (cancelled || session?.user?.id !== userId || !session.access_token) return;
        const next = await apiClient.get<Access>('/auth/service-access', { token: session.access_token, timeoutMs: 10000 });
        if (cancelled || next.user_id !== userId || getCachedApiSession()?.access_token !== session.access_token) return;
        if (!next.permissions || !['checkout', 'payouts', 'video', 'dispatch'].every(key => typeof next.permissions[key as ServiceFeature] === 'boolean') ||
            !recordServiceAccess(session.access_token, next.expires_at, next.permissions)) throw new Error('Service access could not be verified.');
        setResult({ ...next, token: session.access_token });
        setError(null);
      } catch (failure) {
        if (!cancelled) { setResult(null); setError(failure instanceof Error ? failure.message : 'Service access unavailable.'); }
      } finally {
        if (!cancelled) { setLoading(false); timer = setTimeout(load, 45000); }
      }
    };
    setResult(null);
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId, attempt]);
  const allowed = (feature: ServiceFeature) => environment.backendProvider !== 'api'
    ? !isServiceRestricted(feature)
    : !!(userId && result?.user_id === userId && result.token === getCachedApiSession()?.access_token &&
      Date.parse(result.expires_at) > Date.now() && result.permissions[feature] && !isServiceRestricted(feature, result.token));
  return { allowed, loading, error, retry: () => setAttempt(value => value + 1),
    controlledTest: !!(result && result.user_id === userId && result.controlled_test), paymentLimit: result?.payment_limit_zar };
};
