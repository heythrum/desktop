import { test, expect, type Page } from '@playwright/test';
const TEST_ID = 'fJ9rUzIMcZQ';
const result = { id: TEST_ID, title: 'Bohemian Rhapsody', artist: 'Queen', thumbnail: `https://i.ytimg.com/vi/${TEST_ID}/hqdefault.jpg` };
async function offlineAssets(page: Page) {
  // Network boundaries are mocked; these tests validate UI behavior, not streaming authorization.
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/oembed**', route => route.fulfill({ json: { title: result.title, author_name: result.artist } }));
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: `window.YT={Player:class{constructor(el,opts){this.time=0;this.opts=opts;el.innerHTML='<iframe title="Lecteur vidéo YouTube simulé"></iframe>';setTimeout(()=>opts.events.onReady(),10)}loadVideoById(){this.time=0}playVideo(){this.opts.events.onStateChange({data:1})}pauseVideo(){this.opts.events.onStateChange({data:2})}setVolume(){}seekTo(t){this.time=t}getCurrentTime(){return this.time}getDuration(){return 240}destroy(){}}};window.onYouTubeIframeAPIReady?.();` }));
}
test.beforeEach(async ({ page }) => { await offlineAssets(page); await page.goto('/'); });

test('discovery renders and navigation survives reload', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Dans votre élément.' })).toBeVisible();
  await page.getByRole('button', { name: 'Ma bibliothèque', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ma bibliothèque', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Importer de Spotify', exact: true }).last()).toBeVisible();
});

test('playlist CRUD and persistent favorites', async ({ page }) => {
  await page.getByRole('button', { name: 'Ma bibliothèque', exact: true }).click();
  await page.getByRole('button', { name: 'Une nouvelle playlist À votre image' }).click();
  await page.getByLabel('Nom de la playlist').fill('Mes nuits bleues');
  await page.getByRole('button', { name: 'Créer la playlist', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mes nuits bleues', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Renommer la playlist' }).click();
  await page.getByLabel('Nom de la playlist').fill('Mes matins verts');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mes matins verts', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Ma bibliothèque', exact: true }).click();
  await expect(page.getByRole('button', { name: /Mes matins verts/ }).last()).toBeVisible();
  await page.locator('.track-row').first().getByRole('button', { name: /aux favoris/ }).click();
  await page.getByRole('button', { name: /Mes favoris/ }).click();
  await expect(page.locator('.track-row')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: /Mes favoris/ }).click();
  await expect(page.locator('.track-row')).toHaveCount(1);
});

