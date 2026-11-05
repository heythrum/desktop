import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Check, ExternalLink, FileUp, Link, LoaderCircle, Search, Square, X } from 'lucide-react';
import { Dialog } from './Dialog';
import { parseSpotifyCSV, parseSpotifyUrl, type SpotifyCSVTrack, type SpotifyResource } from '../lib/spotify';
import { searchYouTube, YouTubeError } from '../lib/youtube';
import type { Track } from '../lib/types';

interface ImportRow {
  source: SpotifyCSVTrack;
  status: 'pending' | 'matching' | 'matched' | 'error';
  track?: Track;
  error?: string;
  selected: boolean;
}

interface Props {
  apiKey: string;
  onImport: (name: string, tracks: Track[]) => void;
  onClose: () => void;
}

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Annulé', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function SpotifyImport({ apiKey, onImport, onClose }: Props) {
  const [tab, setTab] = useState<'csv' | 'link'>('csv');
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<SpotifyResource | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [name, setName] = useState('Import Spotify');
  const [batchSize, setBatchSize] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  const selected = rows.filter((row) => row.track && row.selected);
  const matched = rows.filter((row) => row.track).length;
  const pending = rows.filter((row) => row.status === 'pending').length;
  const failed = rows.filter((row) => row.status === 'error').length;
  const updateRow = (index: number, update: Partial<ImportRow>) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...update } : row));

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setError(''); setNotice('');
    try {
      if (file.size > 5_000_000) throw new Error('Le CSV doit faire moins de 5 Mo.');
      const tracks = parseSpotifyCSV(await file.text());
      setRows(tracks.map((source) => ({ source, status: 'pending', selected: false })));
      setName(file.name.replace(/\.csv$/i, '').slice(0, 80) || 'Import Spotify');
      setNotice(`${tracks.length} titres lus localement. Aucun fichier n’a été envoyé à Spotify ou YouTube.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Le fichier n’a pas pu être lu.'); }
  }

  async function matchBatch() {
    if (busy) return;
    const candidates = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.status === 'pending').slice(0, batchSize);
    if (candidates.length === 0) return;
    const aborter = new AbortController();
    controller.current = aborter;
    setBusy(true); setError(''); setNotice('');
    let found = 0;
    let processed = 0;
    try {
      for (const { row, index } of candidates) {
        if (aborter.signal.aborted) break;
        updateRow(index, { status: 'matching', error: undefined });
        try {
          const results = await searchYouTube(`${row.source.artist} ${row.source.title}`.slice(0, 200), apiKey, aborter.signal);
          if (aborter.signal.aborted || !mounted.current) break;
          processed++;
          if (results[0]) {
            found++;
            updateRow(index, { status: 'matched', track: results[0], selected: true });
          } else updateRow(index, { status: 'error', error: 'Aucune vidéo trouvée.' });
        } catch (cause) {
          if (aborter.signal.aborted || !mounted.current) break;
          processed++;
          const message = cause instanceof Error ? cause.message : 'Recherche impossible.';
          updateRow(index, { status: 'error', error: message });
          if (cause instanceof YouTubeError && ['not-configured', 'quota', 'api', 'network'].includes(cause.code)) {
            setError(message);
            break;
          }
        }
        await pause(500, aborter.signal);
      }
      if (mounted.current) setNotice(aborter.signal.aborted ? 'Recherche arrêtée. Les correspondances déjà trouvées sont conservées.' : `${found} suggestion${found > 1 ? 's' : ''} trouvée${found > 1 ? 's' : ''} sur ${processed} recherche${processed > 1 ? 's' : ''}. Vérifie les titres avant l’import.`);
    } catch (cause) {
      if (mounted.current && cause instanceof Error && cause.name !== 'AbortError') setError(cause.message);
      else if (mounted.current) setNotice('Recherche arrêtée. Les correspondances déjà trouvées sont conservées.');
    } finally {
      if (mounted.current) {
        setRows((current) => current.map((row) => row.status === 'matching' ? { ...row, status: 'pending' } : row));
        setBusy(false);
      }
      controller.current = null;
    }
  }

  function showPreview() {
    const resource = parseSpotifyUrl(link);
    setError('');
    if (!resource) { setError('Colle un lien HTTPS open.spotify.com vers un titre, un album ou une playlist.'); setPreview(null); return; }
    setPreview(resource);
  }

  function importSelection() {
    const unique = [...new Map(selected.flatMap((row) => row.track ? [[row.track.id, row.track] as const] : [])).values()];
    if (!unique.length || !name.trim()) return;
    onImport(name.trim().slice(0, 80), unique);
    onClose();
  }

  return <Dialog title="Retrouver ma musique Spotify" onClose={() => { controller.current?.abort(); onClose(); }}>
    <div className="spotify-import">
      <p className="muted">Garde tes découvertes : consulte un lien Spotify ou retrouve les titres d’un export CSV sur YouTube. Tes comptes ne sont pas liés.</p>
      <div className="import-tabs" role="tablist" aria-label="Méthode Spotify" style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button type="button" role="tab" aria-selected={tab === 'csv'} className={tab === 'csv' ? 'primary-button' : 'secondary-button'} onClick={() => { setTab('csv'); setPreview(null); setError(''); }}><FileUp size={16}/>Importer un CSV</button>
        <button type="button" role="tab" aria-selected={tab === 'link'} className={tab === 'link' ? 'primary-button' : 'secondary-button'} disabled={busy} onClick={() => { setTab('link'); setError(''); }}><Link size={16}/>Lien Spotify</button>
      </div>
      {tab === 'link' ? <section className="spotify-preview" aria-label="Aperçu Spotify">
        <label className="field">Lien Spotify<input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://open.spotify.com/playlist/…" type="url" maxLength={1000}/></label>
        <button className="primary-button" onClick={showPreview}>Afficher le lecteur Spotify</button>
        <p className="muted">Le lecteur officiel suit les conditions de Spotify : connexion, abonnement ou extraits selon le contenu. Ce lien seul n’importe pas la liste des titres dans Thrum. Utilise un CSV pour créer une playlist locale.</p>
        {preview && <iframe title="Lecteur Spotify officiel" src={preview.embedUrl} width="100%" height={preview.type === 'track' ? 152 : 352} style={{ border: 0, borderRadius: 14 }} allow="clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" referrerPolicy="strict-origin-when-cross-origin"/>}
      </section> : <section aria-label="Import CSV Spotify">
        <p className="muted">Sélectionne un export CSV au format Exportify avec les colonnes <strong>Track Name</strong> et <strong>Artist Name(s)</strong>. Maximum : 500 titres, 5 Mo. Le CSV reste sur ton appareil ; seuls les noms cherchés sont envoyés à YouTube.</p>
        <label className="secondary-button" style={{ display: 'inline-flex', cursor: busy ? 'default' : 'pointer', marginBottom: 16 }}><FileUp size={16}/>Choisir un fichier CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={readFile} style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}/></label>
        {rows.length > 0 && <>
          <label className="field">Nom de la nouvelle playlist<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ma playlist Spotify"/></label>
          <div className="import-actions" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
            <label>Lot de <select value={batchSize} disabled={busy} onChange={(event) => setBatchSize(Number(event.target.value))} aria-label="Nombre de recherches par lot"><option value={10}>10 titres</option><option value={20}>20 titres</option><option value={50}>50 titres</option></select></label>
            {busy ? <button className="secondary-button" onClick={() => controller.current?.abort()}><Square size={14}/>Arrêter</button> : <button className="primary-button" disabled={pending === 0} onClick={matchBatch}><Search size={16}/>Chercher {Math.min(batchSize, pending)} correspondances</button>}
            {!busy && failed > 0 && <button className="text-button" onClick={() => { setRows((current) => current.map((row) => row.status === 'error' ? { ...row, status: 'pending', error: undefined } : row)); setError(''); }}>Réessayer les {failed} échecs</button>}
          </div>
          <p className="muted">Chaque recherche coûte 100 unités de quota YouTube, soit jusqu’à {Math.min(batchSize, pending) * 100} unités pour ce lot. Le premier résultat est une <strong>suggestion automatique</strong>, pas une correspondance vérifiée. Décoche les versions incorrectes. {apiKey.trim() ? 'Ta clé personnelle sera utilisée.' : 'La clé configurée sur le serveur sera utilisée ; si elle manque, configure une clé dans les réglages.'}</p>
          <p aria-live="polite">{rows.length} titres · {matched} suggestions · {pending} en attente · {selected.length} sélectionnés</p>
          <div className="import-rows" style={{ maxHeight: 310, overflowY: 'auto', border: '1px solid var(--border, #2a2a33)', borderRadius: 12 }}>
            {rows.map((row, index) => <div className="import-row" key={`${index}-${row.source.title}`} style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'flex-start', borderBottom: '1px solid var(--border, #2a2a33)' }}>
              <input type="checkbox" checked={row.selected} disabled={!row.track} onChange={(event) => updateRow(index, { selected: event.target.checked })} aria-label={`Importer ${row.source.title}`} style={{ marginTop: 5 }}/>
              <div style={{ minWidth: 0, flex: 1 }}><strong>{row.source.title}</strong><div className="muted">{row.source.artist}</div>
                <div className="import-status" style={{ fontSize: 12, marginTop: 5 }}>
                  {row.status === 'pending' && 'En attente de recherche'}
                  {row.status === 'matching' && <><LoaderCircle size={13}/> Recherche en cours…</>}
                  {row.status === 'error' && <><X size={13}/> {row.error}</>}
                  {row.track && <><Check size={13}/> Suggestion : {row.track.title} · {row.track.artist} <a href={`https://www.youtube.com/watch?v=${row.track.id}`} target="_blank" rel="noreferrer" aria-label={`Vérifier la suggestion pour ${row.source.title}`}><ExternalLink size={13}/></a></>}
                </div>
              </div>
            </div>)}
          </div>
          <button className="primary-button" style={{ marginTop: 18 }} disabled={busy || selected.length === 0 || !name.trim()} onClick={importSelection}>Créer la playlist avec {selected.length} titre{selected.length > 1 ? 's' : ''}</button>
          <p className="muted">Import ponctuel dans Thrum. Les modifications faites ensuite dans Spotify ne sont pas synchronisées.</p>
        </>}
      </section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="muted" role="status">{notice}</p>}
    </div>
  </Dialog>;
}
