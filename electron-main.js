// TimeFlow — processus principal Electron (assistant de bureau 24/7)
const { app, BrowserWindow, session, shell, dialog, Tray, Menu, Notification, nativeImage, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PORT = 3000;                       // doit matcher la redirection OAuth Google enregistrée
process.env.PORT = String(PORT);

// 1) Dossier de données INSCRIPTIBLE (%APPDATA%\TimeFlow\data)
const DATA_DIR = path.join(app.getPath('userData'), 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
process.env.TF_DATA_DIR = DATA_DIR;

// 2) Au 1er lancement : copie les données par défaut livrées avec l'app
const seedDir = app.isPackaged ? path.join(process.resourcesPath, 'seed') : path.join(__dirname, 'seed');
for (const f of ['config.json', 'tokens.json', 'habits.json', 'tasks.json', 'memory.json', 'locks.json', 'stats.json']) {
  try {
    const dst = path.join(DATA_DIR, f), src = path.join(seedDir, f);
    if (!fs.existsSync(dst) && fs.existsSync(src)) fs.copyFileSync(src, dst);
  } catch (e) {}
}

// 3) Libère le port 3000 (instance résiduelle éventuelle)
try { execSync('for /f "tokens=5" %a in (\'netstat -ano ^| findstr ":3000" ^| findstr LISTENING\') do taskkill /PID %a /F', { shell: 'cmd.exe', stdio: 'ignore' }); } catch (e) {}

// 3bis) Indique au serveur OÙ trouver le modèle vocal + la lib de dictée
process.env.TF_MODELS_DIR = app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, 'models');
process.env.TF_VENDOR_DIR = path.join(__dirname, 'vendor');

// 4) Démarre le moteur TimeFlow EN INTERNE (le serveur Node tourne dans le process principal)
try { require(path.join(__dirname, 'server.js')); }
catch (e) { try { dialog.showErrorBox('TimeFlow', 'Le moteur n\'a pas pu démarrer :\n' + e.message); } catch (_) {} }

const ICON = path.join(__dirname, 'build', 'icon.ico');
let win = null, companion = null, tray = null, isQuitting = false;

// ───────────── Fenêtre principale ─────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 680,
    backgroundColor: '#0e0f13', title: 'TimeFlow', show: false, autoHideMenuBar: true,
    icon: ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'electron-preload.js') }
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  const url = `http://localhost:${PORT}/app`;
  let tries = 0;
  const load = () => win.loadURL(url).catch(() => { if (++tries < 60) setTimeout(load, 300); });
  load();
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // FERMER = réduire dans la barre des tâches système (l'app continue de tourner en arrière-plan)
  win.on('close', (e) => { if (!isQuitting) { e.preventDefault(); win.hide(); showTrayHint(); } });
}
function showMain() { if (!win) createWindow(); else { win.show(); win.focus(); } }

