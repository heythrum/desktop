import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, ChevronRight, Clock3, Disc3, Download, Ellipsis, ExternalLink, Heart, House, Library, ListMusic, LoaderCircle, Music2, Pause, Play, Plus, Radio, Repeat, Repeat1, Search, Settings2, ShieldCheck, Shuffle, SkipBack, SkipForward, Sparkles, Trash2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { Dialog } from './components/Dialog';
import { AlternativeVersions } from './components/AlternativeVersions';
import { SetupPanel } from './components/SetupPanel';
import { AccountPanel } from './components/AccountPanel';
import { useCloudSync } from './hooks/useCloudSync';
import { YouTubePlayer, type PlayerHandle } from './components/YouTubePlayer';
import { SpotifyImport } from './components/SpotifyImport';
import { LyricsPanel } from './components/LyricsPanel';
import { createPlaylistShareUrl, decodeSharedPlaylist } from './lib/share';
import { SEED_TRACKS } from './lib/catalog';
import { createInitialState, exportLibrary, loadLibrary, makeId, parseLibraryBackup, saveLibrary } from './lib/library';
import { getVideoMetadata, parseYouTubeId, searchYouTube } from './lib/youtube';
import type { LibraryState, Playlist, Track } from './lib/types';

type View = 'home' | 'search' | 'library' | 'favorites' | 'history' | 'playlist';
type Modal = 'create' | 'import' | 'settings' | 'backup' | 'clear' | 'delete' | 'rename' | 'spotify' | 'share' | 'account' | 'setup' | null;
const API_KEY_STORAGE = 'thrum.youtube-key';
function readKey() { try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch { return ''; } }
function imageFallback(event: SyntheticEvent<HTMLImageElement>) { const image = event.currentTarget; if (!image.src.endsWith('/cover.svg')) image.src = `${import.meta.env.BASE_URL}cover.svg`; }
function formatTime(seconds: number) { const n = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
const mixDetails = [
  { label: 'À tête reposée', description: 'On ralentit. On respire. On écoute.', theme: 'mint', icon: '◒', filter: 'calm' },
  { label: 'Après minuit', description: 'La nuit a sa propre bande-son.', theme: 'purple', icon: '✳', filter: 'night' },
  { label: 'Le volume monte', description: 'Un peu plus fort, un peu plus loin.', theme: 'orange', icon: '↗', filter: 'energy' },
];

export default function App() {
  const [library, setLibrary] = useState<LibraryState>(() => loadLibrary());
  const [view, setView] = useState<View>('home');
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [key, setKey] = useState(readKey);
  const [keyDraft, setKeyDraft] = useState(key);
  const [modal, setModal] = useState<Modal>(() => {
    try { return window.location.port === '43197' && !localStorage.getItem('thrum.setup.v1') ? 'setup' : null; } catch { return null; }
  });
  const [playlistName, setPlaylistName] = useState('');
  const [importURL, setImportURL] = useState('');
  const [importing, setImporting] = useState(false);
  const [formError, setFormError] = useState('');
  const [addTrack, setAddTrack] = useState<Track | null>(null);
  const [toast, setToast] = useState('');
  const [storageError, setStorageError] = useState('');
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  const [tab, setTab] = useState<'queue' | 'lyrics' | 'about'>('queue');
  const [mix, setMix] = useState('all');
  const [shareUrl, setShareUrl] = useState('');
  const [blockedTrack, setBlockedTrack] = useState<Track | null>(null);
  const [sharedPlaylist, setSharedPlaylist] = useState<{name: string; tracks: Track[]} | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const player = useRef<PlayerHandle>(null);
  const abortSearch = useRef<AbortController | null>(null);
  const stateRef = useRef(library); stateRef.current = library;
  const current = library.tracks.find(track => track.id === library.currentTrackId) || null;
  const playlist = library.playlists.find(item => item.id === selectedPlaylist);
  const notify = useCallback((message: string) => setToast(message), []);
  const replaceFromCloud = useCallback((state: LibraryState) => {
    setPlaying(false); setActiveVideo(null); setTime(0); setDuration(0); setLibrary(state);
  }, []);
  const cloud = useCloudSync(library, replaceFromCloud);
  useEffect(() => { if (cloud.recovery) setModal('account'); }, [cloud.recovery]);

  useEffect(() => { try { if (!saveLibrary(library)) throw new Error('Storage unavailable'); setStorageError(''); } catch { setStorageError('Le stockage local est indisponible ou plein. Exportez une sauvegarde pour conserver vos playlists.'); } }, [library]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => () => abortSearch.current?.abort(), []);
  useEffect(() => {
    function readShared() {
      try { setSharedPlaylist(decodeSharedPlaylist(window.location.hash)); }
      catch (error) { notify(error instanceof Error ? error.message : 'Lien de partage invalide.'); }
    }
    readShared(); window.addEventListener('hashchange', readShared);
    return () => window.removeEventListener('hashchange', readShared);
  }, [notify]);
  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(element.tagName) || element.isContentEditable || document.querySelector('dialog[open]')) return;
      if (event.key === '/') { event.preventDefault(); searchInput.current?.focus(); }
      if (event.code === 'Space' && element === document.body && stateRef.current.currentTrackId) { event.preventDefault(); setActiveVideo(stateRef.current.currentTrackId); setPlaying(value => !value); }
    }
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, []);

  function navigate(next: View, id?: string) { setView(next); if (id) setSelectedPlaylist(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function openModal(next: Modal) { setFormError(''); setPlaylistName(next === 'rename' ? playlist?.name || '' : ''); setImportURL(''); setKeyDraft(key); if (next === 'spotify') setPlaying(false); setModal(next); }
  function registerTrack(state: LibraryState, track: Track) { return state.tracks.some(item => item.id === track.id) ? state.tracks : [...state.tracks, track]; }
  function playTrack(track: Track, list?: Track[]) {
    setLibrary(state => {
      const tracks = [...state.tracks];
      for (const item of list || [track]) if (!tracks.some(t => t.id === item.id)) tracks.push(item);
      if (!tracks.some(t => t.id === track.id)) tracks.push(track);
      return { ...state, tracks, currentTrackId: track.id, queue: list?.length ? [...new Set(list.map(item => item.id))] : state.queue.includes(track.id) ? state.queue : [...state.queue, track.id], recent: [track.id, ...state.recent.filter(id => id !== track.id)].slice(0, 100) };
    });
    setTime(0); setDuration(0); setActiveVideo(track.id); setPlaying(true);
  }
  function togglePlay() { if (current) { setActiveVideo(current.id); setPlaying(value => !value); } else if (library.tracks[0]) playTrack(library.tracks[0], library.tracks); }
  const advance = useCallback((direction = 1, ended = false) => {
    const state = stateRef.current;
    if (ended && state.repeat === 'one') { player.current?.seek(0); player.current?.resume(); setPlaying(true); return; }
    const ids = state.queue.length ? state.queue : state.tracks.map(item => item.id);
    if (!ids.length) return;
    const index = ids.indexOf(state.currentTrackId || '');
    let next = index + direction;
    if (state.shuffle && ids.length > 1 && direction === 1) {
      const choices = ids.filter(id => id !== state.currentTrackId);
      next = ids.indexOf(choices[Math.floor(Math.random() * choices.length)]);
    }
    if (next >= ids.length && ended && state.repeat === 'off') { setPlaying(false); return; }
    next = (next + ids.length) % ids.length;
    const id = ids[next];
    setLibrary(previous => ({ ...previous, currentTrackId: id, recent: [id, ...previous.recent.filter(item => item !== id)].slice(0, 100) }));
    setTime(0); setDuration(0); setActiveVideo(id); setPlaying(true);
  }, []);
  function favorite(track: Track) {
    const wasFavorite = library.favorites.includes(track.id);
    setLibrary(state => ({ ...state, tracks: registerTrack(state, track), favorites: state.favorites.includes(track.id) ? state.favorites.filter(id => id !== track.id) : [...state.favorites, track.id] }));
    notify(wasFavorite ? 'Titre retiré des favoris' : 'Titre ajouté aux favoris');
  }
  function enqueue(track: Track) {
    setLibrary(state => ({ ...state, tracks: registerTrack(state, track), queue: [...state.queue.filter(id => id !== track.id), track.id] }));
    notify('Titre ajouté à la file d’attente');
  }
  async function search(event?: FormEvent) {
    event?.preventDefault();
    const value = query.trim();
    if (!value) { searchInput.current?.focus(); return; }
    if (parseYouTubeId(value)) { setImportURL(value); setModal('import'); return; }
    abortSearch.current?.abort();
    const controller = new AbortController(); abortSearch.current = controller;
    setView('search'); setSearching(true); setSearchError(''); setResults([]); setSearchedQuery(value);
    try { const items = await searchYouTube(value, key, controller.signal); if (!controller.signal.aborted) setResults(items); }
    catch (error) { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : 'Recherche indisponible. Réessayez.'); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  async function importVideo(event: FormEvent) {
    event.preventDefault();
    const id = parseYouTubeId(importURL);
    if (!id) { setFormError('Collez un lien YouTube valide (vidéo, Shorts ou youtu.be).'); return; }
    setImporting(true); setFormError('');
    let track: Track;
    try { track = await getVideoMetadata(id); }
    catch { track = { id, title: `Vidéo YouTube · ${id}`, artist: 'YouTube', thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }; }
    setLibrary(state => ({ ...state, tracks: registerTrack(state, track) }));
    setImporting(false); setModal(null); playTrack(track); notify('Vidéo ajoutée à votre bibliothèque');
  }
  function createPlaylist(event: FormEvent) {
    event.preventDefault(); const name = playlistName.trim();
    if (!name || name.length > 80) { setFormError('Choisissez un nom entre 1 et 80 caractères.'); return; }
    if (modal === 'rename' && playlist) {
      setLibrary(state => ({ ...state, playlists: state.playlists.map(item => item.id === playlist.id ? { ...item, name } : item) }));
      notify('Playlist renommée');
    } else {
      const newPlaylist: Playlist = { id: makeId(), name, trackIds: addTrack ? [addTrack.id] : [], createdAt: Date.now() };
      setLibrary(state => ({ ...state, tracks: addTrack ? registerTrack(state, addTrack) : state.tracks, playlists: [...state.playlists, newPlaylist] }));
      setAddTrack(null); navigate('playlist', newPlaylist.id); notify('Votre playlist est créée');
    }
    setModal(null);
  }
  function addToPlaylist(id: string) {
    if (!addTrack) return;
    setLibrary(state => ({ ...state, tracks: registerTrack(state, addTrack), playlists: state.playlists.map(item => item.id === id ? { ...item, trackIds: [...new Set([...item.trackIds, addTrack.id])] } : item) }));
    setAddTrack(null); notify('Titre ajouté à la playlist');
  }
  function importPlaylist(name: string, tracks: Track[]) {
    const item: Playlist = { id: makeId(), name, trackIds: tracks.map(track => track.id), createdAt: Date.now() };
    setLibrary(state => ({ ...state, tracks: [...new Map([...state.tracks, ...tracks].map(track => [track.id, track])).values()], playlists: [...state.playlists, item] }));
    navigate('playlist', item.id); notify('Playlist ajoutée à votre bibliothèque');
  }
  function sharePlaylist() {
    if (!playlist) return;
    try { setShareUrl(createPlaylistShareUrl(playlist.name, resolveTracks(playlist.trackIds), window.location.origin)); setModal('share'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Le partage a échoué.'); }
  }
  function closeShared() { setSharedPlaylist(null); history.replaceState(null, '', window.location.pathname + window.location.search); }
  function downloadBackup() {
    const blob = new Blob([exportLibrary(library)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `thrum-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Sauvegarde exportée');
  }
  async function restoreBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Le fichier dépasse la limite de 5 Mo.');
      const restored = parseLibraryBackup(await file.text());
      setLibrary(restored); setPlaying(false); setActiveVideo(null); setTime(0); setDuration(0); setModal(null); notify('Bibliothèque restaurée');
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Sauvegarde invalide.'); }
    if (importFile.current) importFile.current.value = '';
  }
  const tracksById = useMemo(() => new Map(library.tracks.map(track => [track.id, track])), [library.tracks]);
  const resolveTracks = (ids: string[]) => ids.map(id => tracksById.get(id)).filter((track): track is Track => !!track);
  const favorites = resolveTracks(library.favorites);
  const queue = resolveTracks(library.queue);
  const localMatches = library.tracks.filter(track => `${track.title} ${track.artist}`.toLowerCase().includes(searchedQuery.toLowerCase()));
  const featured = mix === 'all' ? SEED_TRACKS.slice(0, 6) : mix === 'calm' ? SEED_TRACKS.filter((_, i) => i % 3 === 0) : mix === 'night' ? SEED_TRACKS.filter((_, i) => i % 3 === 1) : SEED_TRACKS.filter((_, i) => i % 3 === 2);

  function trackList(tracks: Track[], removable = false) {
    if (!tracks.length) return <div className="empty-state"><Music2 size={32}/><h3>Le début d’une belle collection.</h3><p>Ajoutez un lien YouTube ou trouvez votre prochain coup de cœur.</p><button className="button primary" onClick={() => openModal('import')}><Plus size={16}/> Ajouter un titre</button></div>;
    return <div className="track-list"><div className="track-heading"><span>#</span><span>TITRE / ARTISTE</span><span className="source-heading">SOURCE</span><span> </span></div>{tracks.map((track, index) => {
      const isCurrent = current?.id === track.id;
      return <div className={`track-row ${isCurrent ? 'current' : ''}`} key={track.id}>
        <button className="row-play" aria-label={`Écouter ${track.title}`} onClick={() => isCurrent && activeVideo ? togglePlay() : playTrack(track, tracks)}>{isCurrent && playing ? <AudioLines size={17}/> : <><span className="row-number">{String(index + 1).padStart(2, '0')}</span><Play className="row-play-icon" size={15} fill="currentColor"/></>}</button>
        <button className="track-identity" onClick={() => playTrack(track, tracks)}><img onError={imageFallback} src={track.thumbnail} alt="" loading="lazy"/><span><strong>{track.title}</strong><small>{track.artist}</small></span></button>
        <span className="source-tag">YouTube</span>
        <div className="track-actions"><button className={`icon-button ${library.favorites.includes(track.id) ? 'liked' : ''}`} aria-label={library.favorites.includes(track.id) ? `Retirer ${track.title} des favoris` : `Ajouter ${track.title} aux favoris`} onClick={() => favorite(track)}><Heart size={16} fill={library.favorites.includes(track.id) ? 'currentColor' : 'none'}/></button><button className="icon-button" title="Ajouter à une playlist" aria-label={`Ajouter ${track.title} à une playlist`} onClick={() => setAddTrack(track)}><Plus size={17}/></button><button className="icon-button secondary-action" title="Ajouter à la file" aria-label={`Mettre ${track.title} dans la file`} onClick={() => enqueue(track)}><ListMusic size={16}/></button>{removable && playlist && <button className="icon-button" aria-label={`Retirer ${track.title} de cette playlist`} onClick={() => setLibrary(state => ({ ...state, playlists: state.playlists.map(item => item.id === playlist.id ? { ...item, trackIds: item.trackIds.filter(id => id !== track.id) } : item) }))}><X size={16}/></button>}</div>
      </div>;
    })}</div>;
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('home'); }} aria-label="Thrum, accueil"><span className="brand-mark"><AudioLines size={25}/></span>thrum<span className="brand-dot">.</span></a>
      <p className="sidebar-label">VOTRE ESPACE MUSICAL</p>
      <nav className="main-nav" aria-label="Navigation principale">
        {[{ id: 'home', label: 'Découvrir', icon: House }, { id: 'library', label: 'Ma bibliothèque', icon: Library }, { id: 'favorites', label: 'Mes favoris', icon: Heart }, { id: 'history', label: 'Écoutes récentes', icon: Clock3 }].map(item => <button key={item.id} aria-label={item.label} title={item.label} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id as View)}><item.icon size={19}/><span>{item.label}</span>{item.id === 'favorites' && library.favorites.length > 0 && <small>{library.favorites.length}</small>}</button>)}
      </nav>
      <button className="spotify-nav" onClick={() => openModal('spotify')}><Disc3 size={17}/><span>Importer de Spotify</span><ArrowRight size={13}/></button><div className="playlist-sidebar"><div className="sidebar-section-title"><span>MES PLAYLISTS</span><button className="icon-button" aria-label="Créer une playlist" onClick={() => openModal('create')}><Plus size={17}/></button></div>
        {library.playlists.map((item, index) => <button className={`sidebar-playlist ${view === 'playlist' && selectedPlaylist === item.id ? 'selected' : ''}`} key={item.id} onClick={() => navigate('playlist', item.id)}><span className={`playlist-icon color-${index % 3}`}><ListMusic size={16}/></span><span>{item.name}<small>{item.trackIds.length} titre{item.trackIds.length !== 1 ? 's' : ''}</small></span></button>)}
        {!library.playlists.length && <p className="sidebar-empty">Vos prochaines obsessions,<br/>bien rangées ici.</p>}
      </div>
      <div className="sidebar-bottom"><button className="settings-nav" aria-label="Configurer Thrum" title="Configurer Thrum" onClick={() => openModal('setup')}><Settings2 size={18}/> Configurer Thrum</button><div className="local-note"><ShieldCheck size={17}/><span>Votre musique, votre espace.<small>{cloud.user ? (cloud.status === 'synced' ? 'Bibliothèque synchronisée.' : 'Synchronisation à vérifier.') : 'Local ou synchronisé avec votre compte.'}</small></span></div><button className="settings-nav" aria-label="Paramètres" onClick={() => openModal('settings')}><Settings2 size={18}/> Paramètres <span className="local-avatar">{cloud.user?.email?.slice(0, 1).toUpperCase() || 'T'}</span></button></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="location"><span className="status-dot"/> L’ESPACE EST À VOUS</div><form className="search-form" onSubmit={search}><Search size={18}/><input ref={searchInput} aria-label="Rechercher une musique" value={query} onChange={event => setQuery(event.target.value)} placeholder="Un titre, un artiste, un lien YouTube…" maxLength={200}/><kbd>/</kbd><button aria-label="Lancer la recherche" type="submit"><ArrowRight size={18}/></button></form><button className={`account-nav ${cloud.user ? 'signed-in' : ''}`} aria-label="Compte et synchronisation" title="Compte et synchronisation" onClick={() => openModal('account')}><ShieldCheck size={18}/><span>{cloud.user ? 'Mon compte' : 'Se connecter'}</span>{cloud.user && <i className={cloud.status === 'synced' ? 'synced' : 'pending'}/>}</button><button className="topbar-add icon-button" aria-label="Ajouter un lien YouTube" onClick={() => openModal('import')}><Plus size={21}/></button></header>
      {storageError && <div className="notice error" role="alert">{storageError}<button onClick={downloadBackup}>Exporter</button></div>}
      <div className="content-grid"><main id="main-content">
        {view === 'home' && <>
          <div className="page-heading"><div><p className="eyebrow">BIENVENUE CHEZ VOUS</p><h1>Dans votre élément<span>.</span></h1></div><span className="edition-tag">THRUM / VOL. 01</span></div>
          <section className="hero"><div className="hero-copy"><span className="pill"><span/> VOTRE NOUVELLE FRÉQUENCE</span><h2>La musique.<br/><span>Sans détour.</span></h2><p>Vos découvertes, vos coups de cœur.<br/>Un seul endroit pour vibrer.</p><div className="hero-buttons"><button className="button light" onClick={() => playTrack(SEED_TRACKS[0], SEED_TRACKS)}><Play size={16} fill="currentColor"/> Lancer la sélection</button><button className="hero-link" onClick={() => openModal('import')}>Ajouter un lien <ArrowRight size={15}/></button></div><span className="hero-footnote">UNE SÉLECTION POUR OUVRIR GRAND LES OREILLES</span></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="vinyl"><div className="vinyl-label"><AudioLines size={30}/><span>thrum records<br/>SIDE A / 001</span></div></div><span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✦</span><div className="art-caption">GOOD MUSIC.<br/>GREAT FEELING.</div></div></section>
          <section className="moods"><div className="section-heading"><h2>À chaque humeur, sa fréquence</h2><span>CHOISISSEZ VOTRE VIBE</span></div><div className="mix-grid">{mixDetails.map(item => <button key={item.filter} className={`mix-card ${item.theme} ${mix === item.filter ? 'chosen' : ''}`} onClick={() => setMix(value => value === item.filter ? 'all' : item.filter)}><span className="mix-symbol">{item.icon}</span><div><h3>{item.label}</h3><p>{item.description}</p></div><span className="mix-arrow"><ArrowRight size={17}/></span></button>)}</div></section>
          <section><div className="section-heading"><h2>{mix === 'all' ? 'À mettre sur repeat' : mixDetails.find(item => item.filter === mix)?.label}<span className="small-dot"/></h2><button className="text-link" onClick={() => { setMix('all'); navigate('library'); }}>Tout voir <ArrowRight size={14}/></button></div><div className="album-grid">{featured.map((track, index) => <article className="album-card" key={track.id}><button className={`album-cover cover-${index % 4}`} aria-label={`Écouter ${track.title}`} onClick={() => playTrack(track, featured)}><img onError={imageFallback} src={track.thumbnail} alt={`Illustration de ${track.title}`} loading="lazy"/><span className="cover-shade"/><span className="cover-type">{index % 2 ? 'ON REPEAT' : 'THE SELECTION'}<b>{String(index + 1).padStart(2, '0')}</b></span><span className="cover-play"><Play size={20} fill="currentColor"/></span></button><h3><button onClick={() => playTrack(track, featured)}>{track.title}</button></h3><p>{track.artist}</p></article>)}</div></section>
          <section className="home-tracks"><div className="section-heading"><h2>De bonnes ondes, tout simplement</h2><button className="text-link" onClick={() => openModal('import')}>Ajouter un titre <Plus size={15}/></button></div>{trackList(SEED_TRACKS.slice(0, 5))}</section>
          <div className="page-footer"><span><AudioLines size={16}/> THRUM.UNO</span><span>Fait pour écouter. Pensé pour vous.</span><button onClick={() => openModal('settings')}>Confidentialité & paramètres <ArrowRight size={12}/></button></div>
        </>}

        {view === 'search' && <><div className="page-heading"><div><p className="eyebrow">TROUVEZ VOTRE PROCHAINE OBSESSION</p><h1>« {searchedQuery} »</h1></div></div>{searching ? <div className="empty-state" role="status"><LoaderCircle className="spin"/><h3>À l’écoute de YouTube…</h3><p>Recherche des vidéos disponibles en lecture intégrée.</p></div> : searchError ? <><div className="notice error"><h3>La recherche n’est pas disponible</h3><p>{searchError}</p><div className="button-row"><button className="button primary" onClick={() => openModal('settings')}><Settings2 size={16}/> Configurer la recherche</button><button className="button secondary" onClick={() => openModal('import')}>Ajouter un lien YouTube</button></div></div>{localMatches.length > 0 && <><div className="section-heading"><h2>Dans votre bibliothèque</h2><span>{localMatches.length} titre(s)</span></div>{trackList(localMatches)}</>}</> : <><div className="section-heading"><h2>Résultats YouTube</h2><span>{results.length} titre(s)</span></div>{results.length ? trackList(results) : <div className="empty-state"><Search size={32}/><h3>Aucun titre trouvé.</h3><p>Essayez un autre titre ou un autre artiste.</p></div>}<p className="muted fine-print">Résultats fournis par YouTube. Certaines vidéos peuvent devenir indisponibles selon le pays ou leur auteur.</p></>}</>}

        {(view === 'library' || view === 'favorites' || view === 'history' || view === 'playlist') && <>
          <div className={`collection-header ${view === 'favorites' ? 'favorites-header' : ''}`}><div className="collection-art">{view === 'favorites' ? <Heart size={58} fill="currentColor"/> : view === 'history' ? <Clock3 size={58}/> : <ListMusic size={58}/>}</div><div><p className="eyebrow">{view === 'playlist' ? 'VOTRE PLAYLIST' : 'VOTRE ESPACE'}</p><h1>{view === 'favorites' ? 'Les coups de cœur' : view === 'history' ? 'Tout juste écoutés' : view === 'playlist' ? playlist?.name || 'Playlist introuvable' : 'Ma bibliothèque'}</h1><p>{view === 'favorites' ? `${favorites.length} titre(s) qui restent.` : view === 'history' ? `${library.recent.length} écoute(s) récente(s)` : view === 'playlist' ? `${playlist?.trackIds.length || 0} titre(s) · Enregistrée sur cet appareil` : `${library.tracks.length} titres · ${library.playlists.length} playlists · 100 % votre espace`}</p></div></div>
          <div className="collection-toolbar"><button className="button primary" onClick={() => { const tracks = view === 'favorites' ? favorites : view === 'history' ? resolveTracks(library.recent) : view === 'playlist' ? resolveTracks(playlist?.trackIds || []) : library.tracks; if (tracks[0]) playTrack(tracks[0], tracks); else notify('Ajoutez un premier titre pour lancer la lecture.'); }}><Play size={17} fill="currentColor"/> Tout écouter</button><button className="button secondary" onClick={() => openModal('import')}><Plus size={16}/> Ajouter un titre</button>{view === 'playlist' && playlist && <><button className="button secondary" onClick={sharePlaylist}>Partager <ExternalLink size={14}/></button><button className="icon-button" aria-label="Renommer la playlist" title="Renommer" onClick={() => openModal('rename')}><Ellipsis size={21}/></button><button className="icon-button" aria-label="Supprimer la playlist" onClick={() => openModal('delete')}><Trash2 size={18}/></button></>}</div>
          {view === 'library' && <div className="library-import-actions"><button className="button secondary" onClick={() => openModal('spotify')}><Disc3 size={16}/> Importer de Spotify</button><button className="text-link" onClick={() => openModal('backup')}>Importer une sauvegarde <Upload size={14}/></button></div>}{view === 'library' && <div className="library-playlists">{library.playlists.map((item, index) => <button className={`library-playlist color-${index % 3}`} key={item.id} onClick={() => navigate('playlist', item.id)}><ListMusic size={28}/><strong>{item.name}</strong><span>{item.trackIds.length} titres <ArrowRight size={14}/></span></button>)}<button className="library-playlist new-playlist" onClick={() => openModal('create')}><Plus size={28}/><strong>Une nouvelle playlist</strong><span>À votre image</span></button></div>}
          {trackList(view === 'favorites' ? favorites : view === 'history' ? resolveTracks(library.recent) : view === 'playlist' ? resolveTracks(playlist?.trackIds || []) : library.tracks, view === 'playlist')}
        </>}
      </main>

      <aside className="right-panel" aria-label="Lecteur et file d’attente"><div className="right-heading"><span>EN ÉCOUTE</span><span className={`live-indicator ${playing ? 'live' : ''}`}>{playing ? 'LIVE' : 'THRUM'}</span></div><YouTubePlayer ref={player} videoId={activeVideo} playing={playing} volume={library.volume} onPlaying={setPlaying} onEnded={() => advance(1, true)} onProgress={(t, d) => { setTime(t); setDuration(d); }} onError={(message, code) => { notify(message); if ([100, 101, 150].includes(code || 0) && current) setBlockedTrack(current); }}/><div className="now-details"><div><h3>{current?.title || 'Place à la musique.'}</h3><p>{current?.artist || 'Choisissez un titre pour commencer'}</p></div>{current && <button className={`icon-button ${library.favorites.includes(current.id) ? 'liked' : ''}`} aria-label="Favori du titre en cours" onClick={() => favorite(current)}><Heart size={19} fill={library.favorites.includes(current.id) ? 'currentColor' : 'none'}/></button>}</div><div className="listening-note"><span className="tiny-bars"><i/><i/><i/><i/></span><span>Lecture via YouTube</span><ShieldCheck size={13}/></div>
        <div className="panel-tabs"><button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>À suivre <span>{queue.length}</span></button><button className={tab === 'lyrics' ? 'active' : ''} onClick={() => setTab('lyrics')}>Paroles</button><button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>À propos</button></div>
        {tab === 'queue' ? <div className="queue-list">{queue.length ? queue.map((track, i) => <div className={`queue-item ${current?.id === track.id ? 'selected' : ''}`} key={track.id}><button onClick={() => playTrack(track)} aria-label={`Lire ${track.title}`}><span className="queue-number">{current?.id === track.id && playing ? <AudioLines size={14}/> : String(i + 1).padStart(2, '0')}</span><img onError={imageFallback} src={track.thumbnail} alt="" loading="lazy"/><span><strong>{track.title}</strong><small>{track.artist}</small></span></button><button className="icon-button" aria-label={`Enlever ${track.title} de la file`} onClick={() => setLibrary(state => ({ ...state, queue: state.queue.filter(id => id !== track.id) }))}><X size={13}/></button></div>) : <div className="queue-empty"><ListMusic size={25}/><p>Les bonnes choses<br/>arrivent à la suite.</p><small>Ajoutez des titres avec <ListMusic size={12}/></small></div>}</div> : tab === 'lyrics' ? <LyricsPanel track={current} time={time} onSeek={seconds => player.current?.seek(seconds)}/> : <div className="about-panel"><h3>Votre petite bulle musicale.</h3><p>Thrum réunit vos vidéos musicales YouTube et vos playlists dans un espace à vous.</p><p>Votre bibliothèque reste dans ce navigateur. Pensez à la sauvegarder pour la retrouver ailleurs.</p><button className="text-link" onClick={() => openModal('backup')}>Gérer mes sauvegardes <ArrowRight size={14}/></button></div>}
        <div className="discovery-note"><span>✦</span><h3>Un lien. Une découverte.</h3><p>Un titre en tête ? Collez son lien YouTube et laissez-le jouer.</p><button onClick={() => openModal('import')}>Ajouter une vidéo <ArrowRight size={15}/></button></div>
      </aside></div>
    </div>

    <footer className="player-bar" aria-label="Commandes de lecture"><div className="player-track">{current ? <><img onError={imageFallback} src={current.thumbnail} alt=""/><div><strong>{current.title}</strong><small>{current.artist}</small></div><button className={`icon-button ${library.favorites.includes(current.id) ? 'liked' : ''}`} aria-label="Ajouter ou retirer le favori en cours" onClick={() => favorite(current)}><Heart size={17} fill={library.favorites.includes(current.id) ? 'currentColor' : 'none'}/></button></> : <><div className="idle-art"><AudioLines size={24}/></div><div><strong>À vous de donner le ton.</strong><small>Choisissez votre premier titre</small></div></>}</div><div className="player-center"><div className="playback-controls"><button className={`icon-button small ${library.shuffle ? 'enabled' : ''}`} aria-label="Lecture aléatoire" aria-pressed={library.shuffle} onClick={() => setLibrary(state => ({ ...state, shuffle: !state.shuffle }))}><Shuffle size={16}/></button><button className="icon-button" aria-label="Titre précédent" disabled={!current} onClick={() => time > 3 ? player.current?.seek(0) : advance(-1)}><SkipBack size={19} fill="currentColor"/></button><button className="main-play" aria-label={playing ? 'Mettre en pause' : 'Lancer la lecture'} onClick={togglePlay}>{playing ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button className="icon-button" aria-label="Titre suivant" disabled={!current} onClick={() => advance(1)}><SkipForward size={19} fill="currentColor"/></button><button className={`icon-button small ${library.repeat !== 'off' ? 'enabled' : ''}`} aria-label={`Répétition : ${library.repeat === 'off' ? 'désactivée' : library.repeat === 'all' ? 'tous les titres' : 'un titre'}`} onClick={() => setLibrary(state => ({ ...state, repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off' }))}>{library.repeat === 'one' ? <Repeat1 size={17}/> : <Repeat size={17}/>}</button></div><div className="progress-control"><span>{formatTime(time)}</span><input type="range" aria-label="Position de lecture" min={0} max={duration || 1} step={1} value={Math.min(time, duration || 1)} disabled={!duration} onChange={event => { const t = Number(event.target.value); player.current?.seek(t); setTime(t); }} style={{ '--fill': `${duration ? time / duration * 100 : 0}%` } as React.CSSProperties}/><span>{formatTime(duration)}</span></div></div><div className="player-extra"><button className="icon-button" aria-label={library.volume ? 'Couper le son' : 'Activer le son'} onClick={() => setLibrary(state => ({ ...state, volume: state.volume ? 0 : 70 }))}>{library.volume ? <Volume2 size={19}/> : <VolumeX size={19}/>}</button><input type="range" aria-label="Volume" min={0} max={100} value={library.volume} onChange={event => setLibrary(state => ({ ...state, volume: Number(event.target.value) }))} style={{ '--fill': `${library.volume}%` } as React.CSSProperties}/><span className="player-divider"/><button className="icon-button" title="Sauvegarder la bibliothèque" aria-label="Sauvegarder la bibliothèque" onClick={() => openModal('backup')}><ArrowDownToLine size={18}/></button></div></footer>

    {blockedTrack && <AlternativeVersions track={blockedTrack} apiKey={key} onClose={() => setBlockedTrack(null)} onSelect={track => { setBlockedTrack(null); playTrack(track); }}/>}
    {modal === 'setup' && <SetupPanel initialKey={key} onSave={value => { try { if (value) localStorage.setItem(API_KEY_STORAGE, value); else localStorage.removeItem(API_KEY_STORAGE); setKey(value); setKeyDraft(value); return true; } catch { return false; } }} onClose={() => { try { localStorage.setItem('thrum.setup.v1', 'done'); } catch {} setModal(null); }}/>}
    {modal === 'account' && <AccountPanel cloud={cloud} onClose={() => setModal(null)}/>}
    {modal === 'spotify' && <SpotifyImport apiKey={key} onImport={importPlaylist} onClose={() => setModal(null)}/>}
    {modal === 'share' && <Dialog title="Les bonnes ondes se partagent" onClose={() => setModal(null)}><p>Ce lien contient une copie de votre playlist (50 titres maximum). Vos prochaines modifications ne seront pas synchronisées.</p><label htmlFor="share-url">Lien de partage</label><input id="share-url" readOnly value={shareUrl} onFocus={event => event.target.select()}/><button className="button primary full" onClick={() => { if (!navigator.clipboard) { notify('Sélectionnez le lien puis copiez-le avec Ctrl+C.'); return; } void navigator.clipboard.writeText(shareUrl).then(() => notify('Lien copié')).catch(() => notify('Sélectionnez le lien puis copiez-le avec Ctrl+C.')); }}>Copier le lien</button><p className="fine-print">Les liens vers thrum.uno fonctionneront une fois le site déployé et le domaine connecté. Aucune donnée n’est envoyée à un serveur pour créer ce lien.</p></Dialog>}
    {sharedPlaylist && <Dialog title="Une playlist vous attend" onClose={closeShared}><p><strong>{sharedPlaylist.name}</strong> · {sharedPlaylist.tracks.length} titres</p><p>Ajoutez cette copie à votre bibliothèque pour l’écouter. La lecture ne démarrera pas automatiquement.</p><button className="button primary full" onClick={() => { importPlaylist(sharedPlaylist.name, sharedPlaylist.tracks); closeShared(); }}>Ajouter à ma bibliothèque <Plus size={16}/></button></Dialog>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}<button className="icon-button" aria-label="Fermer la notification" onClick={() => setToast('')}><X size={14}/></button></div>}
    {(modal === 'create' || modal === 'rename') && <Dialog title={modal === 'rename' ? 'Renommer la playlist' : 'Une playlist à votre image'} onClose={() => setModal(null)}><form onSubmit={createPlaylist}><label htmlFor="playlist-name">Nom de la playlist</label><input id="playlist-name" autoFocus value={playlistName} onChange={event => setPlaylistName(event.target.value)} maxLength={80} placeholder="Les titres qui restent…" required/>{formError && <p className="form-error" role="alert">{formError}</p>}<button className="button primary full" type="submit">{modal === 'rename' ? 'Enregistrer' : 'Créer la playlist'} <ArrowRight size={16}/></button></form></Dialog>}
    {modal === 'import' && <Dialog title="Votre prochaine découverte" onClose={() => { if (!importing) setModal(null); }}><p>Collez le lien d’une vidéo YouTube. Pas besoin de clé API pour la lecture.</p><form onSubmit={importVideo}><label htmlFor="youtube-url">Lien YouTube</label><input id="youtube-url" autoFocus value={importURL} onChange={event => setImportURL(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" maxLength={2048} required disabled={importing}/>{formError && <p className="form-error" role="alert">{formError}</p>}<button className="button primary full" disabled={importing}>{importing ? <><LoaderCircle size={17} className="spin"/> Récupération de la vidéo…</> : <><Play size={16}/> Ajouter et écouter</>}</button></form><p className="fine-print">La vidéo sera lue avec le lecteur officiel YouTube. Sa disponibilité dépend de son auteur et de votre région.</p></Dialog>}
    {addTrack && modal !== 'create' && <Dialog title="Ajouter à une playlist" onClose={() => setAddTrack(null)}><p className="truncate">{addTrack.title}</p><div className="playlist-picker">{library.playlists.map(item => <button key={item.id} onClick={() => addToPlaylist(item.id)}><ListMusic size={19}/><span>{item.name}<small>{item.trackIds.length} titres</small></span>{item.trackIds.includes(addTrack.id) ? <Check size={18}/> : <Plus size={18}/>}</button>)}</div><button className="button secondary full" onClick={() => openModal('create')}><Plus size={17}/> Créer une playlist</button></Dialog>}
    {modal === 'settings' && <Dialog title="Votre Thrum, à votre façon" onClose={() => setModal(null)}><section className="settings-section"><h3><Search size={18}/> Recherche YouTube</h3><p>Sur le site hébergé, la recherche utilise la clé du serveur. Sur Windows ou un hébergement statique, vous pouvez renseigner votre propre clé YouTube Data API v3.</p><form onSubmit={event => { event.preventDefault(); try { if (keyDraft.trim()) localStorage.setItem(API_KEY_STORAGE, keyDraft.trim()); else localStorage.removeItem(API_KEY_STORAGE); setKey(keyDraft.trim()); notify('Configuration de recherche enregistrée'); } catch { notify('Impossible d’enregistrer la clé dans ce navigateur.'); } }}><label htmlFor="api-key">Clé API personnelle (facultative)</label><input id="api-key" type="password" autoComplete="off" value={keyDraft} onChange={event => setKeyDraft(event.target.value)} placeholder="AIza…" maxLength={200}/><p className="fine-print">Stockée uniquement sur cet appareil, hors des sauvegardes. Une clé côté navigateur est accessible localement : limitez-la à l’API YouTube et à vos sites autorisés.</p><button className="button primary" type="submit">Enregistrer</button></form><a className="text-link" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener noreferrer">Configurer YouTube Data API <ExternalLink size={13}/></a></section><section className="settings-section"><h3><ShieldCheck size={18}/> Votre bibliothèque, vos choix</h3><p>Votre musique reste disponible sur cet appareil. Avec un compte Thrum, vous pouvez synchroniser vos titres, favoris et playlists entre Windows et le site. Vous choisissez la version à conserver avant la première synchronisation. La lecture et les images contactent YouTube/Google ; leurs règles s’appliquent.</p><button className="button primary" onClick={() => openModal('account')}><ShieldCheck size={16}/> Compte et synchronisation</button><div className="button-row"><button className="button secondary" onClick={() => openModal('backup')}><Download size={15}/> Sauvegardes</button><button className="button danger" onClick={() => openModal('clear')}><Trash2 size={15}/> Réinitialiser</button></div></section><div className="settings-footer"><AudioLines size={18}/> Thrum · v1.0.2 <span>Fait pour écouter.</span></div></Dialog>}
    {modal === 'backup' && <Dialog title="Votre bibliothèque vous suit" onClose={() => setModal(null)}><p>Exportez vos playlists, favoris et titres dans un fichier JSON. Importer une sauvegarde remplace la bibliothèque de cet appareil.</p><div className="backup-stats"><span><strong>{library.tracks.length}</strong>titres</span><span><strong>{library.playlists.length}</strong>playlists</span><span><strong>{library.favorites.length}</strong>favoris</span></div><button className="button primary full" onClick={downloadBackup}><Download size={17}/> Exporter ma bibliothèque</button><input ref={importFile} type="file" accept=".json,application/json" className="sr-only" aria-label="Fichier de sauvegarde" onChange={event => void restoreBackup(event.target.files?.[0])}/><button className="button secondary full" onClick={() => importFile.current?.click()}><Upload size={17}/> Importer et remplacer ma bibliothèque</button>{formError && <p className="form-error" role="alert">{formError}</p>}<p className="fine-print">Votre clé API personnelle n’est jamais incluse dans ce fichier.</p></Dialog>}
    {(modal === 'clear' || modal === 'delete') && <Dialog title={modal === 'clear' ? 'Repartir d’une page blanche ?' : 'Supprimer cette playlist ?'} onClose={() => setModal(null)}><p>{modal === 'clear' ? 'Vos playlists, favoris et historique seront remplacés par la sélection initiale. Si la synchronisation est active, ce changement sera aussi sauvegardé dans votre compte. Exportez une sauvegarde si vous souhaitez les conserver.' : `La playlist « ${playlist?.name} » sera supprimée. Les titres resteront dans votre bibliothèque.`}</p><div className="button-row"><button className="button secondary" onClick={() => setModal(null)}>Annuler</button><button className="button danger" onClick={() => { if (modal === 'clear') { setLibrary(createInitialState()); setActiveVideo(null); setPlaying(false); setTime(0); setDuration(0); try { localStorage.removeItem(API_KEY_STORAGE); setKey(''); } catch { /* Local storage failure is reported by persistence effect. */ } navigate('home'); } else { setLibrary(state => ({ ...state, playlists: state.playlists.filter(item => item.id !== selectedPlaylist) })); navigate('library'); } setModal(null); notify(modal === 'clear' ? 'Votre espace a été réinitialisé' : 'Playlist supprimée'); }}>Confirmer {modal === 'clear' ? 'la réinitialisation' : 'la suppression'}</button></div></Dialog>}
  </div>;
}
