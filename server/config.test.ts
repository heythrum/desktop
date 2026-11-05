import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../netlify/functions/config';

const publishable = 'sb_publishable_not-a-real-credential-123';
function jwt(role: string) { return `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.testsignature`; }

describe('public account configuration', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://thrum-test.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', publishable);
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('YOUTUBE_API_KEY', 'private-server-key-never-returned');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-service-role-never-returned');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('returns only public URL and key and prevents stale cached setup', async () => {
    const response = await handler({ httpMethod: 'GET' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ url: 'https://thrum-test.supabase.co', publishableKey: publishable });
    expect(response.body).not.toContain('private-');
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.headers).not.toHaveProperty('Access-Control-Allow-Credentials');
  });
  it('rejects write methods', async () => {
    expect((await handler({ httpMethod: 'POST' })).statusCode).toBe(405);
  });
  it.each(['', 'sb_secret_not-a-real-secret', jwt('service_role'), 'bad.key', jwt('authenticated')])('rejects missing or privileged keys', async value => {
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', value);
    const response = await handler({ httpMethod: 'GET' });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ error: 'Les comptes Thrum ne sont pas encore configurés.', code: 'CLOUD_NOT_CONFIGURED' });
  });
  it('supports the legacy anonymous JWT key', async () => {
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('SUPABASE_ANON_KEY', jwt('anon'));
    expect((await handler({ httpMethod: 'GET' })).statusCode).toBe(200);
  });
  it.each(['http://thrum-test.supabase.co', 'https://thrum-test.supabase.co/path', 'https://secret@thrum-test.supabase.co', 'https://supabase.co.attacker.test', 'https://thrum-test.supabase.co:8443', 'https://thrum-test.supabase.co?token=x'])('rejects unsafe project URL %s', async url => {
    vi.stubEnv('SUPABASE_URL', url);
    expect((await handler({ httpMethod: 'GET' })).statusCode).toBe(503);
  });
  it('allows packaged desktop configuration discovery without cookies', async () => {
    const origin = 'http://127.0.0.1:43197';
    const response = await handler({ httpMethod: 'GET', headers: { origin } });
    expect(response.headers['Access-Control-Allow-Origin']).toBe(origin);
    expect((await handler({ httpMethod: 'OPTIONS', headers: { origin } })).statusCode).toBe(204);
  });
  it('does not grant browser cross-origin reads to arbitrary websites', async () => {
    const response = await handler({ httpMethod: 'GET', headers: { origin: 'https://attacker.test' } });
    expect(response.headers).not.toHaveProperty('Access-Control-Allow-Origin');
    expect((await handler({ httpMethod: 'OPTIONS', headers: { origin: 'https://attacker.test' } })).statusCode).toBe(403);
  });
});
