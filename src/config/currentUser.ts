import { hasNhost, getNhostSession, hydrateNhostSessionStorage, nhost } from './nhostClient';
import { hasSupabase, supabase } from './supabaseClient';

type CurrentUser = { id: string; email?: string | null } | null;

export const getCurrentAuthenticatedUser = async (): Promise<CurrentUser> => {
  if (hasNhost) {
    await hydrateNhostSessionStorage();
    const session = getNhostSession();
    if (session?.user?.id) {
      return { id: session.user.id, email: session.user.email ?? null };
    }

    try {
      const { body } = await nhost.auth.getUser();
      if (body?.id) return { id: body.id, email: body.email ?? null };
    } catch {
      return null;
    }
    return null;
  }

  if (!hasSupabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return null;
  return { id: data.user.id, email: data.user.email ?? null };
};

export const requireCurrentAuthenticatedUser = async () => {
  const user = await getCurrentAuthenticatedUser();
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user;
};
