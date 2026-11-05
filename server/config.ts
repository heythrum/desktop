export type ConfigEvent = { httpMethod: string; headers?: Record<string, string | undefined> };

const allowedOrigins = new Set([
  'https://thrum.uno', 'https://www.thrum.uno',
  'http://127.0.0.1:43197', 'http://127.0.0.1:5173', 'http://localhost:5173',
]);

export function publicCorsHeaders(origin?: string): Record<string, string> {
  return origin && allowedOrigins.has(origin)
    ? { Vary: 'Origin', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
    : { Vary: 'Origin' };
}

function isPublicKey(key: string) {
  if (/^sb_publishable_[a-zA-Z0-9_-]{10,}$/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3 || !parts.every(part => /^[a-zA-Z0-9_-]+$/.test(part))) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    return payload.role === 'anon';
  } catch { return false; }
}

function publicConfiguration(environment: Record<string, string | undefined>): { url: string; publishableKey: string } | null {
  const rawUrl = environment.SUPABASE_URL?.trim();
  const key = (environment.SUPABASE_PUBLISHABLE_KEY || environment.SUPABASE_ANON_KEY)?.trim();
  if (!rawUrl || !key || !isPublicKey(key)) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
    if (!/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) return null;
    return { url: url.origin, publishableKey: key };
  } catch { return null; }
}

/** Only the Supabase public project settings leave this endpoint. RLS protects data. */
export async function createConfigResponse(event: ConfigEvent, environment: Record<string, string | undefined>) {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: requestOrigin && allowedOrigins.has(requestOrigin) ? 204 : 403, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: { ...headers, Allow: 'GET, OPTIONS' }, body: JSON.stringify({ error: 'Méthode non autorisée.' }) };
  const config = publicConfiguration(environment);
  if (!config) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Les comptes Thrum ne sont pas encore configurés.', code: 'CLOUD_NOT_CONFIGURED' }) };
  return { statusCode: 200, headers, body: JSON.stringify(config) };
}
