const ROUTE_STATE_PREFIX = 'tt_route_state_v1:';
const ROUTE_STATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

let activeRouteUserScope = 'anon';

export function clearAllRouteState(): void {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(ROUTE_STATE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      window.sessionStorage.removeItem(k);
    }
  } catch {
    // ignore storage access issues
  }
}

export function setRouteStateUserScope(userScopeKey: string | null): void {
  const normalized = userScopeKey?.trim() || 'anon';
  if (normalized === 'anon' || (activeRouteUserScope !== 'anon' && normalized !== activeRouteUserScope)) {
    clearAllRouteState();
  }
  activeRouteUserScope = normalized;
}

function buildRouteStorageKey(routeKey: string): string {
  return `${ROUTE_STATE_PREFIX}${activeRouteUserScope}:${routeKey}`;
}

export function saveRouteState<T>(routeKey: string, state: T): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = {
      v: 1,
      scope: activeRouteUserScope,
      savedAt: Date.now(),
      data: state,
    };
    window.sessionStorage.setItem(buildRouteStorageKey(routeKey), JSON.stringify(payload));
  } catch {
    // ignore quota/private-mode errors
  }
}

export function loadRouteState<T>(routeKey: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(buildRouteStorageKey(routeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      v?: number;
      scope?: string;
      savedAt?: number;
      data?: T;
    };
    if (
      !parsed ||
      parsed.v !== 1 ||
      parsed.scope !== activeRouteUserScope ||
      typeof parsed.savedAt !== 'number' ||
      Date.now() - parsed.savedAt > ROUTE_STATE_MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(buildRouteStorageKey(routeKey));
      return null;
    }
    return parsed.data ?? null;
  } catch {
    return null;
  }
}
