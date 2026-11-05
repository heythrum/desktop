export interface SpotifyCSVTrack {
  title: string;
  artist: string;
  spotifyUrl?: string;
}

export interface SpotifyResource {
  type: 'track' | 'album' | 'playlist';
  id: string;
  embedUrl: string;
}

/** Only official Spotify resources are embedded; never use an input URL verbatim. */
export function parseSpotifyUrl(input: string): SpotifyResource | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password) return null;
  const path = url.pathname.replace(/^\/intl-[a-z]{2}(?=\/)/i, '');
  const match = /^\/(track|album|playlist)\/([a-zA-Z0-9]{22})\/?$/.exec(path);
  if (!match) return null;
  const type = match[1] as SpotifyResource['type'];
  return { type, id: match[2], embedUrl: `https://open.spotify.com/embed/${type}/${match[2]}?utm_source=thrum&theme=0` };
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let atFieldStart = true;
  const pushRow = () => {
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
    if (rows.length > 501) throw new Error('Le fichier est limité à 500 titres. Exporte une playlist plus courte.');
    row = []; field = ''; atFieldStart = true; afterQuote = false;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; afterQuote = true; }
      } else field += character;
      continue;
    }
    if (character === ',') {
      row.push(field); field = ''; atFieldStart = true; afterQuote = false;
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      pushRow();
    } else if (character === '"' && atFieldStart) {
      quoted = true; atFieldStart = false;
    } else {
      if (afterQuote && !/\s/.test(character)) throw new Error('Le CSV contient des guillemets mal fermés. Exporte-le à nouveau depuis ton outil.');
      if (character === '"') throw new Error('Les guillemets du CSV sont invalides. Utilise un export CSV standard.');
      if (!afterQuote) field += character;
      atFieldStart = false;
    }
  }
  if (quoted) throw new Error('Le CSV contient un champ entre guillemets qui n’est pas fermé.');
  if (row.length || field || afterQuote) pushRow();
  return rows;
}

/** Parse Exportify-style CSV locally. No Spotify authentication or file upload. */
export function parseSpotifyCSV(text: string): SpotifyCSVTrack[] {
  if (text.length > 5_000_000 || new TextEncoder().encode(text).byteLength > 5_000_000) throw new Error('Le CSV doit faire moins de 5 Mo.');
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('Le CSV ne contient aucun titre à importer.');
  const headers = rows.shift()!.map((header) => header.trim().toLowerCase());
  const titleIndex = headers.findIndex((header) => ['track name', 'track title', 'title'].includes(header));
  const artistIndex = headers.findIndex((header) => ['artist name(s)', 'artist names', 'artist name', 'artists', 'artist'].includes(header));
  const uriIndex = headers.findIndex((header) => ['track uri', 'spotify uri', 'track url', 'spotify url'].includes(header));
  if (titleIndex < 0 || artistIndex < 0) throw new Error('Colonnes manquantes : « Track Name » et « Artist Name(s) » sont nécessaires. Utilise un CSV au format Exportify, séparé par des virgules.');
  const tracks: SpotifyCSVTrack[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.length !== headers.length) throw new Error('Une ligne du CSV ne contient pas le bon nombre de colonnes. Vérifie les virgules et guillemets.');
    const title = row[titleIndex].trim().replace(/\s+/g, ' ').slice(0, 300);
    const artist = row[artistIndex].trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!title || !artist) continue;
    const duplicateKey = `${title.toLocaleLowerCase()}\u0000${artist.toLocaleLowerCase()}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    const track: SpotifyCSVTrack = { title, artist };
    const uri = uriIndex >= 0 ? row[uriIndex].trim() : '';
    const spotifyId = /^spotify:track:([a-zA-Z0-9]{22})$/.exec(uri)?.[1];
    const urlResource = parseSpotifyUrl(uri);
    if (spotifyId) track.spotifyUrl = `https://open.spotify.com/track/${spotifyId}`;
    else if (urlResource?.type === 'track') track.spotifyUrl = `https://open.spotify.com/track/${urlResource.id}`;
    tracks.push(track);
  }
  if (tracks.length === 0) throw new Error('Aucun titre avec un nom et un artiste n’a été trouvé dans le CSV.');
  return tracks;
}
