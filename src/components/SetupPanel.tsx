import { useState } from 'react';
import { Check, ExternalLink, KeyRound, LoaderCircle, Settings2 } from 'lucide-react';
import { Dialog } from './Dialog';
import { searchYouTube } from '../lib/youtube';

export function SetupPanel({ initialKey, onSave, onClose }: { initialKey: string; onSave: (key: string) => boolean; onClose: () => void }) {
  const [key, setKey] = useState(initialKey);
  const [family, setFamily] = useState(() => { try { return localStorage.getItem('thrum.family-filter') === 'true'; } catch { return false; } });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function testKey() {
    setBusy(true); setError(''); setMessage('');
    const aborter = new AbortController(); const timer = setTimeout(() => aborter.abort(), 12000);
    try { await searchYouTube('Daft Punk', key.trim(), aborter.signal); setMessage('La recherche répond correctement. Vous pouvez enregistrer cette clé.'); }
    catch (cause) { setError(cause instanceof Error && cause.name === 'AbortError' ? 'Le service met trop de temps à répondre.' : cause instanceof Error ? cause.message : 'La vérification a échoué.'); }
    finally { clearTimeout(timer); setBusy(false); }
  }
  return <Dialog title="Configurer Thrum" onClose={onClose}>
    <p>Un seul endroit pour préparer votre lecteur et retrouver les outils du site. Vous pourrez rouvrir cet écran depuis la barre latérale.</p>
    <section className="settings-section"><h3><KeyRound size={18}/> 1. Votre clé YouTube</h3><p>Une clé personnelle permet de rechercher des titres directement depuis cette application. Sans clé, vous pouvez déjà écouter les vidéos de la sélection et ajouter des liens YouTube.</p>
      <label htmlFor="setup-key">Clé YouTube Data API v3</label><input id="setup-key" type={show ? 'text' : 'password'} autoComplete="off" value={key} onChange={event => setKey(event.target.value)} maxLength={200} placeholder="AIza…"/>
      <div className="button-row" style={{marginTop: 14}}><button className="button secondary" onClick={() => setShow(value => !value)}>{show ? 'Masquer' : 'Afficher'}</button><button className="button secondary" disabled={busy || !key.trim()} onClick={() => void testKey()}>{busy ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>} Tester la clé</button><button className="button primary" onClick={() => { setError(''); if (onSave(key.trim())) setMessage('Clé enregistrée sur cet appareil.'); else setError('Le stockage local est indisponible.'); }}>Enregistrer la clé</button></div>
      <a className="text-link" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener noreferrer">Activer l’API YouTube et créer une clé <ExternalLink size={13}/></a><p className="fine-print">Le test utilise une recherche (habituellement 100 unités de quota). Cette clé reste sur cet appareil et ne sera jamais envoyée sur GitHub. Pour activer la recherche de tout le site, ajoutez YOUTUBE_API_KEY comme secret dans Cloudflare.</p>
    </section>
    <section className="settings-section"><h3>Contenu explicite et lecture</h3><label style={{display:'flex',alignItems:'center',gap:10}}><input type="checkbox" checked={family} onChange={event => { try { localStorage.setItem('thrum.family-filter', String(event.target.checked)); setFamily(event.target.checked); } catch { setError('Impossible d’enregistrer le filtre.'); } }}/> Activer le filtre familial</label><p>Le filtre familial est désactivé par défaut : Thrum ne masque pas volontairement les morceaux explicites. Cela ne supprime pas les restrictions d’âge, de région ou d’intégration de YouTube. Si une vidéo est refusée, Thrum propose de rechercher une autre version.</p></section>
    <section className="settings-section"><h3><Settings2 size={18}/> 2. Mettre le site à jour</h3><p>Le code de Thrum est dans heythrum/desktop. Avec GitHub Desktop, clonez ce dépôt, modifiez les fichiers puis utilisez Commit et Push. Si le dépôt est relié au Worker Cloudflare, le site est reconstruit après le push.</p><div className="button-row"><a className="button primary" href="https://desktop.github.com/download/" target="_blank" rel="noopener noreferrer">Installer GitHub Desktop <ExternalLink size={13}/></a><a className="button secondary" href="https://github.com/heythrum/desktop" target="_blank" rel="noopener noreferrer">Ouvrir le dépôt</a><a className="button secondary" href="https://github.com/heythrum/desktop/edit/main/src/config/public.ts" target="_blank" rel="noopener noreferrer">Modifier la configuration publique</a></div><p className="fine-print">L’édition sur GitHub demande votre connexion GitHub dans le navigateur. Le fichier public.ts contient uniquement l’URL et la clé publique Supabase. Les clés YouTube du serveur et les jetons restent dans les secrets Cloudflare/GitHub.</p></section>
    <section className="settings-section"><h3>3. Hébergement et téléchargements</h3><div className="button-row"><a className="button secondary" href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">Ouvrir Cloudflare</a><a className="button secondary" href="https://github.com/heythrum/desktop/actions" target="_blank" rel="noopener noreferrer">Versions Windows sur GitHub</a><a className="button secondary" href="https://github.com/heythrum/desktop/blob/main/docs/DEPLOYMENT.md" target="_blank" rel="noopener noreferrer">Guide de mise en ligne</a></div><p className="fine-print">Dans GitHub Actions, ouvrez un build réussi puis téléchargez l’artefact Thrum-Windows. Une modification du code nécessite une nouvelle version Windows ; les playlists sont synchronisées séparément avec votre compte Supabase.</p></section>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status" style={{color:'var(--mint)',fontSize:12,lineHeight:1.8}}>{message}</p>}
    <button className="button primary full" onClick={onClose}>Terminer la configuration</button>
  </Dialog>;
}
