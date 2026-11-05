import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, LoaderCircle, Play, Search } from 'lucide-react';
import { Dialog } from './Dialog';
import { searchYouTube } from '../lib/youtube';
import type { Track } from '../lib/types';

export function AlternativeVersions({ track, apiKey, onSelect, onClose }: { track: Track; apiKey: string; onSelect: (track: Track) => void; onClose: () => void }) {
  const [query, setQuery] = useState(`${track.artist} ${track.title}`.slice(0, 100));
  const [items, setItems] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  async function find(value: string) {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setItems([]);
    const timer = setTimeout(() => request.abort('timeout'), 15000);
    try { const results = await searchYouTube(value, apiKey, request.signal); if (!request.signal.aborted) setItems(results.filter(item => item.id !== track.id)); }
    catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Recherche impossible.'); }
    finally { clearTimeout(timer); if (controller.current === request) { setBusy(false); if (request.signal.reason === 'timeout') setError('La recherche a expiré. Réessayez.'); } }
  }
  useEffect(() => { void find(query); return () => { controller.current?.abort(); controller.current = null; }; }, [track.id]);
  function submit(event: FormEvent) { event.preventDefault(); void find(query); }
  return <Dialog title="Trouver une autre version" onClose={onClose}>
    <p>YouTube refuse la lecture de cette vidéo dans Thrum. Les résultats ci-dessous autorisent l’intégration dans la recherche YouTube, mais leur lecture peut encore dépendre de votre région ou des règles de leur auteur.</p>
    <form onSubmit={submit}><label htmlFor="alternative-query">Artiste et titre à chercher</label><input id="alternative-query" value={query} onChange={event => setQuery(event.target.value)} minLength={2} maxLength={100} required/><button className="button primary full" disabled={busy}><Search size={16}/> Rechercher les versions</button></form>
    {busy && <p role="status" className="fine-print"><LoaderCircle className="spin" size={16}/> Recherche de versions disponibles…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {!busy && !error && !items.length && <p className="fine-print">Aucune autre version trouvée. Essayez un titre plus précis ou ouvrez la vidéo sur YouTube.</p>}
    <div className="playlist-picker" style={{marginTop: 16}}>{items.slice(0, 12).map(item => <button key={item.id} onClick={() => onSelect(item)}><Play size={16}/><span>{item.title}<small>{item.artist}</small></span></button>)}</div>
    <a className="button secondary full" href={`https://www.youtube.com/watch?v=${track.id}`} target="_blank" rel="noopener noreferrer">Écouter la vidéo sur YouTube <ExternalLink size={14}/></a>
    <p className="fine-print">Vérifiez l’artiste et la version avant de lancer la lecture. Une recherche utilise le quota de votre clé ou du serveur. Aucune vidéo bloquée n’est extraite ou débloquée par cet écran.</p>
  </Dialog>;
}
