import { backendDb } from './backendGateway';
import { requireCurrentAuthenticatedUser } from '../config/currentUser';

export const requestAccountDeletion = async (reason: string = '') => {
  const user = await requireCurrentAuthenticatedUser();

  const { error } = await backendDb
    .from('account_deletion_requests')
    .insert({
      created_by: user.id,
      reason,
      status: 'open'
    });

  if (error) throw error;
  return true;
};
