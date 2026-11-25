export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return;
    }
    if (process.env.NODE_ENV === 'production') {
      const { validateRuntimeSecrets } = await import('../../api/src/core/config');
      validateRuntimeSecrets();
    }
    const [
      { ensureGoogleOAuthKeepAliveStarted },
      { ensureGmailAutoSyncPollerStarted },
      { ensureTrackingBackgroundSchedulerStarted },
      { ensureM02M04BackgroundWarmerStarted },
      { ensureInternalWorkersSchedulerStarted },
    ] = await Promise.all([
      import('../../api/src/modules/02-tracking-sync/google-oauth.service'),
      import('../../api/src/modules/01-leads/gmail-sync.service'),
      import('../../api/src/modules/02-tracking-sync/service'),
      import('../../api/src/modules/02-tracking-sync/ga4-live-cache.service'),
      import('../../api/src/workers'),
    ]);
    ensureGoogleOAuthKeepAliveStarted();
    ensureGmailAutoSyncPollerStarted();
    ensureTrackingBackgroundSchedulerStarted();
    ensureM02M04BackgroundWarmerStarted();
    ensureInternalWorkersSchedulerStarted();
  }
}

