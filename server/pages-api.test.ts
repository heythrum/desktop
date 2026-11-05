import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as config } from '../functions/api/config';
import { onRequest as search } from '../functions/api/search';

const env = { SUPABASE_URL: 'https://thrum-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_not-a-real-credential-123' };
afterEach(() => vi.unstubAllGlobals());
describe('Cloudflare Pages API adapters', () => {
  it('serves the public account configuration without server secrets', async () => {
    const response = await config({ request: new Request('https://thrum.uno/api/config'), env });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY });
  });
  it('supports the packaged desktop preflight with no body', async () => {
    const response = await config({ request: new Request('https://thrum.uno/api/config', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:43197' } }), env });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:43197');
    expect(await response.text()).toBe('');
  });
  it('reports missing setup without an internal error', async () => {
    expect((await config({ request: new Request('https://thrum.uno/api/config'), env: {} })).status).toBe(503);
    expect((await search({ request: new Request('https://thrum.uno/api/search?q=Queen'), env: {} })).status).toBe(503);
  });
  it('rejects writes to public search', async () => {
    expect((await search({ request: new Request('https://thrum.uno/api/search?q=Queen', { method: 'POST' }), env: {} })).status).toBe(405);
  });
  it('runs genuine provider searches with the server key and returns only safe items', async () => {
    const provider = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: { videoId: 'fJ9rUzIMcZQ' }, snippet: { title: 'Bohemian Rhapsody', channelTitle: 'Queen' } }] })));
    vi.stubGlobal('fetch', provider);
    const response = await search({ request: new Request('https://thrum.uno/api/search?q=CF+adapter+test'), env: { YOUTUBE_API_KEY: 'not-a-real-secret' } });
    expect(response.status).toBe(200);
    const payload = await response.json() as { items: { title: string }[] };
    expect(payload.items[0].title).toBe('Bohemian Rhapsody');
    expect(JSON.stringify(payload)).not.toContain('not-a-real-secret');
    expect(provider).toHaveBeenCalledOnce();
  });
});
