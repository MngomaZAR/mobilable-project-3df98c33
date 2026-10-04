import { AppUser } from '../types';

type RoleLike = Pick<AppUser, 'role' | 'is_photographer' | 'is_model' | 'is_admin'> | null | undefined;
type ResolvableRole = RoleLike | AppUser['role'] | null | undefined;

export const resolveUserRole = (
  user: RoleLike,
  fallback: AppUser['role'] = 'client'
): AppUser['role'] => {
  // Admin is a server capability, never a business role supplied by metadata or a profile.
  const explicitRole = user?.role === 'admin' ? 'client' : user?.role;
  const safeFallback = fallback === 'admin' ? 'client' : fallback;

  if (explicitRole && explicitRole !== 'client') {
    return explicitRole;
  }
  if (user?.is_model) {
    return 'model';
  }
  if (user?.is_photographer) {
    return 'photographer';
  }
  return explicitRole ?? safeFallback;
};

export const resolveRoleValue = (input: ResolvableRole, fallback: AppUser['role'] = 'client') =>
  typeof input === 'string' ? (input === 'admin' ? 'client' : input) : resolveUserRole(input, fallback);

export const isAdminUser = (user: RoleLike) => user?.is_admin === true;

// Backward-compatible aliases used by older call sites and audit notes.
export const getEffectiveRole = (input: ResolvableRole, fallback: AppUser['role'] = 'client') =>
  typeof input !== 'string' && isAdminUser(input) ? 'admin' : resolveRoleValue(input, fallback);

export const isModelUser = (user: ResolvableRole) => resolveRoleValue(user) === 'model';
export const isPhotographerUser = (user: ResolvableRole) => resolveRoleValue(user) === 'photographer';
export const isEffectiveModel = isModelUser;
export const isEffectivePhotographer = isPhotographerUser;
export const isProviderUser = (user: ResolvableRole) => {
  const role = resolveRoleValue(user);
  return role === 'model' || role === 'photographer';
};

export const roleRequiresKyc = (input: ResolvableRole) => {
  const role = resolveRoleValue(input);
  return role === 'model' || role === 'photographer';
};

export const getTalentTableForRole = (input: ResolvableRole) =>
  resolveRoleValue(input) === 'model' ? 'models' : 'photographers';

export const getBookingTalentColumnForRole = (input: ResolvableRole) =>
  resolveRoleValue(input) === 'model' ? 'model_id' : 'photographer_id';

export const getModelReleaseSignerRole = (
  input: ResolvableRole
): 'creator' | 'client' | 'model' => {
  const role = resolveRoleValue(input);
  if (role === 'photographer') return 'creator';
  if (role === 'model') return 'model';
  return 'client';
};