// ───────────── Widget compagnon (flèche flottante → panneau) ─────────────
// Position + forme de l'icône réduite (déplaçable, aimantée aux bords, mémorisée d'une session à l'autre)
const COMP_POS_FILE = path.join(DATA_DIR, 'companion-pos.json');
const BOX = 64;                                       // taille fixe de la fenêtre réduite — l'orbe morphe en CSS à l'intérieur
let companionPos = null, companionDock = 'right', _liveDock = 'right';
try { if (fs.existsSync(COMP_POS_FILE)) { const s = JSON.parse(fs.readFileSync(COMP_POS_FILE, 'utf8')); if (Number.isFinite(s.x)) companionPos = { x: s.x, y: s.y }; if (s.dock) companionDock = _liveDock = s.dock; } } catch (e) {}
function saveCompanionPos() { try { fs.writeFileSync(COMP_POS_FILE, JSON.stringify({ x: companionPos && companionPos.x, y: companionPos && companionPos.y, dock: companionDock })); } catch (e) {} }
function waNear(x, y) { return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea; }  // écran (multi-moniteurs) le plus proche d'un point
function companionBounds(expanded) {
  const pri = screen.getPrimaryDisplay().workArea;
  const def = { x: pri.x + pri.width - BOX, y: pri.y + 96 };
  const p = (companionPos && Number.isFinite(companionPos.x) && Number.isFinite(companionPos.y)) ? companionPos : def;
  const wa = waNear(p.x + BOX / 2, p.y + BOX / 2);    // l'ÉCRAN qui contient l'icône (peut être le 2e moniteur)
  if (!expanded) {
    const x = Math.max(wa.x, Math.min(p.x, wa.x + wa.width - BOX));
    const y = Math.max(wa.y, Math.min(p.y, wa.y + wa.height - BOX));
    return { x, y, width: BOX, height: BOX };
  }
  const w = 380, h = 580;
  let x = p.x + BOX - w, y = p.y - 20;                 // le panneau s'ouvre à côté de l'icône
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  return { x, y, width: w, height: h };
}
function nearestEdge(b) {                              // 'free', un bord, ou un COIN (tl/tr/bl/br) — sur l'écran où se trouve l'icône
  const wa = waNear(b.x + b.width / 2, b.y + b.height / 2), SNAP = 70;
  const dl = b.x - wa.x, dr = (wa.x + wa.width) - (b.x + b.width), dt = b.y - wa.y, db = (wa.y + wa.height) - (b.y + b.height);
  const nl = dl < SNAP, nr = dr < SNAP, nt = dt < SNAP, nb = db < SNAP;
  if (nt && nl) return 'tl'; if (nt && nr) return 'tr'; if (nb && nl) return 'bl'; if (nb && nr) return 'br';
  const m = Math.min(dl, dr, dt, db);
  if (m > SNAP) return 'free';
  if (m === dl) return 'left'; if (m === dr) return 'right'; if (m === dt) return 'top'; return 'bottom';
}
function sendShape() { try { if (companion && !companion.isDestroyed()) companion.webContents.send('companion:shape', companionDock); } catch (e) {} }
function createCompanion() {
  companion = new BrowserWindow({
    ...companionBounds(false),
    title: '', frame: false, transparent: true, backgroundColor: '#00000000', resizable: true, movable: false,
    maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
    hasShadow: false, show: false, focusable: true, thickFrame: false, roundedCorners: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'electron-preload-companion.js') }
  });
  try { companion.setSkipTaskbar(true); } catch (e) {}   // jamais dans la barre des tâches / Alt+Tab (plus de boîte « TimeFlow » au resize)
  try { companion.setMenu(null); } catch (e) {}
  companion.setAlwaysOnTop(true, 'floating');
  const url = `http://localhost:${PORT}/widget`;
  let tries = 0;
  const load = () => companion.loadURL(url).catch(() => { if (++tries < 60) setTimeout(load, 300); });
  load();
  companion.once('ready-to-show', () => { companion.show(); setTimeout(sendShape, 120); });
  companion.webContents.on('did-finish-load', () => setTimeout(sendShape, 120));
  companion.on('closed', () => { companion = null; });
}
function setCompanionExpanded(expanded) {
  if (!companion) return;
  try { companion.setResizable(true); } catch (e) {}   // Windows : setBounds est ignoré si la fenêtre n'est pas resizable
  companion.setBounds(companionBounds(expanded));
  if (expanded) companion.focus(); else setTimeout(sendShape, 60);   // au repli : réapplique la forme dockée
}
function showCompanion(openPanel) {
  if (!companion) createCompanion();
  else companion.show();
  if (openPanel && companion) { setCompanionExpanded(true); companion.webContents.executeJavaScript('try{expand()}catch(e){}').catch(()=>{}); }
}

ipcMain.on('companion:expand', (_e, expanded) => setCompanionExpanded(expanded));
ipcMain.on('companion:openMain', () => { showMain(); setCompanionExpanded(false); });
ipcMain.on('companion:drag', (_e, dx, dy) => {       // glisser → déplace la fenêtre + morphe l'orbe (cercle/demi-cercle)
  if (!companion) return;
  const b = companion.getBounds();
  let nx = Math.round(b.x + (dx || 0)), ny = Math.round(b.y + (dy || 0));
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;   // l'écran SOUS LE CURSEUR → passe librement d'un moniteur à l'autre
  nx = Math.max(wa.x, Math.min(nx, wa.x + wa.width - b.width));
  ny = Math.max(wa.y, Math.min(ny, wa.y + wa.height - b.height));
  companion.setBounds({ x: nx, y: ny, width: b.width, height: b.height });
  const e = nearestEdge({ x: nx, y: ny, width: b.width, height: b.height });   // cercle si loin, demi-cercle si proche d'un bord
  if (e !== _liveDock) { _liveDock = e; try { companion.webContents.send('companion:shape', e); } catch (_) {} }
});
ipcMain.on('companion:dragEnd', () => {               // au lâcher : aimante au bord le plus proche (ou reste libre = rond)
  if (!companion) return;
  const b = companion.getBounds();
  const wa = waNear(b.x + b.width / 2, b.y + b.height / 2);   // bords de l'écran où l'icône a été lâchée
  const e = nearestEdge(b);
  let x = b.x, y = b.y;
  if (e === 'right' || e === 'tr' || e === 'br') x = wa.x + wa.width - BOX; else if (e === 'left' || e === 'tl' || e === 'bl') x = wa.x;
  if (e === 'top' || e === 'tl' || e === 'tr') y = wa.y; else if (e === 'bottom' || e === 'bl' || e === 'br') y = wa.y + wa.height - BOX;
  companion.setBounds({ x, y, width: BOX, height: BOX });
  companionPos = { x, y }; companionDock = e; _liveDock = e; saveCompanionPos(); sendShape();
});

