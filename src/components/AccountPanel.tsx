import { useState, type FormEvent } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Check, Cloud, CloudOff, ExternalLink, LoaderCircle, LogOut, Mail, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { Dialog } from './Dialog';
import type { CloudSync } from '../hooks/useCloudSync';
import './AccountPanel.css';

export function AccountPanel({ cloud, onClose }: { cloud: CloudSync; onClose: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validation, setValidation] = useState('');
  const [choice, setChoice] = useState<'upload' | 'download' | null>(null);
  const error = validation || cloud.error;

  async function submit(event: FormEvent) {
    event.preventDefault(); setValidation('');
    if (cloud.recovery) {
      if (password.length < 10) { setValidation('Choisissez un mot de passe d’au moins 10 caractères.'); return; }
      if (password !== confirmation) { setValidation('Les mots de passe ne correspondent pas.'); return; }
      await cloud.updatePassword(password); setPassword(''); setConfirmation(''); return;
    }
    if (mode === 'reset') { await cloud.sendPasswordReset(email); return; }
    if (mode === 'signup' && password.length < 10) { setValidation('Choisissez un mot de passe d’au moins 10 caractères.'); return; }
    await (mode === 'signup' ? cloud.signUp(email, password) : cloud.signIn(email, password));
    setPassword('');
  }

  async function confirmChoice() {
    const selected = choice; setChoice(null);
    if (selected === 'upload') await cloud.uploadLocal();
    else if (selected === 'download') await cloud.downloadRemote();
  }

  const statusLabel = cloud.status === 'synced' ? 'Synchronisation active' : cloud.status === 'syncing' ? 'Enregistrement en cours…' : cloud.status === 'conflict' ? 'Deux versions à départager' : cloud.status === 'choose' ? 'Choisissez votre bibliothèque' : cloud.status === 'error' ? 'Synchronisation en pause' : 'Connexion à votre espace…';
  return <Dialog title={cloud.recovery ? 'Un nouveau mot de passe' : 'Votre musique vous suit'} onClose={onClose}>
    <div className="account-panel">
      <div className="account-intro"><span className="account-cloud-icon"><Cloud size={25}/></span><p>Retrouvez vos playlists et vos favoris sur le site et dans l’application Windows avec le même compte.</p></div>
      {cloud.status === 'loading' && !cloud.user && <div className="account-loading" role="status"><LoaderCircle className="spin" size={19}/> Vérification du service…</div>}
      {cloud.status === 'unconfigured' && <section className="account-unavailable"><CloudOff size={29}/><h3>Les comptes ne sont pas encore activés.</h3><p>Vous pouvez déjà écouter et organiser votre musique sur cet appareil. La connexion et la synchronisation seront disponibles une fois le service Thrum relié à Supabase.</p><a href="https://github.com/heythrum/desktop/blob/main/supabase/README.md" target="_blank" rel="noopener noreferrer" className="text-link">Guide de configuration pour l’administrateur <ExternalLink size={13}/></a></section>}
      {cloud.recovery ? <form className="account-form" onSubmit={submit}>
        <p className="account-copy">Choisissez un mot de passe unique pour sécuriser votre compte.</p><label htmlFor="account-password">Nouveau mot de passe</label><input id="account-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={10} maxLength={128} required/><label htmlFor="account-confirmation">Confirmer le mot de passe</label><input id="account-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={10} maxLength={128} required/><button className="button primary full" disabled={cloud.busy}>{cloud.busy && <LoaderCircle className="spin" size={15}/>} Enregistrer mon mot de passe</button>
      </form> : cloud.user ? <>
        <div className="account-identity"><span><UserRound size={18}/></span><div><strong>{cloud.user.email || 'Mon compte Thrum'}</strong><small>Bibliothèque personnelle</small></div><button className="icon-button" aria-label="Se déconnecter" title="Se déconnecter" disabled={cloud.busy} onClick={() => void cloud.signOut()}><LogOut size={18}/></button></div>
        <div className={`account-sync-status ${cloud.status}`} role="status">{cloud.status === 'synced' ? <Check size={17}/> : cloud.status === 'syncing' || cloud.status === 'loading' ? <LoaderCircle className="spin" size={17}/> : cloud.status === 'conflict' || cloud.status === 'error' ? <AlertCircle size={17}/> : <Cloud size={17}/>}<span>{statusLabel}</span></div>
        {cloud.remote && <p className="account-remote-details">En ligne : {cloud.remote.state.tracks.length} titres · {cloud.remote.state.playlists.length} playlists · {cloud.remote.state.favorites.length} favoris<br/>Dernière sauvegarde : {new Date(cloud.remote.updatedAt).toLocaleString('fr-FR')} · version {cloud.remote.revision}</p>}
        {cloud.status === 'choose' && <p className="account-copy">{cloud.remote ? 'Votre compte contient déjà une bibliothèque. Choisissez celle à conserver pour activer la synchronisation sur cet appareil.' : 'Votre compte est prêt. Envoyez la bibliothèque de cet appareil pour activer la synchronisation.'}</p>}
        {cloud.status === 'synced' && <p className="account-copy">Les changements sont sauvegardés automatiquement. Les autres appareils sont vérifiés toutes les 30 secondes et au retour dans l’application. Si les deux versions ont changé, vous choisissez celle à conserver.</p>}
        {cloud.status === 'conflict' && <p className="account-copy">Un autre appareil a modifié la bibliothèque. La synchronisation est arrêtée jusqu’à votre choix. Vous pouvez d’abord exporter votre version locale depuis les paramètres.</p>}
        {choice ? <div className="account-confirm" role="alert"><h3>{choice === 'upload' ? 'Conserver la bibliothèque de cet appareil ?' : 'Charger la bibliothèque en ligne ?'}</h3><p>{choice === 'upload' ? 'Elle remplacera la version en ligne si celle-ci n’a pas changé depuis votre dernière vérification. Les autres appareils pourront ensuite la charger.' : 'La version en ligne remplacera les playlists, favoris et titres de cet appareil. Exportez une sauvegarde locale avant de continuer si vous souhaitez conserver les deux versions.'}</p><div className="button-row"><button className="button secondary" onClick={() => setChoice(null)}>Annuler</button><button className="button primary" onClick={() => void confirmChoice()} disabled={cloud.busy}>Confirmer</button></div></div> : <div className="account-sync-actions">
          {cloud.status !== 'loading' && <><button className="button primary full" disabled={cloud.busy} onClick={() => cloud.remote ? setChoice('upload') : void cloud.uploadLocal()}><ArrowUpFromLine size={16}/>{cloud.remote ? 'Conserver ma bibliothèque locale' : 'Activer avec ma bibliothèque locale'}</button>{cloud.remote && <button className="button secondary full" disabled={cloud.busy} onClick={() => setChoice('download')}><ArrowDownToLine size={16}/> Charger la bibliothèque en ligne</button>}</>}
          <button className="text-link account-refresh" disabled={cloud.busy} onClick={() => { setChoice(null); void cloud.refreshRemote(); }}><RefreshCw size={13}/> Vérifier la version en ligne</button>
        </div>}
      </> : cloud.status === 'signed-out' || cloud.status === 'error' ? <>
        <div className="account-auth-tabs" aria-label="Connexion ou création de compte"><button className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setValidation(''); }}>Se connecter</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setValidation(''); }}>Créer un compte</button></div>
        <form className="account-form" onSubmit={submit}><label htmlFor="account-email">Adresse e-mail</label><input id="account-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="vous@exemple.fr" required maxLength={254}/>{mode !== 'reset' && <><label htmlFor="account-password">Mot de passe{mode === 'signup' ? ' · 10 caractères minimum' : ''}</label><input id="account-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={mode === 'signup' ? 10 : 1} maxLength={128} required/></>}<button className="button primary full" disabled={cloud.busy}>{cloud.busy ? <LoaderCircle className="spin" size={16}/> : mode === 'reset' ? <Mail size={16}/> : <UserRound size={16}/>} {mode === 'signup' ? 'Créer mon compte' : mode === 'reset' ? 'Recevoir un lien de réinitialisation' : 'Me connecter'}</button></form>
        <button className="text-link account-forgot" onClick={() => { setMode(mode === 'reset' ? 'signin' : 'reset'); setValidation(''); }}>{mode === 'reset' ? 'Revenir à la connexion' : 'Mot de passe oublié ?'}</button>
      </> : null}
      {error && <p className="form-error" role="alert">{error}</p>}
      {cloud.notice && <p className="account-notice" role="status">{cloud.notice}</p>}
      <div className="account-privacy"><ShieldCheck size={16}/><p>Vos données sont rattachées à votre compte Supabase. La clé YouTube et les fichiers de paroles restent sur cet appareil. Aucun fichier musical n’est envoyé.</p></div>
    </div>
  </Dialog>;
}
