import { mapSupabaseUser } from '../src/utils/mappings';
import {
  getEffectiveRole, getModelReleaseSignerRole, getTalentTableForRole,
  isAdminUser, isProviderUser, resolveUserRole, roleRequiresKyc,
} from '../src/utils/userRole';
import { UserRole } from '../src/types';

describe('server-authoritative admin navigation capability', () => {
  it.each<UserRole>(['client', 'photographer', 'model'])('routes an allowlisted %s to admin without changing their business role', role => {
    const user = mapSupabaseUser({ id: 'owner', is_admin: true }, role, { role });
    expect(user.role).toBe(role);
    expect(isAdminUser(user)).toBe(true);
    expect(getEffectiveRole(user)).toBe('admin');
    expect(resolveUserRole(user)).toBe(role);
    expect(isProviderUser(user)).toBe(role !== 'client');
    expect(roleRequiresKyc(user)).toBe(role !== 'client');
    if (role === 'model') {
      expect(getTalentTableForRole(user)).toBe('models');
      expect(getModelReleaseSignerRole(user)).toBe('model');
    }
    if (role === 'photographer') expect(getModelReleaseSignerRole(user)).toBe('creator');
  });

  it.each([undefined, false, 'true', 1, null])('fails closed for missing or non-boolean capability %s', is_admin => {
    const user = mapSupabaseUser({ id: 'attacker', is_admin, user_metadata: { role: 'admin', is_admin: true } }, 'admin', { role: 'admin' });
    expect(user.is_admin).toBe(false);
    expect(user.role).toBe('client');
    expect(getEffectiveRole(user)).toBe('client');
  });

  it('does not accept profile capability or a bare admin role as authorization', () => {
    const user = mapSupabaseUser({ id: 'attacker' }, 'client', { role: 'client', is_admin: true } as any);
    expect(isAdminUser(user)).toBe(false);
    expect(getEffectiveRole({ role: 'admin' })).toBe('client');
    expect(getEffectiveRole('admin')).toBe('client');
    expect(resolveUserRole(null, 'admin')).toBe('client');
  });

  it.each<UserRole>(['client', 'photographer', 'model'])('leaves ordinary %s routing unchanged', role => {
    const user = mapSupabaseUser({ id: 'ordinary', is_admin: false }, role, { role });
    expect(getEffectiveRole(user)).toBe(role);
  });

  it('revokes admin navigation on a newer server response without demoting the creator', () => {
    const user = mapSupabaseUser({ id: 'owner', is_admin: false }, 'model', { role: 'model' });
    expect(user.role).toBe('model');
    expect(getEffectiveRole(user)).toBe('model');
    expect(isAdminUser(user)).toBe(false);
  });
});
