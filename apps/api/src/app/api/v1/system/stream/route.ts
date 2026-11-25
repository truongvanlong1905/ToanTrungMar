import { requireAuthenticatedSession } from '../../../../../core/permissions';
import {
  getDomainRevisionsSnapshot,
  subscribeDomainRevisionStream,
} from '../../../../../core/cache/server-data-cache';
import { countUnreadNotificationsFast } from '../../../../../core/notifications/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  const encoder = new TextEncoder();
  let cleanupFn: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const sendEvent = (eventName: string, data: unknown) => {
        safeEnqueue(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const [snapshot, unreadCount] = await Promise.all([
          Promise.resolve(getDomainRevisionsSnapshot()),
          countUnreadNotificationsFast(auth.user.id, auth.user.roleCode).catch(() => 0),
        ]);
        sendEvent('snapshot', {
          ...snapshot,
          unreadCount,
          userId: auth.user.id,
          roleCode: auth.user.roleCode,
        });
      } catch {
        // Ignore initial snapshot error; stream stays open for live events
      }

      const unsubscribe = subscribeDomainRevisionStream((ev) => {
        if (closed) return;
        void (async () => {
          let unreadCount: number | undefined;
          if (ev.domains.includes('notifications') || ev.domains.includes('leads')) {
            unreadCount = await countUnreadNotificationsFast(
              auth.user.id,
              auth.user.roleCode,
            ).catch(() => undefined);
          }
          sendEvent('revision', {
            ...ev,
            ...(typeof unreadCount === 'number' ? { unreadCount } : {}),
          });
        })();
      });

      const keepAliveTimer = setInterval(() => {
        safeEnqueue(`: keepalive ${Date.now()}\n\n`);
      }, 20_000);
      if (typeof keepAliveTimer.unref === 'function') {
        keepAliveTimer.unref();
      }

      cleanupFn = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAliveTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      if (req.signal) {
        if (req.signal.aborted) {
          cleanupFn();
        } else {
          req.signal.addEventListener('abort', () => {
            cleanupFn?.();
          });
        }
      }
    },
    cancel() {
      cleanupFn?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
