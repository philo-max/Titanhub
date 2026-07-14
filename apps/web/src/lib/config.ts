export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