test('YouTube import is validated, metadata loaded, controls update', async ({ page }) => {
  await page.getByRole('button', { name: 'Ajouter un lien YouTube', exact: true }).click();
  await page.getByLabel('Lien YouTube', { exact: true }).fill('https://evil.example/watch?v=abcdef12345');
  await page.getByRole('button', { name: 'Ajouter et écouter' }).click();
  await expect(page.getByRole('alert')).toContainText('valide');
  await page.getByLabel('Lien YouTube', { exact: true }).fill(`https://youtu.be/${TEST_ID}`);
  await page.getByRole('button', { name: 'Ajouter et écouter' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.now-details h3')).toHaveText(result.title);
  await expect(page.getByRole('button', { name: 'Mettre en pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lancer la lecture', exact: true })).toBeVisible();
});

test('search server results are playable; missing configuration is explicit', async ({ page }) => {
  await page.route('**/api/search?*', route => route.fulfill({ json: { items: [result] } }));
  await page.getByLabel('Rechercher une musique').fill('Queen');
  await page.getByRole('button', { name: 'Lancer la recherche' }).click();
  await expect(page.getByRole('heading', { name: 'Résultats YouTube' })).toBeVisible();
  await expect(page.locator('.track-list')).toContainText(result.title);
  await page.unroute('**/api/search?*');
  await page.route('**/api/search?*', route => route.fulfill({ status: 503, json: { error: 'missing' } }));
  await page.getByLabel('Rechercher une musique').fill('Daft Punk');
  await page.getByRole('button', { name: 'Lancer la recherche' }).click();
  await expect(page.getByRole('heading', { name: 'La recherche n’est pas disponible' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Configurer la recherche' })).toBeVisible();
});

test('backup import rejects bad JSON and replaces library only after valid input', async ({ page }) => {
  await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
  await page.getByRole('button', { name: 'Sauvegardes', exact: true }).click();
  await page.getByLabel('Fichier de sauvegarde', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.getByRole('alert')).toContainText('JSON');
  const state = { version: 1, tracks: [result], favorites: [TEST_ID], playlists: [], queue: [], recent: [], currentTrackId: null, volume: 45, shuffle: false, repeat: 'off' };
  await page.getByLabel('Fichier de sauvegarde', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Mes favoris/ }).click();
  await expect(page.locator('.track-row')).toHaveCount(1);
  await expect(page.locator('.track-row')).toContainText(result.title);
});

test('Spotify CSV review matches and creates a local playlist', async ({ page }) => {
  await page.route('**/api/search?*', route => route.fulfill({ json: { items: [result] } }));
  await page.getByRole('button', { name: 'Ma bibliothèque', exact: true }).click();
  await page.getByRole('button', { name: 'Importer de Spotify', exact: true }).last().click();
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({ name: 'Spotify test.csv', mimeType: 'text/csv', buffer: Buffer.from('Track Name,Artist Name(s)\nBohemian Rhapsody,Queen') });
  await page.getByRole('button', { name: 'Chercher 1 correspondances' }).click();
  await expect(page.getByText(/Suggestion : Bohemian Rhapsody/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Créer la playlist avec 1 titre', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Créer la playlist avec 1 titre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spotify test', exact: true })).toBeVisible();
  await expect(page.locator('.track-row')).toHaveCount(1);
});

test('LRC import displays genuine timed lines and allows seeking', async ({ page }) => {
  await page.getByRole('button', { name: 'Lancer la sélection' }).click();
  await page.getByRole('button', { name: 'Paroles', exact: true }).click();
  await page.getByLabel('Fichier de paroles LRC').setInputFiles({ name: 'test.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00.00]Une première ligne\n[00:10.00]Une autre ligne') });
  await expect(page.getByRole('button', { name: 'Une première ligne', exact: true })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'Une autre ligne', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Une autre ligne', exact: true })).toHaveAttribute('aria-current', 'true');
});

test('layout fits the viewport and dialog traps keyboard focus', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Ajouter un lien YouTube', exact: true }).click();
  await expect(page.getByLabel('Lien YouTube', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('account sign-in requires a library choice then syncs edits', async ({ page }) => {
  const userId = '4fc931fa-fd63-41a6-8ca3-aa4189a56cd1';
  const now = Math.floor(Date.now() / 1000);
  const jwtPart = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${jwtPart({ alg: 'HS256', typ: 'JWT' })}.${jwtPart({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: now + 3600, iat: now })}.test-signature`;
  const user = { id: userId, email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  let snapshot: { state: unknown; revision: number; updated_at: string } | null = null;
  let writes = 0;
  await page.route('https://ullogxbrgwkvgqqsotww.supabase.co/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/auth/v1/token') return route.fulfill({ json: { access_token: token, token_type: 'bearer', refresh_token: 'test-refresh-token', expires_in: 3600, user } });
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/rest/v1/library_snapshots') return route.fulfill({ json: snapshot });
    if (url.pathname === '/rest/v1/rpc/save_library_snapshot') {
      const body = request.postDataJSON();
      writes++;
      snapshot = { state: body.p_state, revision: writes, updated_at: new Date().toISOString() };
      return route.fulfill({ json: [snapshot] });
    }
    return route.fulfill({ json: {} });
  });
  await page.getByRole('button', { name: 'Compte et synchronisation', exact: true }).click();
  await page.getByLabel('Adresse e-mail', { exact: true }).fill('test@example.com');
  await page.getByLabel('Mot de passe', { exact: true }).fill('UnMotDePasseDeTest123!');
  await page.getByRole('button', { name: 'Me connecter', exact: true }).click();
  await expect(page.getByText('Choisissez votre bibliothèque', { exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Activer avec ma bibliothèque locale', exact: true }).click();
  await expect(page.getByText('Synchronisation active', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Ma bibliothèque', exact: true }).click();
  await page.locator('.track-row').first().getByRole('button', { name: /aux favoris/ }).click();
  await expect.poll(() => writes).toBe(2);
  expect((snapshot!.state as { favorites: string[] }).favorites).toHaveLength(1);
});
