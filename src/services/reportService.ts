import { backendDb } from './backendGateway';
import { requireCurrentAuthenticatedUser } from '../config/currentUser';
import { environment } from '../config/environment';
import { apiClient } from '../config/apiClient';
import { getApiAccessToken } from '../config/apiSession';

export type ReportTargetType = 'post' | 'profile' | 'booking' | 'message';

export interface ReportPayload {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details?: string;
}

/** Report a piece of content or a user to the admin team */
export const reportContent = async (payload: ReportPayload): Promise<void> => {
  const user = await requireCurrentAuthenticatedUser();
  if (environment.backendProvider === 'api') {
    await apiClient.post('/moderation/reports', {
      target_type: payload.targetType,
      target_id: payload.targetId,
      reason: payload.reason,
      details: payload.details ?? '',
    }, { token: await getApiAccessToken() });
    return;
  }

  const severity =
    /harass|abuse|threat|minor|violence|illegal/i.test(payload.reason) ? 4 :
    /fake|spam|scam/i.test(payload.reason) ? 3 : 2;
  const slaDueAt = new Date(Date.now() + (severity >= 4 ? 6 : 24) * 60 * 60 * 1000).toISOString();

  const { error } = await backendDb.from('reports').insert({
    created_by: user.id,
    target_type: payload.targetType,
    target_id: payload.targetId,
    reason: payload.reason,
    details: payload.details ?? null,
    status: 'open',
  });

  if (error) throw new Error(error.message || 'Failed to submit report.');

  // Best-effort mirror into moderation queue with SLA.
    await backendDb.from('moderation_cases').insert({
    reporter_id: user.id,
    target_type: payload.targetType,
    target_id: payload.targetId,
    reason: payload.reason,
    severity,
    status: 'open',
    sla_due_at: slaDueAt,
  });
};
