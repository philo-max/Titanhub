/**
 * Retrieve the runtime API base URL.
 * Order of precedence:
 * 1. window.titanhubDesktop.apiBase or window.titanhubDesktop.getApiBase() (Electron IPC / Preload)
 * 2. URL search parameter (?apiBase=...)
 * 3. window.__TITANHUB_API_BASE__ (Global override)
 * 4. process.env.NEXT_PUBLIC_API_URL (Build-time fallback)
 * 5. Fallback 'http://127.0.0.1:3001'
 */
export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    // 1. Check window.titanhubDesktop bridge (synchronous string injected by Electron preload)
    const desktop = (window as any).titanhubDesktop;
    if (desktop && typeof desktop.apiBase === 'string' && desktop.apiBase.length > 0) {
      return desktop.apiBase;
    }

    // 2. Check URL search parameter
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const param = urlParams.get('apiBase');
      if (param) {
        sessionStorage.setItem('titanhub_api_base', param);
        return param;
      }
      const cached = sessionStorage.getItem('titanhub_api_base');
      if (cached) return cached;
    } catch {}

    // 3. Global override
    if ((window as any).__TITANHUB_API_BASE__) {
      return (window as any).__TITANHUB_API_BASE__;
    }
  }

  return process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
}

/**
 * Dynamic API_BASE constant that resolves getApiBase() whenever evaluated or stringified.
 */
export const API_BASE = {
  toString: () => getApiBase(),
  valueOf: () => getApiBase(),
  [Symbol.toPrimitive]: () => getApiBase(),
} as unknown as string;

export function recordMediaView(params: {
  mediaType: string;
  mediaId: string;
  pluginId: string;
  title: string;
  cover?: string;
}) {
  fetch(`${API_BASE}/api/aggregate/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {
    // Trending count is best-effort; ignore failures.
  });
}
