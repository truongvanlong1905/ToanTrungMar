import { resolveSessionFromToken } from '../../../../../core/auth/service';
import { jsonSuccess } from '../../../../../core/http';
import {
  extractSessionTokenFromRequest,
  requireAuthenticatedSession,
} from '../../../../../core/permissions';

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('optional') === '1') {
    const resolved = await resolveSessionFromToken(extractSessionTokenFromRequest(req));
    return jsonSuccess({
      user: resolved?.user ?? null,
      authenticated: Boolean(resolved?.user),
    });
  }

  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  return jsonSuccess({ user: auth.user });
}

