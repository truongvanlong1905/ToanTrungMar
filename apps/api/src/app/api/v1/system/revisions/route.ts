import { jsonSuccess } from '../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../core/permissions';
import { getDomainRevisionsSnapshot } from '../../../../../core/cache/server-data-cache';
import { countUnreadNotificationsFast } from '../../../../../core/notifications/service';

export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  const [snapshot, unreadCount] = await Promise.all([
    Promise.resolve(getDomainRevisionsSnapshot()),
    countUnreadNotificationsFast(auth.user.id, auth.user.roleCode),
  ]);

  return jsonSuccess({
    ...snapshot,
    unreadCount,
    userId: auth.user.id,
    roleCode: auth.user.roleCode,
  });
}
