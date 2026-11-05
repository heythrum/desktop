const { app, BrowserWindow, shell, session, dialog } = require('electron');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const devMode = !app.isPackaged && process.argv.includes('--dev');
let localServer;
const allowedExternalHosts = new Set(['www.youtube.com', 'youtube.com', 'youtu.be', 'console.cloud.google.com', 'developers.google.com', 'docs.netlify.com', 'github.com', 'thrum.uno', 'open.spotify.com']);
const policy = "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com; font-src 'self' data:; connect-src 'self' https://www.googleapis.com https://www.youtube.com https://*.supabase.co wss://*.supabase.co https://thrum.uno; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://open.spotify.com; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

function openExternal(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && allowedExternalHosts.has(url.hostname) && !url.username && !url.password) {
      void shell.openExternal(url.toString());
    }
  } catch { /* Invalid links never leave the application. */ }
}

async function startLocalServer() {
  const root = path.resolve(__dirname, '../dist');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  localServer = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', policy);
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-cache');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end(); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/api/config') {
        response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Les comptes sont configurés sur le site Thrum.', code: 'CLOUD_NOT_CONFIGURED' }));
        return;
      }
      if (pathname === '/api/search' || pathname.startsWith('/.netlify/')) {
        response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Configurez votre clé YouTube dans les paramètres de Thrum.', code: 'API_KEY_MISSING' }));
        return;
      }
      const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise((resolve, reject) => {
    localServer.once('error', reject);
    // Keep a stable origin so localStorage (library and API preferences) survives restarts.
    localServer.listen(43197, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${localServer.address().port}`;
}

async function createWindow() {
  const origin = devMode ? 'http://127.0.0.1:5173' : await startLocalServer();
  const window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 380, minHeight: 640,
    title: 'Thrum', backgroundColor: '#0b0b10', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== origin) { event.preventDefault(); openExternal(url); }
    } catch { event.preventDefault(); }
  });
  await window.loadURL(origin);
  window.on('closed', () => {
    if (localServer) { localServer.close(); localServer = undefined; }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(async () => {
    app.setAppUserModelId('uno.thrum.desktop');
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'fullscreen'));
    await createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  }).catch((error) => {
    console.error('Thrum could not start:', error.message);
    dialog.showErrorBox('Impossible de démarrer Thrum', error.code === 'EADDRINUSE'
      ? 'Le port local 43197 est déjà utilisé. Fermez l’autre application qui utilise ce port, puis relancez Thrum.'
      : 'Le lecteur local ne peut pas démarrer. Réinstallez Thrum ou consultez le guide de dépannage.');
    app.quit();
  });
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) { if (existing.isMinimized()) existing.restore(); existing.focus(); }
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { if (localServer) localServer.close(); });
}
