import { AppUser } from '../types';

type RoleLike = Pick<AppUser, 'role' | 'is_photographer' | 'is_model'> | null | undefined;

export const resolveUserRole = (
  user: RoleLike,
  fallback: AppUser['role'] = 'client'
): AppUser['role'] => {
  const explicitRole = user?.role;

  if (explicitRole && explicitRole !== 'client') {
    return explicitRole;
  }
  if (user?.is_model) {
    return 'model';
  }
  if (user?.is_photographer) {
    return 'photographer';
  }
  return explicitRole ?? fallback;
};

export const isModelUser = (user: RoleLike) => resolveUserRole(user) === 'model';
export const isPhotographerUser = (user: RoleLike) => resolveUserRole(user) === 'photographer';
export const isProviderUser = (user: RoleLike) => {
  const role = resolveUserRole(user);
  return role === 'model' || role === 'photographer';
};
