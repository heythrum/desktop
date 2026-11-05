import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { CloudConflictError, fetchRemoteLibrary, getCloudClient, pushRemoteLibrary } from '../lib/cloud';
import type { LibraryState } from '../lib/types';

type Snapshot = { state: LibraryState; revision: number; updatedAt: string };
export type CloudStatus = 'loading' | 'unconfigured' | 'signed-out' | 'choose' | 'synced' | 'syncing' | 'conflict' | 'error';

function authMessage(cause: unknown): string {
  const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
  if (/invalid login|invalid credentials/i.test(message)) return 'L’adresse e-mail ou le mot de passe est incorrect.';
  if (/email not confirmed/i.test(message)) return 'Confirmez votre adresse e-mail depuis le message reçu avant de vous connecter.';
  if (/already registered|already been registered/i.test(message)) return 'Cette adresse possède déjà un compte. Essayez de vous connecter.';
  if (/rate limit|too many requests|security purposes/i.test(message)) return 'Trop de tentatives. Patientez un moment avant de réessayer.';
  if (/password|same_password/i.test(message)) return 'Choisissez un nouveau mot de passe d’au moins 10 caractères.';
  if (/network|fetch|load failed/i.test(message)) return 'Le service est inaccessible. Vérifiez votre connexion.';
  return 'L’opération n’a pas abouti. Vérifiez vos informations puis réessayez.';
}

function authRedirect() {
  const { origin, protocol, hostname } = window.location;
  return protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    ? `${origin}/?account=recovery`
    : 'https://thrum.uno/?account=recovery';
}

