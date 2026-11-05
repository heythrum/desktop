// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { CloudConflictError, fetchRemoteLibrary, getCloudClient, pushRemoteLibrary } from '../lib/cloud';
import { createInitialState } from '../lib/library';
import type { LibraryState } from '../lib/types';
import { useCloudSync } from './useCloudSync';

vi.mock('../lib/cloud', () => ({
  CloudConflictError: class CloudConflictError extends Error {},
  getCloudClient: vi.fn(), fetchRemoteLibrary: vi.fn(), pushRemoteLibrary: vi.fn(),
}));
const account = { id: 'user-a', email: 'a@example.test' } as User;
let authEvent: (event: string, session: { user: User } | null) => void;
let signOut: ReturnType<typeof vi.fn>;
function client(initialUser: User | null = account) {
  signOut = vi.fn().mockImplementation(async () => { authEvent('SIGNED_OUT', null); return { error: null }; });
  return { auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: initialUser ? { user: initialUser } : null }, error: null }),
    onAuthStateChange: vi.fn(callback => { authEvent = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    signOut,
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { user: account } }, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
  } } as unknown as SupabaseClient;
}
function state(label: string): LibraryState { return { ...createInitialState(), playlists: [{ id: 'test-playlist', name: label, createdAt: 0, trackIds: [] }] }; }
function snapshot(label: string, revision = 1) { return { state: state(label), revision, updatedAt: '2026-11-05T18:00:00Z' }; }
function harness() {
  const [library, setLibrary] = useState(() => state('Local'));
  const cloud = useCloudSync(library, setLibrary);
  return { library, setLibrary, cloud };
}
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCloudClient).mockResolvedValue(client());
  vi.mocked(fetchRemoteLibrary).mockResolvedValue(snapshot('Cloud', 3));
  vi.mocked(pushRemoteLibrary).mockImplementation(async (_client, _id, library, revision) => ({ state: library, revision: (revision || 0) + 1, updatedAt: '2026-11-05T18:01:00Z' }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useCloudSync explicit baseline and concurrency', () => {
  it('does not overwrite remote data or replace local data on login', async () => {
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('choose'));
    expect(result.current.library.playlists[0].name).toBe('Local');
    expect(result.current.cloud.remote?.state.playlists[0].name).toBe('Cloud');
    act(() => result.current.setLibrary(state('Local edited')));
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(pushRemoteLibrary).not.toHaveBeenCalled();
  });

  it('loads remote only after explicit choice and debounces later local changes using its revision', async () => {
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('choose'));
    await act(() => result.current.cloud.downloadRemote());
    expect(result.current.library.playlists[0].name).toBe('Cloud');
    expect(pushRemoteLibrary).not.toHaveBeenCalled();
    act(() => result.current.setLibrary(state('Edited after baseline')));
    await waitFor(() => expect(pushRemoteLibrary).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(vi.mocked(pushRemoteLibrary).mock.calls[0][1]).toBe(account.id);
    expect(vi.mocked(pushRemoteLibrary).mock.calls[0][3]).toBe(3);
    await waitFor(() => expect(result.current.cloud.status).toBe('synced'));
  });

  it('creates a first online library with no expected revision after explicit activation', async () => {
    vi.mocked(fetchRemoteLibrary).mockResolvedValue(null);
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('choose'));
    expect(pushRemoteLibrary).not.toHaveBeenCalled();
    await act(() => result.current.cloud.uploadLocal());
    expect(vi.mocked(pushRemoteLibrary).mock.calls[0][3]).toBeNull();
    expect(result.current.cloud.status).toBe('synced');
  });

  it('stops automatic sync on conflict and preserves both local and newly fetched remote versions', async () => {
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('choose'));
    await act(() => result.current.cloud.downloadRemote());
    vi.mocked(pushRemoteLibrary).mockRejectedValueOnce(new CloudConflictError());
    vi.mocked(fetchRemoteLibrary).mockResolvedValue(snapshot('Changed elsewhere', 4));
    act(() => result.current.setLibrary(state('My unsaved edit')));
    await waitFor(() => expect(result.current.cloud.status).toBe('conflict'), { timeout: 2000 });
    await waitFor(() => expect(result.current.cloud.remote?.revision).toBe(4));
    expect(result.current.library.playlists[0].name).toBe('My unsaved edit');
    act(() => result.current.setLibrary(state('Another local edit')));
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(pushRemoteLibrary).toHaveBeenCalledTimes(1);
    await act(() => result.current.cloud.uploadLocal());
    expect(vi.mocked(pushRemoteLibrary).mock.calls[1][3]).toBe(4);
  });

  it('does not transfer a pending local change into a different signed-in account', async () => {
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('choose'));
    await act(() => result.current.cloud.downloadRemote());
    act(() => result.current.setLibrary(state('Account A local edit')));
    await act(async () => { authEvent('SIGNED_IN', { user: { ...account, id: 'user-b', email: 'b@example.test' } }); await Promise.resolve(); });
    await waitFor(() => expect(result.current.cloud.status).toBe('choose'));
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(pushRemoteLibrary).not.toHaveBeenCalled();
    expect(result.current.cloud.user?.id).toBe('user-b');
  });

  it('ignores stale fetches from an account that has signed out', async () => {
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(fetchRemoteLibrary).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(harness);
    await waitFor(() => expect(fetchRemoteLibrary).toHaveBeenCalled());
    await act(async () => { authEvent('SIGNED_OUT', null); await Promise.resolve(); });
    await act(async () => { finish(snapshot('Old account')); await Promise.resolve(); });
    expect(result.current.cloud.status).toBe('signed-out');
    expect(result.current.cloud.remote).toBeNull();
    expect(result.current.library.playlists[0].name).toBe('Local');
  });

  it('serializes writes and saves edits made during an in-flight upload afterwards', async () => {
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('choose'));
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(pushRemoteLibrary).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.cloud.uploadLocal(); });
    expect(result.current.cloud.status).toBe('syncing');
    act(() => result.current.setLibrary(state('Changed during upload')));
    await act(() => result.current.cloud.uploadLocal());
    expect(pushRemoteLibrary).toHaveBeenCalledTimes(1);
    await act(async () => { finish(snapshot('Local', 4)); await pending; });
    await waitFor(() => expect(pushRemoteLibrary).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(vi.mocked(pushRemoteLibrary).mock.calls[1][2].playlists[0].name).toBe('Changed during upload');
    expect(vi.mocked(pushRemoteLibrary).mock.calls[1][3]).toBe(4);
  });

  it('shows missing setup rather than claiming successful cloud sync', async () => {
    vi.mocked(getCloudClient).mockResolvedValue(null);
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('unconfigured'));
    expect(result.current.cloud.user).toBeNull();
    expect(fetchRemoteLibrary).not.toHaveBeenCalled();
    expect(pushRemoteLibrary).not.toHaveBeenCalled();
  });

  it('handles email confirmation and password recovery without altering the local library', async () => {
    vi.mocked(getCloudClient).mockResolvedValue(client(null));
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('signed-out'));
    await act(() => result.current.cloud.signUp('new@example.test', 'a-long-password'));
    expect(result.current.cloud.notice).toMatch(/confirmer/);
    await act(async () => { authEvent('PASSWORD_RECOVERY', { user: account }); await Promise.resolve(); });
    await waitFor(() => expect(result.current.cloud.recovery).toBe(true));
    await act(() => result.current.cloud.updatePassword('another-long-password'));
    expect(result.current.cloud.recovery).toBe(false);
    expect(result.current.library.playlists[0].name).toBe('Local');
    expect(pushRemoteLibrary).not.toHaveBeenCalled();
  });
  it('receives clean remote changes on focus without uploading an old local copy', async () => {
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('choose'));
    await act(() => result.current.cloud.downloadRemote());
    vi.mocked(fetchRemoteLibrary).mockResolvedValue(snapshot('Changed on Windows', 4));
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    await waitFor(() => expect(result.current.library.playlists[0].name).toBe('Changed on Windows'));
    expect(result.current.cloud.remote?.revision).toBe(4);
    expect(result.current.cloud.status).toBe('synced');
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(pushRemoteLibrary).not.toHaveBeenCalled();
  });

  it('turns concurrent dirty edits into a conflict on focus and never overwrites local data', async () => {
    const { result } = renderHook(harness);
    await waitFor(() => expect(result.current.cloud.status).toBe('choose'));
    await act(() => result.current.cloud.downloadRemote());
    act(() => result.current.setLibrary(state('Unsaved local version')));
    vi.mocked(fetchRemoteLibrary).mockResolvedValue(snapshot('Remote changed too', 4));
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    await waitFor(() => expect(result.current.cloud.status).toBe('conflict'));
    expect(result.current.library.playlists[0].name).toBe('Unsaved local version');
    expect(result.current.cloud.remote?.state.playlists[0].name).toBe('Remote changed too');
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(pushRemoteLibrary).not.toHaveBeenCalled();
  });

  it('polls visible active sessions and removes focus listeners after unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { result, unmount } = renderHook(harness);
    await settle();
    expect(result.current.cloud.status).toBe('choose');
    await act(() => result.current.cloud.downloadRemote());
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.mocked(fetchRemoteLibrary).mockResolvedValue(snapshot('Periodic update', 4));
    await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); });
    expect(result.current.library.playlists[0].name).toBe('Periodic update');
    const calls = vi.mocked(fetchRemoteLibrary).mock.calls.length;
    unmount();
    await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(60_000); await Promise.resolve(); });
    expect(fetchRemoteLibrary).toHaveBeenCalledTimes(calls);
  });

});
