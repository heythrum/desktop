import type { Track } from './types';

const PREFIX = '#playlist=';
const PRODUCTION_ORIGIN = 'https://thrum.uno';
const MAX_URL_LENGTH = 24_000;
const MAX_TRACKS = 50;
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

interface SharedPlaylist {
  name: string;
  tracks: Track[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new Error(`Ce lien de playlist Thrum est invalide : ${message}`);
}

function checkedText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim()) return invalid(`${label} est manquant.`);
  if (value.length > max) return invalid(`${label} dépasse ${max} caractères.`);
  return value.trim();
}

function validatedTrack(value: unknown): Track {
  if (!record(value) || typeof value.i !== 'string' || !VIDEO_ID.test(value.i)) return invalid('un identifiant YouTube est incorrect.');
  return {
    id: value.i,
    title: checkedText(value.t, 300, 'le titre'),
    artist: checkedText(value.a, 200, 'l’artiste'),
    thumbnail: `https://i.ytimg.com/vi/${value.i}/hqdefault.jpg`,
  };
}

function shareOrigin(origin?: string): string {
  const input = origin ?? (typeof window !== 'undefined' ? window.location.origin : PRODUCTION_ORIGIN);
  try {
    const url = new URL(input);
    // Files, custom Electron schemes and insecure development origins cannot
    // produce useful public share links. The hosted production app handles them.
    if (url.protocol === 'https:' && !url.username && !url.password && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.origin;
  } catch { /* Use the public website for opaque origins such as file://. */ }
  return PRODUCTION_ORIGIN;
}

/** Self-contained snapshot in the URL fragment; no playlist backend involved. */
export function createPlaylistShareUrl(name: string, tracks: Track[], origin?: string): string {
  const cleanName = checkedText(name, 80, 'le nom de playlist');
  if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('Ajoute au moins un titre à la playlist avant de la partager.');
  if (tracks.length > MAX_TRACKS) throw new Error('Un lien de partage est limité à 50 titres. Crée une playlist plus courte.');
  const unique = new Map<string, Track>();
  for (const item of tracks) {
    const track = validatedTrack(record(item) ? { i: item.id, t: item.title, a: item.artist } : item);
    if (!unique.has(track.id)) unique.set(track.id, track);
  }
  const payload = JSON.stringify({ v: 1, n: cleanName, t: [...unique.values()].map((track) => ({ i: track.id, t: track.title, a: track.artist })) });
  const bytes = new TextEncoder().encode(payload);
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const url = `${shareOrigin(origin)}/${PREFIX}${encoded}`;
  if (url.length > MAX_URL_LENGTH) throw new Error('Cette playlist est trop volumineuse pour un lien de partage. Retire quelques titres ou utilise la sauvegarde JSON.');
  return url;
}

/** Null means another app hash. A malformed Thrum playlist throws a French error. */
export function decodeSharedPlaylist(hash: string): SharedPlaylist | null {
  if (!hash.startsWith(PREFIX)) return null;
  if (hash.length > MAX_URL_LENGTH) return invalid('le lien est trop volumineux. La limite est de 24 000 caractères.');
  const encoded = hash.slice(PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return invalid('les données encodées ne sont pas lisibles.');
  let payload: unknown;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return invalid('le contenu JSON ou son encodage est incorrect.'); }
  if (!record(payload) || payload.v !== 1) return invalid('cette version n’est pas prise en charge.');
  const name = checkedText(payload.n, 80, 'le nom de playlist');
  if (!Array.isArray(payload.t) || payload.t.length === 0) return invalid('la liste ne contient aucun titre.');
  if (payload.t.length > MAX_TRACKS) return invalid('une playlist partagée est limitée à 50 titres.');
  const tracks = new Map<string, Track>();
  for (const value of payload.t) {
    const track = validatedTrack(value);
    if (!tracks.has(track.id)) tracks.set(track.id, track);
  }
  return { name, tracks: [...tracks.values()] };
}
