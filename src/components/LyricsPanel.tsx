import { useEffect, useRef, useState } from 'react';
import { FileMusic, Upload, Trash2, Minus, Plus } from 'lucide-react';
import type { Track } from '../lib/types';
import { activeLyricIndex, getSavedLyrics, MAX_LRC_BYTES, parseLrc, saveLyrics, type SavedLyrics } from '../lib/lyrics';
import './LyricsPanel.css';

interface Props { track: Track | null; time: number; onSeek: (seconds: number) => void }

export function LyricsPanel({track, time, onSeek}: Props) {
  const [lyrics, setLyrics] = useState<SavedLyrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);
  const currentId = useRef(track?.id);
  currentId.current = track?.id;
  useEffect(() => { setLyrics(track ? getSavedLyrics(track.id) : null); setError(''); }, [track?.id]);
  const active = lyrics ? activeLyricIndex(lyrics.lines, time, lyrics.offsetSeconds) : -1;
  useEffect(() => {
    activeLine.current?.scrollIntoView({block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }, [active, track?.id]);
  function persist(value: SavedLyrics | null) {
    if (!track) return;
    try { saveLyrics(track.id, value); setLyrics(value); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'La sauvegarde a échoué.'); }
  }
  async function importFile(file?: File) {
    if (!file || !track) return;
    const id = track.id;
    setError(''); setLoading(true);
    try {
      if (file.size > MAX_LRC_BYTES) throw new Error('Le fichier LRC doit faire moins de 1 Mo.');
      if (!file.name.toLowerCase().endsWith('.lrc')) throw new Error('Choisissez un fichier au format .lrc.');
      const lines = parseLrc(await file.text());
      if (currentId.current !== id) return;
      persist({lines, offsetSeconds: 0, filename: file.name.slice(0, 240)});
    } catch (cause) {
      if (currentId.current === id) setError(cause instanceof Error ? cause.message : 'Impossible de lire le fichier.');
    } finally { setLoading(false); }
  }
  return <section className="lyrics-panel" aria-label="Paroles synchronisées">
    <div className="lyrics-panel-heading"><div><span className="lyrics-eyebrow">SUIVEZ LE RYTHME</span><h3>Les mots, au bon moment.</h3></div><FileMusic size={24} aria-hidden="true" /></div>
    {!track ? <p className="lyrics-note">Choisissez un morceau pour afficher ou importer ses paroles.</p> : <>
      <p className="lyrics-track-name">{track.title}<span>{track.artist}</span></p>
      <input ref={input} type="file" accept=".lrc,text/plain" hidden aria-label="Fichier de paroles LRC" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} />
      <div className="lyrics-actions"><button type="button" className="lyrics-import" disabled={loading} onClick={() => input.current?.click()}><Upload size={15} aria-hidden="true" />{loading ? 'Lecture…' : lyrics ? 'Changer de LRC' : 'Importer un LRC'}</button>{lyrics && <button type="button" className="lyrics-delete" onClick={() => persist(null)} aria-label="Supprimer les paroles de ce morceau"><Trash2 size={16} /></button>}</div>
      {error && <p role="alert" className="lyrics-error">{error}</p>}
      {!lyrics ? <div className="lyrics-empty"><FileMusic size={36} aria-hidden="true" /><h4>Vos paroles, en synchronisation.</h4><p>Importez un fichier .lrc que vous possédez. Chaque ligne suivra la lecture ; cliquez sur une phrase pour la réécouter.</p><p className="lyrics-note">Aucune parole n’est générée. Synchronisation par ligne, selon les repères du fichier.</p></div> : <>
        <div className="lyrics-offset"><span>Décalage <strong>{lyrics.offsetSeconds > 0 ? '+' : ''}{lyrics.offsetSeconds.toFixed(1)} s</strong></span><div><button type="button" aria-label="Avancer les paroles de 0,5 seconde" disabled={lyrics.offsetSeconds <= -30} onClick={() => persist({...lyrics, offsetSeconds: Math.max(-30, lyrics.offsetSeconds - .5)})}><Minus size={14} /></button><button type="button" aria-label="Retarder les paroles de 0,5 seconde" disabled={lyrics.offsetSeconds >= 30} onClick={() => persist({...lyrics, offsetSeconds: Math.min(30, lyrics.offsetSeconds + .5)})}><Plus size={14} /></button></div></div>
        <div className="lyrics-lines" aria-label="Lignes de paroles">{lyrics.lines.map((line, index) => <button type="button" key={`${line.time}-${index}`} ref={index === active ? activeLine : undefined} className={`lyrics-line${index === active ? ' is-active' : ''}`} aria-current={index === active ? 'true' : undefined} onClick={() => onSeek(Math.max(0, line.time + lyrics.offsetSeconds))}>{line.text}</button>)}</div>
        <p className="lyrics-note lyrics-file">{lyrics.filename} · Conservé sur cet appareil, séparément de la sauvegarde de bibliothèque.</p>
      </>}
    </>}
  </section>;
}

export default LyricsPanel;