/** A library is never uploaded until the user has explicitly chosen its baseline. */
export function useCloudSync(library: LibraryState, onReplaceLibrary: (state: LibraryState) => void) {
  const [status, setStatus] = useState<CloudStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [remote, setRemote] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recovery, setRecovery] = useState(false);
  const statusRef = useRef(status); statusRef.current = status;
  const clientRef = useRef<SupabaseClient | null>(null);
  const userRef = useRef<User | null>(null);
  const libraryRef = useRef(library); libraryRef.current = library;
  const replaceRef = useRef(onReplaceLibrary); replaceRef.current = onReplaceLibrary;
  const remoteRef = useRef<Snapshot | null>(null);
  const baselineRef = useRef<string | null>(null);
  const awaitingApplyRef = useRef(false);
  const enabledRef = useRef(false);
  const generation = useRef(0);
  const actionId = useRef(0);
  const writeEpoch = useRef<number | null>(null);
  const mounted = useRef(false);
  const initialized = useRef(false);

  const updateRemote = useCallback((value: Snapshot | null) => { remoteRef.current = value; setRemote(value); }, []);
  const current = useCallback((epoch: number) => mounted.current && generation.current === epoch, []);

  const handleSession = useCallback((nextUser: User | null) => {
    if (initialized.current && nextUser?.id === userRef.current?.id) { userRef.current = nextUser; setUser(nextUser); return; }
    initialized.current = true;
    const epoch = ++generation.current;
    ++actionId.current;
    userRef.current = nextUser;
    setUser(nextUser); setBusy(false); setError(''); setNotice('');
    baselineRef.current = null; awaitingApplyRef.current = false; enabledRef.current = false; writeEpoch.current = null;
    updateRemote(null);
    if (!nextUser) { setStatus('signed-out'); return; }
    const client = clientRef.current;
    if (!client) return;
    const operation = actionId.current;
    setStatus('loading'); setBusy(true);
    void fetchRemoteLibrary(client, nextUser.id).then(snapshot => {
      if (!current(epoch) || operation !== actionId.current) return;
      updateRemote(snapshot); setStatus('choose');
    }).catch(cause => {
      if (!current(epoch) || operation !== actionId.current) return;
      setError(cause instanceof Error ? cause.message : 'Impossible de charger votre bibliothèque en ligne.');
      setStatus('error');
    }).finally(() => { if (current(epoch) && operation === actionId.current) setBusy(false); });
  }, [current, updateRemote]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    // StrictMode may replay this effect; replay must initialize the session again.
    initialized.current = false;
    void getCloudClient().then(async client => {
      if (disposed) return;
      clientRef.current = client;
      if (!client) { setStatus('unconfigured'); return; }
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // Supabase auth holds an internal lock in this callback. Database work starts afterwards.
        queueMicrotask(() => {
          if (disposed) return;
          if (event === 'PASSWORD_RECOVERY') setRecovery(true);
          handleSession(session?.user || null);
        });
      });
      unsubscribe = () => data.subscription.unsubscribe();
      const result = await client.auth.getSession();
      if (disposed) return;
      if (result.error && !initialized.current) { setError('Votre session ne peut pas être vérifiée. Réessayez de vous connecter.'); setStatus('signed-out'); return; }
      if (!initialized.current) handleSession(result.data.session?.user || null);
    }).catch(() => {
      if (!disposed) { setError('La configuration du compte est inaccessible. Réessayez après avoir vérifié votre connexion et la configuration Supabase.'); setStatus('unconfigured'); }
    });
    return () => { disposed = true; mounted.current = false; ++generation.current; ++actionId.current; enabledRef.current = false; unsubscribe?.(); };
  }, [handleSession]);

  const refreshRemote = useCallback(async () => {
    const client = clientRef.current, account = userRef.current;
    if (!client || !account) return;
    enabledRef.current = false;
    const epoch = generation.current, operation = ++actionId.current;
    setBusy(true); setError(''); setNotice(''); setStatus('loading');
    try {
      const snapshot = await fetchRemoteLibrary(client, account.id);
      if (!current(epoch)) return;
      updateRemote(snapshot); setStatus('choose');
    } catch (cause) {
      if (current(epoch)) { setError(cause instanceof Error ? cause.message : 'La vérification a échoué.'); setStatus('error'); }
    } finally { if (current(epoch) && operation === actionId.current) setBusy(false); }
  }, [current, updateRemote]);

  const uploadLocal = useCallback(async () => {
    const client = clientRef.current, account = userRef.current;
    if (!client || !account) return;
    const epoch = generation.current;
    if (writeEpoch.current === epoch) return;
    writeEpoch.current = epoch;
    const operation = ++actionId.current;
    const state = libraryRef.current;
    const expectedRevision = remoteRef.current?.revision ?? null;
    setBusy(true); setError(''); setNotice(''); setStatus('syncing');
    try {
      const snapshot = await pushRemoteLibrary(client, account.id, state, expectedRevision);
      if (!current(epoch)) return;
      updateRemote(snapshot); baselineRef.current = JSON.stringify(state); enabledRef.current = true;
      setStatus('synced');
    } catch (cause) {
      if (!current(epoch)) return;
      enabledRef.current = false;
      if (cause instanceof CloudConflictError) {
        setStatus('conflict');
        setError('La bibliothèque a changé sur un autre appareil. Choisissez quelle version conserver ; aucune version n’a été écrasée.');
        try { const snapshot = await fetchRemoteLibrary(client, account.id); if (current(epoch)) updateRemote(snapshot); }
        catch { /* Preserve the last known revision; another attempt still uses compare-and-swap. */ }
      } else {
        setStatus('error'); setError(cause instanceof Error ? cause.message : 'La synchronisation a échoué. Votre bibliothèque locale est conservée.');
      }
    } finally { if (writeEpoch.current === epoch) writeEpoch.current = null; if (current(epoch) && operation === actionId.current) setBusy(false); }
  }, [current, updateRemote]);

  const downloadRemote = useCallback(async () => {
    const client = clientRef.current, account = userRef.current;
    if (!client || !account) return;
    enabledRef.current = false;
    const epoch = generation.current, operation = ++actionId.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const snapshot = await fetchRemoteLibrary(client, account.id);
      if (!current(epoch)) return;
      updateRemote(snapshot);
      if (!snapshot) { setStatus('choose'); setNotice('Ce compte ne possède pas encore de bibliothèque en ligne.'); return; }
      baselineRef.current = JSON.stringify(snapshot.state); awaitingApplyRef.current = true; enabledRef.current = true;
      replaceRef.current(snapshot.state); setStatus('synced'); setNotice('Votre bibliothèque en ligne est chargée. La synchronisation est maintenant active.');
    } catch (cause) {
      if (current(epoch)) { setStatus('error'); setError(cause instanceof Error ? cause.message : 'Le chargement a échoué. Votre bibliothèque locale est conservée.'); }
    } finally { if (current(epoch) && operation === actionId.current) setBusy(false); }
  }, [current, updateRemote]);

  const serialized = JSON.stringify(library);
  useEffect(() => {
    if (!enabledRef.current || status !== 'synced' || !user) return;
    if (awaitingApplyRef.current) {
      if (serialized === baselineRef.current) awaitingApplyRef.current = false;
      else return;
    }
    if (serialized === baselineRef.current) return;
    const timer = setTimeout(() => { if (enabledRef.current) void uploadLocal(); }, 700);
    return () => clearTimeout(timer);
  }, [serialized, status, user, uploadLocal]);

  // Polling also works when Supabase Realtime is not enabled for the table.
  // Only a clean, explicitly accepted local baseline may be replaced automatically.
  useEffect(() => {
    let stopped = false;
    let checking = false;
    async function receiveRemoteChanges() {
      const client = clientRef.current, account = userRef.current;
      if (stopped || checking || !client || !account || !enabledRef.current || statusRef.current !== 'synced') return;
      const epoch = generation.current, operation = actionId.current;
      if (writeEpoch.current === epoch) return;
      const expectedRevision = remoteRef.current?.revision ?? null;
      checking = true;
      try {
        const snapshot = await fetchRemoteLibrary(client, account.id);
        if (stopped || !current(epoch) || operation !== actionId.current || !enabledRef.current || statusRef.current !== 'synced' || writeEpoch.current === epoch || (remoteRef.current?.revision ?? null) !== expectedRevision) return;
        if (snapshot?.revision === expectedRevision) return;
        if (!snapshot) {
          enabledRef.current = false; updateRemote(null); setStatus('choose');
          setNotice('La bibliothèque en ligne n’est plus disponible. Votre bibliothèque locale est conservée.');
          return;
        }
        updateRemote(snapshot);
        if (JSON.stringify(libraryRef.current) !== baselineRef.current) {
          enabledRef.current = false; setStatus('conflict');
          setError('Un autre appareil a changé la bibliothèque pendant vos modifications. Choisissez quelle version conserver ; vos changements locaux sont conservés.');
          return;
        }
        baselineRef.current = JSON.stringify(snapshot.state); awaitingApplyRef.current = true;
        replaceRef.current(snapshot.state); setError('');
        setNotice('Bibliothèque mise à jour depuis un autre appareil.');
      } catch {
        if (!stopped && current(epoch) && operation === actionId.current && enabledRef.current) {
          // A temporary read failure never changes the accepted baseline or local data.
          setNotice('Impossible de vérifier les autres appareils pour le moment. Votre bibliothèque locale est conservée.');
        }
      } finally { checking = false; }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void receiveRemoteChanges(); };
    const onFocus = () => { void receiveRemoteChanges(); };
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void receiveRemoteChanges(); }, 30_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearInterval(interval); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); };
  }, [current, updateRemote]);

  const authenticate = useCallback(async (mode: 'signin' | 'signup', email: string, password: string) => {
    const client = clientRef.current;
    if (!client) return;
    const operation = ++actionId.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = mode === 'signin'
        ? await client.auth.signInWithPassword({ email: email.trim(), password })
        : await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirect().replace('?account=recovery', '?account=confirmed') } });
      if (!mounted.current) return;
      if (result.error) { setError(authMessage(result.error)); return; }
      if (mode === 'signup' && !result.data.session) setNotice('Consultez vos e-mails pour confirmer votre compte, puis revenez vous connecter.');
      if (result.data.session?.user) handleSession(result.data.session.user);
    } catch (cause) { if (mounted.current) setError(authMessage(cause)); }
    finally { if (mounted.current && operation === actionId.current) setBusy(false); }
  }, [handleSession]);

  const signOut = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const operation = ++actionId.current;
    enabledRef.current = false; setBusy(true); setError('');
    try {
      const result = await client.auth.signOut();
      if (!mounted.current) return;
      if (result.error) { setError(authMessage(result.error)); setStatus('error'); return; }
      setRecovery(false); handleSession(null); setNotice('Déconnexion effectuée. La bibliothèque de cet appareil est conservée ; exportez-la ou réinitialisez-la avant de partager cet appareil.');
    } catch (cause) { if (mounted.current) { setError(authMessage(cause)); setStatus('error'); } }
    finally { if (mounted.current && operation === actionId.current) setBusy(false); }
  }, [handleSession]);

  const sendPasswordReset = useCallback(async (email: string) => {
    const client = clientRef.current;
    if (!client) return;
    const operation = ++actionId.current; setBusy(true); setError(''); setNotice('');
    try {
      const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect() });
      if (!mounted.current) return;
      if (result.error) setError(authMessage(result.error));
      else setNotice('Si cette adresse possède un compte, un lien de réinitialisation lui sera envoyé.');
    } catch (cause) { if (mounted.current) setError(authMessage(cause)); }
    finally { if (mounted.current && operation === actionId.current) setBusy(false); }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const client = clientRef.current;
    if (!client) return;
    const operation = ++actionId.current; setBusy(true); setError(''); setNotice('');
    try {
      const result = await client.auth.updateUser({ password });
      if (!mounted.current) return;
      if (result.error) setError(authMessage(result.error));
      else { setRecovery(false); setNotice('Votre mot de passe a été modifié.'); }
    } catch (cause) { if (mounted.current) setError(authMessage(cause)); }
    finally { if (mounted.current && operation === actionId.current) setBusy(false); }
  }, []);

  return {
    status, user, remote, busy, error, notice, recovery,
    configured: status !== 'unconfigured' && status !== 'loading',
    signIn: (email: string, password: string) => authenticate('signin', email, password),
    signUp: (email: string, password: string) => authenticate('signup', email, password),
    sendPasswordReset, updatePassword, signOut, refreshRemote, downloadRemote, uploadLocal,
    retrySync: uploadLocal,
  };
}

export type CloudSync = ReturnType<typeof useCloudSync>;
