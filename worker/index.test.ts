import { describe, expect, it, vi, afterEach } from 'vitest';
import worker, { type WorkerEnvironment } from './index';
import { PUBLIC_SUPABASE_CONFIG } from '../src/config/public';

const environment = (): WorkerEnvironment => ({ ASSETS: { fetch: vi.fn(async () => new Response('<html>Thrum</html>', { headers: { 'Content-Type': 'text/html' } })) } });
afterEach(() => vi.unstubAllGlobals());
describe('Cloudflare Worker entry', () => {
  it('serves the original static request through the bound assets', async () => {
    const env = environment(); const request = new Request('https://thrum.uno/');
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Thrum');
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });
  it('exposes only the provided public project configuration by default', async () => {
    const response = await worker.fetch(new Request('https://thrum.uno/api/config'), environment());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PUBLIC_SUPABASE_CONFIG);
  });
  it('rejects unsafe runtime overrides without exposing the key', async () => {
    const response = await worker.fetch(new Request('https://thrum.uno/api/config'), { ...environment(), SUPABASE_URL: 'https://thrum-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do-not-return' });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('sb_secret');
  });
  it('does not silently combine a different runtime project with the original key', async () => {
    const response = await worker.fetch(new Request('https://thrum.uno/api/config'), { ...environment(), SUPABASE_URL: 'https://different.supabase.co' });
    expect(response.status).toBe(503);
  });
  it('permits the actual Windows loopback preflight', async () => {
    const response = await worker.fetch(new Request('https://thrum.uno/api/config', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:43197' } }), environment());
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:43197');
  });
  it('reports a missing YouTube key while preserving static availability', async () => {
    const env = environment();
    const response = await worker.fetch(new Request('https://thrum.uno/api/search?q=Queen'), env);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).toContain('API_KEY_MISSING');
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it('returns JSON404 for unknown APIs instead of a misleading HTML shell', async () => {
    const response = await worker.fetch(new Request('https://thrum.uno/api/unknown'), environment());
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});
