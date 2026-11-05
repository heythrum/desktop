import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLibrary } from './library';
import { PUBLIC_SUPABASE_CONFIG } from '../config/public';
import type { LibraryState } from './types';

export interface CloudConfig { url: string; publishableKey: string }
export interface CloudSnapshot { state: LibraryState; revision: number; updatedAt: string }

export class CloudConflictError extends Error {
  constructor() {
    super('Votre bibliothèque a changé sur un autre appareil. Rechargez sa version en ligne avant de synchroniser.');
    this.name = 'CloudConflictError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Only public Supabase client keys may reach the browser or packaged app. */
export function validateCloudConfig(value: unknown): CloudConfig | null {
  if (!record(value)) return null;
  const rawUrl = typeof value.url === 'string' ? value.url.trim() : '';
  const key = typeof value.publishableKey === 'string' ? value.publishableKey.trim() : '';
  if (!rawUrl && !key) return null;
  if (!rawUrl || !key) throw new Error('La configuration Supabase est incomplète.');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('L’adresse du projet Supabase est invalide.'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Utilisez l’adresse HTTPS officielle du projet Supabase (*.supabase.co), sans identifiants ni chemin.');
  }
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key);
  if (!publicKey && !key.startsWith('sb_secret_')) {
    try {
      const parts = key.split('.');
      if (parts.length === 3) {
        const decoded = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        publicKey = record(decoded) && decoded.role === 'anon';
      }
    } catch { /* Invalid or non-public tokens are always rejected. */ }
  }
  if (!publicKey) throw new Error('Utilisez uniquement une clé publique Supabase publishable ou anon. Une clé secrète ne doit jamais être placée dans Thrum.');
  return { url: url.origin, publishableKey: key };
}

let client: SupabaseClient | null = null;
let pendingClient: Promise<SupabaseClient | null> | null = null;

async function readConfig(): Promise<CloudConfig | null> {
  const compiled = validateCloudConfig({
    url: import.meta.env.VITE_SUPABASE_URL,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  });
  if (compiled) return compiled;
  const bundled = validateCloudConfig(PUBLIC_SUPABASE_CONFIG);
  if (bundled) return bundled;
  const desktop = typeof window !== 'undefined' && window.location.hostname === '127.0.0.1' && window.location.port === '43197';
  const endpoint = desktop ? 'https://thrum.uno/api/config' : '/api/config';
  const aborter = new AbortController();
  const timeout = setTimeout(() => aborter.abort(), 8000);
  try {
    const response = await fetch(endpoint, { signal: aborter.signal, headers: { Accept: 'application/json' } });
    if (response.status === 404 || response.status === 503) return null;
    if (!response.ok) throw new Error('La configuration du compte est indisponible. Réessayez plus tard.');
    const payload: unknown = await response.json().catch(() => null);
    if (!record(payload)) return null; // Static dev servers may return the application HTML.
    return validateCloudConfig(record(payload.supabase) ? payload.supabase : payload);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Le service de compte met trop de temps à répondre. Votre bibliothèque locale reste disponible.');
    if (error instanceof TypeError) throw new Error('Impossible de joindre le service de compte. Vérifiez votre connexion.');
    throw error;
  } finally { clearTimeout(timeout); }
}

/** Caches successful configuration only; missing configuration can be retried. */
export async function getCloudClient(): Promise<SupabaseClient | null> {
  if (client) return client;
  if (!pendingClient) pendingClient = readConfig().then(async config => {
    if (!config) return null;
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'thrum.auth.v1' },
    });
    return client;
  }).finally(() => { pendingClient = null; });
  return pendingClient;
}

function snapshot(value: unknown): CloudSnapshot {
  if (!record(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) {
    throw new Error('Le serveur a renvoyé une bibliothèque incompatible. Votre version locale est conservée.');
  }
  const state = normalizeLibrary(value.state);
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 5_000_000) throw new Error('La bibliothèque en ligne dépasse la taille autorisée.');
  return { state, revision: Number(value.revision), updatedAt: value.updated_at };
}

function safeCloudError(error: { code?: string; message?: string }, action: 'read' | 'write'): Error {
  if (error.code === 'PT409' || error.code === '23505') return new CloudConflictError();
  if (error.code === '42P01' || error.code === '42883' || error.code === 'PGRST202' || error.code === 'PGRST205') {
    return new Error('La base Supabase n’est pas encore préparée. Appliquez la migration fournie dans le dossier supabase.');
  }
  if (error.code === '42501' || error.code === 'PGRST301') return new Error('Votre session ne permet plus cette synchronisation. Reconnectez-vous.');
  return new Error(action === 'read' ? 'Impossible de charger la bibliothèque en ligne. Votre version locale est conservée.' : 'La sauvegarde en ligne a échoué. Votre bibliothèque locale est conservée.');
}

export async function fetchRemoteLibrary(cloud: SupabaseClient, userId: string): Promise<CloudSnapshot | null> {
  if (!userId) throw new Error('Connectez-vous pour retrouver votre bibliothèque.');
  const { data, error } = await cloud.from('library_snapshots').select('state, revision, updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw safeCloudError(error, 'read');
  return data ? snapshot(data) : null;
}

/** expectedRevision=null creates a first snapshot; it never overwrites an existing account. */
export async function pushRemoteLibrary(cloud: SupabaseClient, userId: string, state: LibraryState, expectedRevision: number | null): Promise<CloudSnapshot> {
  if (!userId) throw new Error('Connectez-vous pour sauvegarder votre bibliothèque.');
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new Error('La version de bibliothèque à synchroniser est invalide.');
  const normalized = normalizeLibrary(state);
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 5_000_000) throw new Error('La bibliothèque doit faire moins de 5 Mo pour être synchronisée.');
  const { data, error } = await cloud.rpc('save_library_snapshot', { p_state: normalized, p_expected_revision: expectedRevision, p_user_id: userId });
  if (error) throw safeCloudError(error, 'write');
  const row: unknown = Array.isArray(data) ? data[0] : data;
  return snapshot(row);
}
