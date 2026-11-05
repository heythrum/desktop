import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createInitialState } from './library';
import { CloudConflictError, fetchRemoteLibrary, pushRemoteLibrary, validateCloudConfig } from './cloud';

const { makeClient, publicDefaults } = vi.hoisted(() => ({ makeClient: vi.fn(), publicDefaults: {} as Record<string, string> }));
vi.mock('../config/public', () => ({ PUBLIC_SUPABASE_CONFIG: publicDefaults }));
vi.mock('@supabase/supabase-js', () => ({ createClient: makeClient }));
const config = { url: 'https://thrum-test.supabase.co', publishableKey: 'sb_publishable_test_key_for_browser' };
const state = createInitialState();
const row = { state, revision: 3, updated_at: '2026-11-05T12:00:00Z' };
const jwt = (role: string) => `${btoa('{}')}.${btoa(JSON.stringify({ role }))}.signature`;
function fakeClient(data: unknown = row, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const rpc = vi.fn().mockResolvedValue({ data: data ? [data] : null, error });
  return { client: { from, rpc } as unknown as SupabaseClient, from, select, eq, rpc };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); for (const field of Object.keys(publicDefaults)) delete publicDefaults[field]; });

describe('public Supabase configuration', () => {
  it('treats absent configuration as optional', () => {
    expect(validateCloudConfig(null)).toBeNull();
    expect(validateCloudConfig({})).toBeNull();
    expect(validateCloudConfig({ url: '', publishableKey: '' })).toBeNull();
  });
  it('accepts publishable and legacy anon keys', () => {
    expect(validateCloudConfig(config)).toEqual(config);
    expect(validateCloudConfig({ ...config, url: `${config.url}/`, publishableKey: jwt('anon') })?.url).toBe(config.url);
  });
  it.each(['sb_secret_never_ship_this', jwt('service_role'), jwt('authenticated'), 'malformed-token'])('refuses a secret or non-public key', key => {
    expect(() => validateCloudConfig({ ...config, publishableKey: key })).toThrow('clé publique');
  });
  it.each(['http://thrum-test.supabase.co', 'https://thrum-test.supabase.co.evil.test', 'https://key@thrum-test.supabase.co', 'https://thrum-test.supabase.co/rest/v1', 'https://thrum-test.supabase.co?key=value'])('refuses unsafe project addresses', url => {
    expect(() => validateCloudConfig({ ...config, url })).toThrow('HTTPS officielle');
  });
  it('refuses incomplete configuration rather than leaking a key to a guessed host', () => {
    expect(() => validateCloudConfig({ publishableKey: config.publishableKey })).toThrow('incomplète');
  });
});

describe('snapshot transport', () => {
  it('reads only the selected owner and validates the returned state', async () => {
    const fake = fakeClient();
    await expect(fetchRemoteLibrary(fake.client, 'user-1')).resolves.toEqual({ state, revision: 3, updatedAt: row.updated_at });
    expect(fake.from).toHaveBeenCalledWith('library_snapshots');
    expect(fake.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });
  it('returns null for an account without a snapshot', async () => {
    await expect(fetchRemoteLibrary(fakeClient(null).client, 'user-1')).resolves.toBeNull();
  });
  it('never accepts a corrupt remote state or revision', async () => {
    await expect(fetchRemoteLibrary(fakeClient({ ...row, revision: -1 }).client, 'user-1')).rejects.toThrow('incompatible');
    await expect(fetchRemoteLibrary(fakeClient({ ...row, state: { version: 100 } }).client, 'user-1')).rejects.toThrow('invalide');
  });
  it('writes through the owner-bound CAS RPC', async () => {
    const fake = fakeClient();
    await expect(pushRemoteLibrary(fake.client, 'user-1', state, 2)).resolves.toEqual({ state, revision: 3, updatedAt: row.updated_at });
    expect(fake.rpc).toHaveBeenCalledWith('save_library_snapshot', { p_state: state, p_expected_revision: 2, p_user_id: 'user-1' });
  });
  it('creates a first snapshot only with a null expected revision', async () => {
    const fake = fakeClient();
    await pushRemoteLibrary(fake.client, 'user-1', state, null);
    expect(fake.rpc.mock.calls[0][1].p_expected_revision).toBeNull();
  });
  it.each(['PT409', '23505'])('exposes concurrency conflicts distinctly', async code => {
    await expect(pushRemoteLibrary(fakeClient(null, { code, message: 'do not leak internal data' }).client, 'user-1', state, 2)).rejects.toBeInstanceOf(CloudConflictError);
  });
  it('diagnoses missing migration and authentication without exposing server messages', async () => {
    await expect(fetchRemoteLibrary(fakeClient(null, { code: '42P01', message: 'internal details' }).client, 'user-1')).rejects.toThrow('migration');
    await expect(pushRemoteLibrary(fakeClient(null, { code: '42501' }).client, 'user-1', state, 1)).rejects.toThrow('Reconnectez');
  });
  it('rejects unauthenticated and invalid revision requests before transport', async () => {
    const fake = fakeClient();
    await expect(pushRemoteLibrary(fake.client, '', state, 1)).rejects.toThrow('Connectez');
    await expect(pushRemoteLibrary(fake.client, 'user-1', state, 0)).rejects.toThrow('invalide');
    expect(fake.rpc).not.toHaveBeenCalled();
  });
  it('rejects oversized normalized libraries before upload', async () => {
    const large = createInitialState();
    large.tracks = Array.from({ length: 5000 }, (_, i) => ({ id: String(i).padStart(11, '0'), title: 'Test', artist: 'Test', thumbnail: '' }));
    const allIds = large.tracks.map(track => track.id);
    large.playlists = Array.from({ length: 200 }, (_, i) => ({ id: `list-${i}`, name: 'Test', trackIds: allIds, createdAt: 0 }));
    const fake = fakeClient();
    await expect(pushRemoteLibrary(fake.client, 'user-1', large, null)).rejects.toThrow('5 Mo');
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

describe('runtime client initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
  });
  it('uses the explicitly bundled public project without requiring runtime config access', async () => {
    Object.assign(publicDefaults, config);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const expected = { testClient: true }; makeClient.mockReturnValue(expected);
    expect(await (await import('./cloud')).getCloudClient()).toBe(expected);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not cache absent runtime configuration', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(Response.json(config));
    vi.stubGlobal('fetch', fetcher);
    const expected = { testClient: true }; makeClient.mockReturnValue(expected);
    const { getCloudClient } = await import('./cloud');
    expect(await getCloudClient()).toBeNull();
    expect(await getCloudClient()).toBe(expected);
    expect(await getCloudClient()).toBe(expected);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(makeClient).toHaveBeenCalledTimes(1);
  });
  it('reads the hosted public endpoint in the packaged desktop app', async () => {
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1', port: '43197' } });
    const fetcher = vi.fn().mockResolvedValue(Response.json(config)); vi.stubGlobal('fetch', fetcher);
    makeClient.mockReturnValue({});
    await (await import('./cloud')).getCloudClient();
    expect(fetcher.mock.calls[0][0]).toBe('https://thrum.uno/api/config');
  });
  it('rejects a secret accidentally returned by an endpoint before creating a client', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...config, publishableKey: 'sb_secret_not_for_clients' })));
    await expect((await import('./cloud')).getCloudClient()).rejects.toThrow('clé publique');
    expect(makeClient).not.toHaveBeenCalled();
  });
});