// ───────────── Icône de la barre système (tray) ─────────────
function buildTray() {
  try {
    let img = nativeImage.createFromPath(ICON);
    if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('TimeFlow — votre assistant');
    const menu = Menu.buildFromTemplate([
      { label: 'Ouvrir TimeFlow', click: () => showMain() },
      { label: 'Assistant flottant', click: () => showCompanion(true) },
      { type: 'separator' },
      { label: 'Quitter', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => showMain());
  } catch (e) {}
}
let _hintShown = false;
function showTrayHint() {
  if (_hintShown || !Notification.isSupported()) return; _hintShown = true;
  try { new Notification({ title: 'TimeFlow continue en arrière-plan', body: 'Votre assistant reste actif (icône dans la barre système). La flèche reste accessible en haut à droite.', icon: ICON }).show(); } catch (e) {}
}

// ───────────── Notifications natives des événements (avec rappel + minuteur) ─────────────
const _notified = new Set();
async function pollEvents() {
  try {
    const now = new Date(), max = new Date(Date.now() + 24 * 3600000);
    const r = await fetch(`http://localhost:${PORT}/api/events?timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(max.toISOString())}`);
    if (!r.ok) return;
    const evs = await r.json();
    if (!Array.isArray(evs)) return;
    const fmt = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    for (const e of evs) {
      if (e.allDay || !e.start) continue;
      const s = new Date(e.start), diff = s - Date.now();
      if (diff > 0 && diff <= 5 * 60000) {           // rappel 5 min avant
        const id = 'soon@' + e.id; if (!_notified.has(id)) { _notified.add(id); notify('⏰ Bientôt : ' + e.title, `À ${fmt(e.start)} — dans ${Math.max(1, Math.round(diff / 60000))} min`); }
      } else if (diff <= 0 && diff > -90000) {       // au top de l'heure
        const id = 'now@' + e.id; if (!_notified.has(id)) { _notified.add(id); notify('▶ ' + e.title, `C'est l'heure ! ${e.end ? 'Jusqu\'à ' + fmt(e.end) : ''}`); }
      }
    }
    if (_notified.size > 400) _notified.clear();
  } catch (e) {}
}
function notify(title, body) {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title, body, icon: ICON, silent: false });
    n.on('click', () => showCompanion(true));
    n.show();
  } catch (e) {}
}

// ───────────── Démarrage automatique au boot de Windows ─────────────
const AUTOSTART_FILE = path.join(DATA_DIR, 'autostart.json');
function autostartEnabled() { try { if (fs.existsSync(AUTOSTART_FILE)) return JSON.parse(fs.readFileSync(AUTOSTART_FILE, 'utf8')).enabled !== false; } catch (e) {} return true; }  // activé par défaut
function applyAutostart(enabled) {
  try {
    fs.writeFileSync(AUTOSTART_FILE, JSON.stringify({ enabled: !!enabled }));
    // ouvre au login, en arrière-plan (--hidden : tray + flèche flottante, sans la grande fenêtre)
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath, args: ['--hidden'] });
  } catch (e) {}
}
ipcMain.on('autostart:set', (_e, enabled) => applyAutostart(enabled));
ipcMain.handle('autostart:get', () => autostartEnabled());

// ───────────── Cycle de vie ─────────────
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(true));
  try { session.defaultSession.setPermissionCheckHandler(() => true); } catch (e) {}
  applyAutostart(autostartEnabled());                 // (ré)applique l'inscription au démarrage
  const hidden = process.argv.includes('--hidden');   // lancé au boot → reste discret (pas de grande fenêtre)
  if (!hidden) createWindow();
  buildTray();
  setTimeout(createCompanion, 1500);                  // la flèche flottante apparaît une fois le serveur prêt
  setInterval(pollEvents, 30000); setTimeout(pollEvents, 6000);
  try { globalShortcut.register('CommandOrControl+Shift+Space', () => showCompanion(true)); } catch (e) {}
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showMain(); });
});
// NE PAS quitter quand les fenêtres se ferment : l'assistant vit en arrière-plan (tray).
app.on('window-all-closed', () => { /* rester actif */ });
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) {} });
