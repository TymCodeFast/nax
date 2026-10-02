// Browser — process principal.
// Fenêtre = une vue "chrome" (rail d'applis + liste d'onglets + barre de nav) qui couvre
// toute la fenêtre, et UNE vue de contenu (onglet ou appli) posée par-dessus dans la zone principale.
const { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, Menu, clipboard, safeStorage, dialog, session, nativeTheme, nativeImage, net, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
// Script d'overlay Picture-in-Picture, injecté dans le monde principal de chaque page (voir wakeTab).
const PIP_INJECT = (() => { try { return fs.readFileSync(path.join(__dirname, 'content-preload.js'), 'utf8'); } catch { return ''; } })();

// Nom d'app figé AVANT tout getPath : les données vivent dans %APPDATA%/NaX,
// identique en dev et une fois installé (donc favoris/mots de passe/réglages suivent).
app.setName('NaX');
// Identifiant d'application Windows : la barre des tâches (Win11) affiche l'icône du raccourci portant cet ID, pas celle de la fenêtre.
// Packagé : l'installeur crée ce raccourci. En dev, l'exécutable est electron.exe (icône atome) : on écrit nous-mêmes
// un raccourci « NaX (dev) » dans le menu Démarrer, avec l'ID et l'icône, pour que la barre des tâches montre NaX.
const APP_ID = app.isPackaged ? 'com.nax.browser' : 'com.nax.browser.dev'; // ID distinct en dev : ne se mélange pas avec la version installée
if (process.platform === 'win32' && !app.isPackaged) {
  try {
    const lnk = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'NaX (dev).lnk');
    shell.writeShortcutLink(lnk, 'create', { target: process.execPath, args: `"${app.getAppPath()}"`, cwd: app.getAppPath(), icon: path.join(__dirname, 'assets', 'icon.ico'), iconIndex: 0, appUserModelId: APP_ID, description: 'NaX (lancement dev)' });
  } catch {}
}
try { app.setAppUserModelId(APP_ID); } catch {}
// Reprise unique d'anciennes données si le dossier NaX est encore vide (rename depuis « browser »).
(function migrateUserData() {
  try {
    const dir = app.getPath('userData');
    if (fs.existsSync(path.join(dir, 'state.json'))) return;
    const parent = path.dirname(dir);
    for (const old of ['browser']) {
      const src = path.join(parent, old);
      if (fs.existsSync(path.join(src, 'state.json'))) {
        fs.mkdirSync(dir, { recursive: true });
        for (const f of ['state.json', 'passwords.enc']) { const s = path.join(src, f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dir, f)); }
        return;
      }
    }
  } catch {}
})();

const RAIL = 60;          // colonne des applis
let sidebarWidth = 264;   // colonne des onglets (redimensionnable)
const SIDEBAR_MIN = 180, SIDEBAR_MAX = 520;
const NAV = 56;           // barre de navigation
const DORMANT_AFTER = 2 * 60 * 60 * 1000;      // 2 h sans usage → veille
const ARCHIVE_AFTER = 3 * 24 * 60 * 60 * 1000; // 3 j en veille → archive
const STATE_FILE = path.join(app.getPath('userData'), 'state.json');
const PW_FILE = path.join(app.getPath('userData'), 'passwords.enc');
// Les tâches Claude ont leur propre fichier : state.json peut être réécrit par une autre
// instance de NaX (version installée) qui ignore ces champs et les effacerait.
const CLAUDE_FILE = path.join(app.getPath('userData'), 'claude-tasks.json');

const DEFAULT_APPS = [
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com', icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico' },
  { id: 'agenda', name: 'Agenda', url: 'https://calendar.google.com', icon: 'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_31.ico' },
  { id: 'drive', name: 'Drive', url: 'https://drive.google.com', icon: 'https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png' },
];

// Moteurs de recherche. url : %s = requête. suggest : endpoint de suggestions (format OpenSearch [q,[...]]), ou null.
const SEARCH_ENGINES = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&hl=fr&q=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?q=%s&type=list' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', suggest: 'https://www.bing.com/osjson.aspx?query=%s' },
  { id: 'qwant', name: 'Qwant', url: 'https://www.qwant.com/?q=%s', suggest: null },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', suggest: null },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', suggest: 'https://search.brave.com/api/suggest?q=%s' },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s', suggest: null },
];
let searchEngine = 'google';
function currentEngine() { return SEARCH_ENGINES.find((e) => e.id === searchEngine) || SEARCH_ENGINES[0]; }
function searchUrl(q) { return currentEngine().url.replace('%s', encodeURIComponent(q)); }

// ---------- état ----------
let win, chrome;
let nextId = 1;
let tabs = [];      // {id, url, title, favicon, groupId, lastActive, createdAt, view|null}
let groups = [];    // {id, title|null}
let apps = [];      // {id, name, url}
let archive = [];   // {url, title, favicon, closedAt, groupTitle}
let history = {};   // url normalisée -> {title, url, count, last}
let passwords = []; // {id, name, url, username, password} — chiffré au repos via safeStorage (DPAPI)
let favorites = []; // {id, url, title, favicon}
let current = null; // {kind:'tab'|'app', id}
let sidebarOpen = true;
let overlayOpen = false;
let theme = 'dark'; // 'system' | 'light' | 'dark'
let devMode = false;      // mode développeur : détecte les serveurs de dev locaux
let devProjects = [];     // [{port, url, title}]
let devTimer = null;
let htmlFullscreen = false; // plein écran HTML demandé par une page (vidéo)
let tabMRU = [];          // ids d'onglets par ordre d'utilisation (le plus récent en tête)
let downloads = [];       // {id, filename, url, savePath, received, total, state, paused, ts}
let dlNextId = 1;
const dlItems = new Map(); // id -> DownloadItem (en cours)
const permGrants = new Map(); // "origin|permission" -> bool (persisté entre les sessions)
const appViews = new Map();
let contentView = null; // vue actuellement attachée dans la zone principale

// ---------- Claude (tâches IA via le CLI Claude Code — utilise l'abonnement, aucune clé API) ----------
const CLAUDE_W = 400;          // largeur du panneau latéral (doit suivre --claude-w dans style.css)
let claudeOpen = false;        // panneau visible ?
let claudeTasks = [];          // {id, prompt, title, status:'running'|'done'|'error'|'canceled', createdAt, finishedAt, output, error, activity:[{t,label}], durationMs, numTurns, sessionId}
let claudeNextId = 1;
const claudeProcs = new Map(); // id de tâche -> ChildProcess en cours

// ---------- réglages configurables (persistés) ----------
let homepage = 'https://www.google.com/';
let newTabUrl = '';          // '' = page d'accueil ; 'blank' = page vierge ; sinon URL
let startupMode = 'restore'; // 'restore' | 'home'
let downloadDir = '';        // '' = dossier Téléchargements du système
let askDownloadPath = false;
let defaultZoom = 1;         // facteur de zoom par défaut (1 = 100 %)
let zoomHosts = {};          // hôte -> facteur de zoom mémorisé
let spellcheckOn = false;
let spellLangs = ['fr'];     // langues du correcteur + langues préférées des pages
let acceptLanguage = 'fr';
let permDefaults = { notifications: 'ask', geolocation: 'ask', media: 'ask', popups: 'allow' };
function newTabTarget() { return newTabUrl === 'blank' ? 'about:blank' : (newTabUrl || homepage); }
function defaultDownloadDir() { return downloadDir || app.getPath('downloads'); }
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function applyLanguages() {
  const ses = session.defaultSession;
  try { ses.setSpellCheckerEnabled(!!spellcheckOn); } catch {}
  if (spellcheckOn) {
    try { const avail = ses.availableSpellCheckerLanguages || []; const use = spellLangs.filter((l) => avail.includes(l)); if (use.length) ses.setSpellCheckerLanguages(use); } catch {}
  }
  const base = spellLangs.length ? spellLangs : ['fr'];
  const ordered = [];
  for (const l of base) { if (!ordered.includes(l)) ordered.push(l); const p = l.split('-')[0]; if (!ordered.includes(p)) ordered.push(p); }
  acceptLanguage = ordered.map((l, i) => (i === 0 ? l : `${l};q=${Math.max(0.1, 1 - i * 0.1).toFixed(1)}`)).join(',');
}
function allWebContents() {
  const list = [];
  for (const t of tabs) if (t.view && !t.view.webContents.isDestroyed()) list.push(t.view.webContents);
  for (const v of appViews.values()) if (v && !v.webContents.isDestroyed()) list.push(v.webContents);
  return list;
}
function applyZoom(wc) { try { if (!wc || wc.isDestroyed()) return; const host = hostOf(wc.getURL()); const f = (host && zoomHosts[host]) || defaultZoom || 1; wc.setZoomFactor(f); } catch {} }
function applyZoomToAll() { for (const wc of allWebContents()) applyZoom(wc); }
function zoomStep(wc, dir) {
  if (!wc || wc.isDestroyed()) return;
  const host = hostOf(wc.getURL());
  const cur = wc.getZoomFactor();
  let i = ZOOM_STEPS.reduce((best, s, idx) => Math.abs(s - cur) < Math.abs(ZOOM_STEPS[best] - cur) ? idx : best, 0);
  i = Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir));
  const f = ZOOM_STEPS[i];
  wc.setZoomFactor(f);
  if (host) { if (Math.abs(f - (defaultZoom || 1)) < 0.001) delete zoomHosts[host]; else zoomHosts[host] = f; persist(); }
}
function zoomReset(wc) {
  if (!wc || wc.isDestroyed()) return;
  const host = hostOf(wc.getURL());
  wc.setZoomFactor(defaultZoom || 1);
  if (host) { delete zoomHosts[host]; persist(); }
}

// ---------- vue divisée : le volet droit est un VRAI onglet, lié à son onglet parent ----------
let splitView = null;   // vue de l'onglet secondaire affichée à droite (null hors paire active)
let splitMode = null;   // 'shared' | 'private' (déduit de l'onglet secondaire)
let splitRatio = 0.5;   // largeur relative du volet gauche
let splitSeq = 1;       // compteur pour des partitions privées uniques
const SPLIT_GAP = 6;    // écart entre les deux volets (zone du séparateur)
function splitPartition(mode) {
  // TODO (profil persistant) : pour un profil conservé entre les lancements, renvoyer `persist:nax-profile-<nom>`.
  if (mode === 'private') return 'nax-private-' + (splitSeq++); // en mémoire, stable pour l'onglet → login conservé le temps de la session
  return null; // partagé : session par défaut (même connexion qu'à gauche)
}
const isPrivate = (t) => !!(t && t.partition && String(t.partition).startsWith('nax-private')); // navigation privée (jetable)
const isIsolated = (t) => !!(t && t.partition); // session isolée (privée ou autre profil) → pas d'historique/archive partagés
function secondaryOf(tab) { return tab ? tabs.find((t) => t.splitParent === tab.id) : null; }
function pairOf(tab) {
  if (!tab) return null;
  if (tab.splitParent) { const p = tabById(tab.splitParent); return p ? { primary: p, secondary: tab } : null; }
  const s = secondaryOf(tab); return s ? { primary: tab, secondary: s } : null;
}
function setSplitView(view) {
  if (splitView === view) return;
  if (splitView) { try { win.contentView.removeChildView(splitView); } catch {} } // détache l'affichage sans fermer l'onglet
  splitView = view || null;
  if (splitView) { try { win.contentView.addChildView(splitView); } catch {} splitView.setVisible(!overlayOpen); }
  layout();
}
// Affiche l'onglet courant : seul, ou en paire (primaire à gauche, secondaire à droite).
function showActive() {
  const cur = current && current.kind === 'tab' ? tabById(current.id) : (current && current.kind === 'app' ? null : null);
  if (current && current.kind === 'app') { const v = appViews.get(current.id); attach(v || null); setSplitView(null); splitMode = null; return; }
  const pair = cur ? pairOf(cur) : null;
  if (pair) {
    wakeTab(pair.primary); wakeTab(pair.secondary);
    pair.primary.lastActive = pair.secondary.lastActive = Date.now(); // les deux restent éveillés
    attach(pair.primary.view);
    setSplitView(pair.secondary.view);
    splitMode = pair.secondary.partition ? 'private' : 'shared';
  } else {
    attach(cur ? cur.view : null);
    setSplitView(null);
    splitMode = null;
  }
}
// Change la session d'un onglet (normale ⇄ privée) en recréant sa vue ; la page se recharge.
function setTabSession(id, makePrivate) {
  const tab = tabById(id); if (!tab) return;
  if (!!tab.partition === !!makePrivate) return; // déjà dans l'état voulu
  if (makePrivate) tab.partition = splitPartition('private'); else delete tab.partition;
  if (tab.splitMode) tab.splitMode = makePrivate ? 'private' : 'shared';
  if (tab.view && !tab.view.webContents.isDestroyed()) {
    tab.url = tab.view.webContents.getURL() || tab.url;
    if (contentView === tab.view) attach(null);
    if (splitView === tab.view) setSplitView(null);
    tab.view.webContents.close();
  }
  tab.view = null;
  wakeTab(tab); // recrée la vue dans la nouvelle session et recharge l'URL
  const cur = current && current.kind === 'tab' ? tabById(current.id) : null;
  const pair = cur ? pairOf(cur) : null;
  if (isCurrentTab(id) || (pair && (pair.primary.id === id || pair.secondary.id === id))) showActive();
  sendState();
}
function openSplit(mode) {
  const cur = current && current.kind === 'tab' ? tabById(current.id) : null;
  if (!cur || cur.splitParent || secondaryOf(cur)) return; // pas déjà dans une paire
  mode = mode === 'private' ? 'private' : 'shared';
  const b = newTab({ url: cur.url, openerId: cur.id, activate: false, partition: splitPartition(mode), splitParent: cur.id });
  b.splitMode = mode;
  activateTab(cur.id); // réaffiche en montrant la paire
}
function closeSplit() {
  const cur = current && current.kind === 'tab' ? tabById(current.id) : null;
  const pair = cur ? pairOf(cur) : null;
  if (pair) closeTab(pair.secondary.id); // ferme le volet secondaire (c'est un onglet)
}

// ---------- persistance ----------
function load() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    nextId = s.nextId || 1;
    tabs = (s.tabs || []).map((t) => ({ ...t, view: null }));
    groups = s.groups || [];
    apps = s.apps && s.apps.length ? s.apps : DEFAULT_APPS;
    archive = s.archive || [];
    history = s.history || {};
    favorites = (s.favorites || []).map(favMigrate);
    sidebarOpen = s.sidebarOpen !== false;
    if (s.sidebarWidth) sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, s.sidebarWidth));
    if (['system', 'light', 'dark'].includes(s.theme)) theme = s.theme;
    devMode = !!s.devMode;
    if (s.searchEngine && SEARCH_ENGINES.some((e) => e.id === s.searchEngine)) searchEngine = s.searchEngine;
    if (s.perms) for (const [k, v] of Object.entries(s.perms)) permGrants.set(k, v);
    if (typeof s.homepage === 'string' && s.homepage) homepage = s.homepage;
    if (typeof s.newTabUrl === 'string') newTabUrl = s.newTabUrl;
    if (s.startupMode === 'restore' || s.startupMode === 'home') startupMode = s.startupMode;
    if (typeof s.downloadDir === 'string') downloadDir = s.downloadDir;
    askDownloadPath = !!s.askDownloadPath;
    if (typeof s.defaultZoom === 'number' && s.defaultZoom > 0) defaultZoom = s.defaultZoom;
    if (s.zoomHosts && typeof s.zoomHosts === 'object') zoomHosts = s.zoomHosts;
    spellcheckOn = !!s.spellcheckOn;
    if (Array.isArray(s.spellLangs) && s.spellLangs.length) spellLangs = s.spellLangs;
    if (s.permDefaults && typeof s.permDefaults === 'object') permDefaults = { ...permDefaults, ...s.permDefaults };
    loadClaudeTasks(s);
    return s.currentTabId || null;
  } catch {
    apps = DEFAULT_APPS;
    loadClaudeTasks(null);
    return null;
  }
}
// Charge les tâches Claude depuis leur fichier dédié (migration depuis state.json au premier passage).
function loadClaudeTasks(stateFallback) {
  let c = null;
  try { c = JSON.parse(fs.readFileSync(CLAUDE_FILE, 'utf8')); } catch {}
  if (!c && stateFallback && Array.isArray(stateFallback.claudeTasks)) {
    c = { tasks: stateFallback.claudeTasks, nextId: stateFallback.claudeNextId, claudeOpen: stateFallback.claudeOpen };
  }
  if (!c) return;
  // celles encore « running » à la fermeture sont marquées interrompues
  claudeTasks = (c.tasks || []).map((t) => (t.status === 'running' ? { ...t, status: 'error', error: 'Interrompue à la fermeture de NaX', finishedAt: t.finishedAt || Date.now() } : t));
  claudeNextId = c.nextId || claudeTasks.reduce((m, t) => Math.max(m, t.id || 0), 0) + 1;
  claudeOpen = !!c.claudeOpen;
  persistClaudeTasks(); // écrit le fichier dédié dès le chargement (migration comprise)
}
let claudeSaveTimer = null;
function persistClaudeTasks() {
  clearTimeout(claudeSaveTimer);
  claudeSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(CLAUDE_FILE, JSON.stringify({ tasks: claudeTasks, nextId: claudeNextId, claudeOpen })); } catch {}
  }, 300);
}
function snapshot() {
  return {
    nextId, groups, apps, archive, history, favorites, sidebarOpen, sidebarWidth, theme, devMode, searchEngine,
    homepage, newTabUrl, startupMode, downloadDir, askDownloadPath, defaultZoom, zoomHosts, spellcheckOn, spellLangs, permDefaults,
    perms: Object.fromEntries(permGrants),
    tabs: tabs.filter((t) => !isPrivate(t)).map(({ view, ...t }) => t), // onglets privés non persistés (rien sur le disque)
    currentTabId: current && current.kind === 'tab' ? current.id : null,
  };
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(snapshot())); } catch {} }, 300);
}

// ---------- données de navigation ----------
function browsingDataStats() {
  return {
    history: Object.keys(history).length,
    archive: archive.length,
    perms: permGrants.size,
    downloads: downloads.length,
  };
}
function historyList() {
  return Object.entries(history)
    .map(([key, h]) => ({ key, url: h.url, title: h.title, count: h.count || 1, last: h.last || 0 }))
    .sort((a, b) => (b.last || 0) - (a.last || 0));
}
function permsList() {
  return [...permGrants].map(([key, allowed]) => { const i = key.indexOf('|'); return { key, origin: i < 0 ? key : key.slice(0, i), permission: i < 0 ? '' : key.slice(i + 1), allowed }; });
}
async function cookiesList() {
  try {
    const all = await session.defaultSession.cookies.get({});
    const map = new Map();
    for (const c of all) { const d = (c.domain || '').replace(/^\./, ''); if (!d) continue; map.set(d, (map.get(d) || 0) + 1); }
    return [...map.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => a.domain.localeCompare(b.domain));
  } catch { return []; }
}
async function cookiesRemoveDomain(domain) {
  const ses = session.defaultSession, d = (domain || '').replace(/^\./, '');
  try {
    const all = await ses.cookies.get({});
    await Promise.all(all.filter((c) => (c.domain || '').replace(/^\./, '') === d).map((c) => {
      const host = (c.domain || '').replace(/^\./, '');
      const url = (c.secure ? 'https://' : 'http://') + host + (c.path || '/');
      return ses.cookies.remove(url, c.name).catch(() => {});
    }));
    for (const scheme of ['https://', 'http://']) {
      try { await ses.clearStorageData({ origin: scheme + d, storages: ['localstorage', 'indexdb', 'serviceworkers', 'websql', 'filesystem', 'cachestorage'] }); } catch {}
    }
  } catch {}
  return cookiesList();
}
async function clearBrowsingData(opts = {}) {
  const ses = session.defaultSession;
  if (opts.history) { history = {}; }
  if (opts.archive) { archive = []; }
  if (opts.perms) { permGrants.clear(); }
  if (opts.downloads) { downloads = downloads.filter((d) => d.state === 'progressing' || d.state === 'paused'); sendDownloads(); }
  try {
    if (opts.cookies) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'websql', 'filesystem'] });
    if (opts.cache) { await ses.clearCache(); await ses.clearStorageData({ storages: ['cachestorage', 'shadercache'] }); }
  } catch {}
  persist();
  sendState();
  return browsingDataStats();
}

// ---------- coffre de mots de passe ----------
// Chiffré au repos avec safeStorage (coffre Windows lié à la session). Jamais en clair sur le disque.
function loadPasswords() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const raw = fs.readFileSync(PW_FILE);
    passwords = JSON.parse(safeStorage.decryptString(raw));
  } catch { passwords = []; }
}
function persistPasswords() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.writeFileSync(PW_FILE, safeStorage.encryptString(JSON.stringify(passwords)), { mode: 0o600 });
  } catch {}
}
// Parseur CSV minimal (gère les guillemets et les retours ligne dans les champs).
function parseCsv(text) {
  const rows = []; let field = '', row = [], inQ = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
async function importPasswordsCsv() {
  if (!safeStorage.isEncryptionAvailable()) return { error: 'Le chiffrement sécurisé est indisponible sur ce système.' };
  const res = await dialog.showOpenDialog(win, {
    title: 'Importer le CSV exporté depuis Chrome',
    filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  const file = res.filePaths[0];
  let rows;
  try { rows = parseCsv(fs.readFileSync(file, 'utf8')); } catch { return { error: 'Lecture du fichier impossible.' }; }
  if (rows.length < 2) return { imported: 0, updated: 0, total: passwords.length, file };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const ci = { name: col('name', 'title'), url: col('url', 'origin_url', 'origin'), user: col('username', 'username_value', 'login'), pass: col('password', 'password_value') };
  if (ci.pass < 0) return { error: 'Colonne « password » introuvable. Est-ce bien un export Chrome ?' };
  let imported = 0, updated = 0;
  for (const r of rows.slice(1)) {
    if (!r.length || r.every((c) => !c)) continue;
    const url = (r[ci.url] || '').trim(), username = (r[ci.user] || '').trim(), password = r[ci.pass] || '';
    if (!password && !username) continue;
    const name = (r[ci.name] || '').trim() || hostOf(url) || url;
    const key = normalize(url) + '\u0000' + username;
    const ex = passwords.find((p) => normalize(p.url) + '\u0000' + p.username === key);
    if (ex) { ex.password = password; ex.name = name; updated++; }
    else { passwords.push({ id: 'pw' + nextId++, name, url, username, password }); imported++; }
  }
  persistPasswords();
  return { imported, updated, total: passwords.length, file };
}

// ---------- helpers ----------
const tabById = (id) => tabs.find((t) => t.id === id);
const groupById = (id) => groups.find((g) => g.id === id);
const isCurrentTab = (id) => !!current && current.kind === 'tab' && current.id === id;

function normalize(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch { return url; }
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
function searchQuery(url) {
  try { const u = new URL(url); if (u.hostname.includes('google.') && u.pathname === '/search') return (u.searchParams.get('q') || '').trim().toLowerCase(); } catch {}
  return null;
}
// Même cible ? URL identique, ou même recherche Google, ou (si on a tapé juste un domaine) même site.
function sameTarget(wanted, tabUrl) {
  if (normalize(wanted) === normalize(tabUrl)) return true;
  const q = searchQuery(wanted);
  if (q) return q === searchQuery(tabUrl);
  try {
    const w = new URL(wanted);
    // domaine seul tapé → même site, mais on compare l'hôte AVEC le port
    // (sinon tous les localhost:xxxx sont vus comme identiques)
    if ((w.pathname === '/' || w.pathname === '') && !w.search) return w.host === new URL(tabUrl).host;
  } catch {}
  return false;
}

function toUrl(input) {
  const s = (input || '').trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(s) || /^localhost(:\d+)?/.test(s)) return 'https://' + s;
  return searchUrl(s);
}

// Titre déduit d'un groupe : requête Google du 1er onglet, sinon son titre, sinon son domaine.
function groupTitle(g) {
  if (!g) return '';
  if (g.title) return g.title;
  const root = tabs.find((t) => t.groupId === g.id);
  if (!root) return '';
  try {
    const u = new URL(root.url);
    if (u.hostname.includes('google.') && u.pathname === '/search' && u.searchParams.get('q')) return u.searchParams.get('q');
  } catch {}
  return root.title || hostOf(root.url);
}

// ---------- layout ----------
function mainBounds() {
  const { width, height } = win.getContentBounds();
  const x = RAIL + (sidebarOpen ? sidebarWidth : 0);
  const right = claudeOpen ? CLAUDE_W : 0; // place du panneau Claude
  return { x, y: NAV, width: Math.max(0, width - x - right), height: Math.max(0, height - NAV) };
}
function layout() {
  const { width, height } = win.getContentBounds();
  if (htmlFullscreen && contentView) {
    // plein écran HTML (vidéo) : la page couvre toute la fenêtre, l'interface est masquée
    chrome.setVisible(false);
    contentView.setBounds({ x: 0, y: 0, width, height });
    return;
  }
  chrome.setVisible(true);
  chrome.setBounds({ x: 0, y: 0, width, height });
  const b = mainBounds();
  if (splitView) {
    const leftW = Math.max(140, Math.round((b.width - SPLIT_GAP) * splitRatio));
    const rightW = Math.max(140, b.width - SPLIT_GAP - leftW);
    if (contentView) contentView.setBounds({ x: b.x, y: b.y, width: leftW, height: b.height });
    splitView.setBounds({ x: b.x + leftW + SPLIT_GAP, y: b.y, width: rightW, height: b.height });
  } else if (contentView) {
    contentView.setBounds(b);
  }
}
function attach(view) {
  if (contentView === view) return;
  if (contentView) win.contentView.removeChildView(contentView);
  contentView = view;
  if (view) {
    win.contentView.addChildView(view);
    view.setVisible(!overlayOpen);
    // garde le volet droit au-dessus dans l'ordre d'empilement
    if (splitView) { try { win.contentView.removeChildView(splitView); win.contentView.addChildView(splitView); } catch {} }
  }
  layout();
}

// ---------- état → UI ----------
let stateScheduled = false;
function sendState() {
  if (stateScheduled) return;
  stateScheduled = true;
  setImmediate(() => {
    stateScheduled = false;
    const wc = currentWC();
    const live = wc && !wc.isDestroyed();
    const ct = current && current.kind === 'tab' ? tabById(current.id) : null;
    chrome.webContents.send('state', {
      tabs: tabs.map(({ view, ...t }) => ({ ...t, dormant: !view, loading: !!view && !view.webContents.isDestroyed() && view.webContents.isLoading() })),
      groups: groups.map((g) => ({ id: g.id, title: groupTitle(g), custom: !!g.title, collapsed: !!g.collapsed, claude: !!g.claude, claudeTaskId: g.claudeTaskId || null, bornAt: g.bornAt || 0 })),
      apps, current, sidebarOpen, sidebarWidth, overlayOpen, theme,
      claudeOpen, claudeRunning: claudeTasks.filter((t) => t.status === 'running').length,
      favorites, favActive: !!(ct && favByUrl(ct.url)),
      devMode, devProjects,
      searchEngine, searchEngines: SEARCH_ENGINES.map((e) => ({ id: e.id, name: e.name })),
      archiveCount: archive.length,
      nav: live ? {
        url: (ct && isErrorPage(wc.getURL()) && ct.errorURL) ? ct.errorURL : wc.getURL(),
        title: wc.getTitle(), loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(),
      } : { url: '', title: '', loading: false, canGoBack: false, canGoForward: false },
      navPrivate: !!(ct && ct.partition && String(ct.partition).startsWith('nax-private')),
      split: (() => {
        const p = ct ? pairOf(ct) : null;
        return p ? { active: true, mode: splitMode, primaryId: p.primary.id, secondaryId: p.secondary.id } : { active: false };
      })(),
      splitRatio,
      splitNav: (splitView && !splitView.webContents.isDestroyed()) ? {
        url: splitView.webContents.getURL(), title: splitView.webContents.getTitle(),
        loading: splitView.webContents.isLoading(),
        canGoBack: splitView.webContents.navigationHistory.canGoBack(),
        canGoForward: splitView.webContents.navigationHistory.canGoForward(),
      } : null,
    });
    persist();
  });
}
function currentWC() {
  if (!current) return null;
  if (current.kind === 'tab') { const t = tabById(current.id); return t && t.view ? t.view.webContents : null; }
  const v = appViews.get(current.id); return v ? v.webContents : null;
}
// Vue réellement affichée (celle attachée), pour les actions qui doivent viser l'écran (recherche…).
function visibleWC() { return contentView && !contentView.webContents.isDestroyed() ? contentView.webContents : currentWC(); }

// ---------- onglets ----------
const NAV_EVENTS = ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated', 'page-favicon-updated'];
function createView(onEvent, partition) {
  const view = new WebContentsView({ webPreferences: { sandbox: true, ...(partition ? { partition } : {}) } });
  for (const ev of NAV_EVENTS) view.webContents.on(ev, (...args) => onEvent(ev, ...args));
  return view;
}

function wakeTab(tab) {
  if (tab.view) return;
  tab.view = createView((ev, _e, arg) => {
    if (!tab.view) return;
    const wc = tab.view.webContents;
    const onErr = isErrorPage(wc.getURL());
    if (ev === 'page-favicon-updated' && Array.isArray(arg) && arg[0]) tab.favicon = arg[0];
    if (ev === 'did-navigate') { tab.url = onErr ? (tab.errorURL || tab.url) : wc.getURL(); if (!onErr) { tab.favicon = null; tab.errorURL = null; } }
    if (ev === 'did-navigate-in-page') { if (!onErr) tab.url = wc.getURL(); }
    if (ev === 'page-title-updated') { if (!onErr) tab.title = wc.getTitle(); }
    if (ev === 'did-stop-loading' && !onErr) {
      tab.title = wc.getTitle() || tab.title;
      // navigation privée / session isolée : aucune trace dans l'historique
      if (!isIsolated(tab)) {
        const key = normalize(tab.url);
        const h = history[key] || { count: 0 };
        history[key] = { title: tab.title, url: tab.url, count: h.count + 1, last: Date.now() };
      }
    }
    if (isCurrentTab(tab.id)) win.setTitle((onErr ? hostOf(tab.url) : tab.title) || 'NaX');
    sendState();
  }, tab.partition);
  const wc = tab.view.webContents;
  wc.setWindowOpenHandler(({ url, disposition }) => {
    // blocage des pop-ups : uniquement les fenêtres scriptées (window.open avec options), pas les liens _blank
    if (permDefaults.popups === 'block' && disposition === 'new-window') return { action: 'deny' };
    newTab({ url, openerId: tab.id, activate: disposition !== 'background-tab' });
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, params) => pageContextMenu(wc, params, tab.id));
  wc.on('found-in-page', (_e, r) => { if (findWin && !findWin.isDestroyed() && findWin.isVisible()) findWin.webContents.send('find-result', { active: r.activeMatchOrdinal, total: r.matches }); });
  wc.on('enter-html-full-screen', () => { if (isCurrentTab(tab.id)) enterHtmlFullscreen(); });
  wc.on('leave-html-full-screen', () => leaveHtmlFullscreen());
  wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    // -3 = requête abandonnée (navigation normale), on ignore ; on ignore aussi les échecs de la page d'erreur elle-même
    if (isMainFrame && code !== -3 && !isErrorPage(failedUrl) && failedUrl && failedUrl !== 'about:blank') loadErrorPage(tab, failedUrl, code, desc);
  });
  // Injecte l'overlay « Détacher la vidéo » (PiP) + applique le zoom (par site ou par défaut) à chaque chargement.
  wc.on('dom-ready', () => { if (PIP_INJECT) wc.executeJavaScript(PIP_INJECT).catch(() => {}); applyZoom(wc); });
  wc.loadURL(tab.url);
}

function sleepTab(tab) {
  if (!tab.view || isCurrentTab(tab.id)) return;
  // ne pas endormir un volet actuellement affiché dans la vue divisée
  const cur = current && current.kind === 'tab' ? tabById(current.id) : null;
  const pair = cur ? pairOf(cur) : null;
  if (pair && (tab.id === pair.primary.id || tab.id === pair.secondary.id)) return;
  const v = tab.view; tab.view = null;
  v.webContents.close();
  sendState();
}

function newTab({ url = newTabTarget(), openerId = null, groupId = null, activate = true, partition = null, splitParent = null } = {}) {
  const opener = openerId ? tabById(openerId) : null;
  let gid = groupId ?? (opener ? opener.groupId : null);
  if (gid == null) { gid = nextId++; groups.push({ id: gid, title: null }); }
  const tab = { id: nextId++, url, title: hostOf(url), favicon: null, groupId: gid, lastActive: Date.now(), createdAt: Date.now(), view: null };
  if (partition) tab.partition = partition;
  if (splitParent) tab.splitParent = splitParent;
  // insérer à la fin de l'îlot de l'ouvreur pour le garder contigu et dans l'ordre d'ouverture
  let idx = tabs.length;
  if (opener) { idx = tabs.indexOf(opener) + 1; while (idx < tabs.length && tabs[idx].groupId === gid) idx++; }
  tabs.splice(idx, 0, tab);
  wakeTab(tab);
  if (activate) activateTab(tab.id); else sendState();
  return tab;
}

function activateTab(id) {
  let tab = tabById(id);
  if (!tab) return;
  // cliquer le volet secondaire active la paire ; le primaire reste le pilote de gauche
  const pair = pairOf(tab);
  const activeTab = pair ? pair.primary : tab;
  wakeTab(activeTab);
  // arriver sur un onglet d'un groupe replié (Ctrl+Tab, cycle…) déplie le groupe, sinon l'onglet actif reste invisible
  const grp = groupById(activeTab.groupId);
  if (grp && grp.collapsed) grp.collapsed = false;
  activeTab.lastActive = Date.now();
  tabMRU = [activeTab.id, ...tabMRU.filter((x) => x !== activeTab.id)]; // ordre d'utilisation : le plus récent en tête
  current = { kind: 'tab', id: activeTab.id };
  showActive();
  if (activeTab.view) activeTab.view.webContents.focus();
  win.setTitle(activeTab.title || 'NaX');
  hidePeek(); hideFind();
  sendState();
}
// Dernier onglet utilisé (hors onglet courant) : pour Ctrl+Tab.
function lastUsedTab() {
  const cur = current && current.kind === 'tab' ? current.id : null;
  for (const id of tabMRU) if (id !== cur && tabById(id)) return id;
  const other = tabs.find((t) => t.id !== cur); return other ? other.id : null;
}

function closeTab(id, { toArchive = true } = {}) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];
  // si on ferme le volet primaire, son secondaire redevient un onglet normal
  const sec = secondaryOf(tab);
  if (sec) { delete sec.splitParent; delete sec.splitMode; }
  const g = groupById(tab.groupId);
  // les onglets en session isolée (privée/profil) ne vont pas dans l'archive
  if (toArchive && !isIsolated(tab) && tab.url && normalize(tab.url) !== normalize(homepage)) {
    archive.unshift({ url: tab.url, title: tab.title, favicon: tab.favicon, closedAt: Date.now(), groupTitle: groupTitle(g) });
    if (archive.length > 2000) archive.length = 2000;
  }
  tabs.splice(idx, 1);
  tabMRU = tabMRU.filter((x) => x !== id);
  if (!tabs.some((t) => t.groupId === tab.groupId)) groups = groups.filter((x) => x.id !== tab.groupId);
  const wasCurrent = isCurrentTab(id);
  if (tab.view) { if (contentView === tab.view) attach(null); if (splitView === tab.view) setSplitView(null); tab.view.webContents.close(); tab.view = null; }
  if (wasCurrent) {
    current = null;
    // le dernier onglet utilisé d'abord, sinon un voisin du même groupe, sinon l'onglet à la même position
    const mru = tabMRU.find((x) => tabById(x));
    const next = (mru && tabById(mru)) || tabs.find((t) => t.groupId === tab.groupId) || tabs[Math.min(idx, tabs.length - 1)];
    if (next) activateTab(next.id); else newTab();
  } else { showActive(); sendState(); }
}

// Dédoublonnage : si l'URL est déjà ouverte, on y va au lieu d'ouvrir une 2e fois.
function navigateCurrent(input) {
  const url = toUrl(input);
  if (!url) return;
  const cur = current && current.kind === 'tab' ? tabById(current.id) : null;
  const dup = tabs.find((t) => t !== cur && sameTarget(url, t.url));
  if (dup) {
    // un onglet vierge fraîchement ouvert n'a pas de raison de rester
    if (cur && normalize(cur.url) === normalize(homepage) && cur.createdAt > Date.now() - 5 * 60 * 1000) closeTab(cur.id, { toArchive: false });
    activateTab(dup.id);
    return;
  }
  if (cur && cur.view) cur.view.webContents.loadURL(url);
  else newTab({ url });
}

// ---------- organisation manuelle (drag & drop) ----------
// Invariant : les onglets d'un même groupe sont contigus dans `tabs`, et l'ordre des groupes
// suit la 1re apparition. On réordonne librement puis on renormalise pour tenir l'invariant.
function normalizeGroups() {
  const order = []; const seen = new Set();
  for (const t of tabs) if (!seen.has(t.groupId)) { seen.add(t.groupId); order.push(t.groupId); }
  const byGroup = new Map(order.map((g) => [g, []]));
  for (const t of tabs) byGroup.get(t.groupId).push(t);
  tabs = order.flatMap((g) => byGroup.get(g));
}
// Déplace un onglet : réordonner, rejoindre un groupe, ou en sortir (nouveau groupe).
function moveTab({ tabId, afterTabId = null, targetGroupId = null, makeNewGroup = false }) {
  const tab = tabById(tabId); if (!tab) return;
  const oldGroupId = tab.groupId;
  let gid;
  if (makeNewGroup) { gid = nextId++; groups.push({ id: gid, title: null }); }
  else if (targetGroupId != null && groupById(targetGroupId)) gid = targetGroupId;
  else gid = tab.groupId;
  tabs = tabs.filter((t) => t.id !== tabId);
  tab.groupId = gid;
  let idx;
  if (afterTabId == null) idx = 0;
  else { const i = tabs.findIndex((t) => t.id === afterTabId); idx = i < 0 ? tabs.length : i + 1; }
  tabs.splice(idx, 0, tab);
  normalizeGroups();
  if (oldGroupId !== gid && !tabs.some((t) => t.groupId === oldGroupId)) groups = groups.filter((g) => g.id !== oldGroupId);
  sendState();
}
// Déplace un groupe entier avant un autre groupe (ou à la fin si beforeGroupId absent).
function moveGroup({ groupId, beforeGroupId = null }) {
  const members = tabs.filter((t) => t.groupId === groupId);
  if (!members.length) return;
  const rest = tabs.filter((t) => t.groupId !== groupId);
  let idx = rest.length;
  if (beforeGroupId != null) { const i = rest.findIndex((t) => t.groupId === beforeGroupId); if (i >= 0) idx = i; }
  rest.splice(idx, 0, ...members);
  tabs = rest;
  normalizeGroups();
  sendState();
}

// ---------- favoris (arbre : liens + dossiers imbriqués) ----------
// node = { id, type:'link'|'folder', title, url?, favicon?, children?, collapsed? }
function favWalk(nodes, fn, parent = null) { for (const n of nodes) { fn(n, parent); if (n.children) favWalk(n.children, fn, n); } }
function favFind(id, nodes = favorites, parent = null) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return { node: n, parent, list: nodes, index: i };
    if (n.children) { const r = favFind(id, n.children, n); if (r) return r; }
  }
  return null;
}
function favByUrl(url, nodes = favorites) {
  for (const n of nodes) {
    if (n.type === 'link' && normalize(n.url) === normalize(url)) return n;
    if (n.children) { const r = favByUrl(url, n.children); if (r) return r; }
  }
  return null;
}
function favIsDescendant(ancestorId, id) {
  const a = favFind(ancestorId); if (!a || !a.node.children) return false;
  let found = false; favWalk(a.node.children, (n) => { if (n.id === id) found = true; }); return found;
}
function favMigrate(n) { if (!n.type) n.type = n.children ? 'folder' : 'link'; if (n.children) n.children.forEach(favMigrate); return n; }

function addFavorite({ url, title, favicon, parentId = null }) {
  if (!url || favByUrl(url)) return;
  const node = { id: 'fav' + nextId++, type: 'link', url, title: title || hostOf(url), favicon: favicon || null };
  const list = parentId ? (favFind(parentId) || {}).node?.children : favorites;
  (list || favorites).push(node); sendState();
}
function createFolder({ title = 'Nouveau dossier', parentId = null } = {}) {
  const node = { id: 'fav' + nextId++, type: 'folder', title, children: [], collapsed: false };
  const list = parentId ? (favFind(parentId) || {}).node?.children : favorites;
  (list || favorites).push(node); sendState(); return node.id;
}
function removeFavorite(id) { const r = favFind(id); if (r) { r.list.splice(r.index, 1); sendState(); } }
function renameFavorite(id, title) { const r = favFind(id); if (r) { r.node.title = (title || '').trim() || r.node.title; sendState(); } }
function toggleFolder(id) { const r = favFind(id); if (r && r.node.type === 'folder') { r.node.collapsed = !r.node.collapsed; sendState(); } }
function toggleFavoriteUrl(url, title, favicon) { const ex = favByUrl(url); if (ex) removeFavorite(ex.id); else addFavorite({ url, title, favicon }); }
function openAllInFolder(id) { const r = favFind(id); if (r && r.node.children) favWalk(r.node.children, (n) => { if (n.type === 'link') newTab({ url: n.url, activate: false }); }); }
// Déplacement : dans un dossier (targetParentId) avant beforeId, ou à la fin. Empêche les cycles.
function moveFavorite({ id, targetParentId = null, beforeId = null }) {
  const r = favFind(id); if (!r) return;
  if (targetParentId && (targetParentId === id || favIsDescendant(id, targetParentId))) return;
  if (targetParentId) { const t = favFind(targetParentId); if (!t || t.node.type !== 'folder') return; }
  const [node] = r.list.splice(r.index, 1);
  const list = targetParentId ? favFind(targetParentId).node.children : favorites;
  let i = beforeId ? list.findIndex((x) => x.id === beforeId) : list.length;
  if (i < 0) i = list.length;
  list.splice(i, 0, node); sendState();
}

// ---------- mode développeur : détection des serveurs de dev locaux ----------
const DEV_PORT_MIN = 2000, DEV_PORT_MAX = 9999;
// Ports d'API/back courants qu'on ne veut pas proposer comme « page front » même s'ils rendent du HTML.
const DEV_PORT_SKIP = new Set([9229, 9230]); // inspecteur Node
function listListeningPorts() {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const ports = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const cols = line.trim().split(/\s+/);
        const local = cols[1] || '';
        const mm = local.match(/:(\d+)$/);
        if (!mm) continue;
        const port = +mm[1];
        // on garde tout port en écoute dans la plage dev, quel que soit l'hôte (on sondera 127.0.0.1)
        if (port >= DEV_PORT_MIN && port <= DEV_PORT_MAX && !DEV_PORT_SKIP.has(port)) ports.add(port);
      }
      resolve([...ports]);
    });
  });
}
// Sonde HTTP : garde ce qui sert une page front (HTML au root, ou une redirection qu'on suit),
// pas les API JSON. Tolère les démarrages à froid (timeout large) et les content-type absents.
function probeDevPort(port, redirectsLeft = 2, reqPath = '/') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.get({ host: '127.0.0.1', port, path: reqPath, headers: { Accept: 'text/html', 'User-Agent': 'browser-dev-scan' } }, (res) => {
      const status = res.statusCode || 0;
      const ct = res.headers['content-type'] || '';
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.destroy();
        try { const u = new URL(res.headers.location, `http://127.0.0.1:${port}/`); if (['127.0.0.1', 'localhost'].includes(u.hostname)) return finish(probeDevPort(port, redirectsLeft - 1, u.pathname + u.search)); } catch {}
        return finish({ port, url: `http://localhost:${port}/`, title: 'localhost:' + port });
      }
      if (/application\/json|text\/plain|application\/octet-stream/i.test(ct)) { res.destroy(); return finish(null); } // API : on écarte
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 32768) res.destroy(); });
      const end = () => {
        const looksHtml = /text\/html/i.test(ct) || /<(!doctype|html|head|title|body|div|script|link|meta)\b/i.test(body);
        if (status >= 200 && status < 400 && looksHtml) {
          const m = body.match(/<title[^>]*>([^<]*)<\/title>/i);
          finish({ port, url: `http://localhost:${port}/`, title: (m && m[1].trim()) || ('localhost:' + port) });
        } else finish(null);
      };
      res.on('end', end); res.on('close', end);
    });
    req.setTimeout(1800, () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
  });
}
async function scanDevProjects() {
  if (!devMode) return;
  const ports = await listListeningPorts();
  const results = (await Promise.all(ports.map((p) => probeDevPort(p)))).filter(Boolean).sort((a, b) => a.port - b.port);
  if (JSON.stringify(results) !== JSON.stringify(devProjects)) { devProjects = results; sendState(); }
}
function setDevMode(on) {
  devMode = !!on;
  if (devTimer) { clearInterval(devTimer); devTimer = null; }
  if (devMode) { scanDevProjects(); devTimer = setInterval(scanDevProjects, 4000); }
  else devProjects = [];
  sendState();
}

// ---------- téléchargements ----------
function sendDownloads() { if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('downloads', downloads.map((d) => ({ ...d }))); }
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 1; i < 1000; i++) { const cand = path.join(dir, `${base} (${i})${ext}`); if (!fs.existsSync(cand)) return cand; }
  return p;
}
function initDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    let savePath = '';
    if (askDownloadPath) {
      // on ne fixe pas le chemin : Electron affiche la boîte native « Enregistrer sous »
    } else {
      savePath = uniquePath(path.join(defaultDownloadDir(), item.getFilename()));
      item.setSavePath(savePath);
    }
    const rec = { id: dlNextId++, filename: savePath ? path.basename(savePath) : item.getFilename(), url: item.getURL(), savePath, received: 0, total: item.getTotalBytes(), state: 'progressing', paused: false, ts: Date.now() };
    downloads.unshift(rec);
    if (downloads.length > 100) downloads.length = 100;
    dlItems.set(rec.id, item);
    sendDownloads();
    if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('download-started');
    const syncPath = () => { const p = item.getSavePath(); if (p && p !== rec.savePath) { rec.savePath = p; rec.filename = path.basename(p); } };
    item.on('updated', (_e, state) => { syncPath(); rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes(); rec.paused = item.isPaused(); rec.state = state === 'interrupted' ? 'interrupted' : (rec.paused ? 'paused' : 'progressing'); sendDownloads(); });
    item.on('done', (_e, state) => { syncPath(); rec.state = state; rec.received = item.getReceivedBytes(); rec.total = rec.total || item.getReceivedBytes(); dlItems.delete(rec.id); sendDownloads(); });
  });
}

// ---------- permissions (caméra, micro, notifications, géoloc…) ----------
const PERM_LABELS = { media: 'utiliser votre caméra et/ou votre micro', 'clipboard-read': 'lire le presse-papiers', geolocation: 'accéder à votre position', notifications: 'afficher des notifications', 'midi-sysex': 'accéder à vos périphériques MIDI', pointerLock: 'verrouiller le pointeur' };
const PERM_ASK = new Set(['media', 'geolocation', 'notifications', 'midi-sysex', 'clipboard-read']);
const PERM_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'idle-detection', 'background-sync']);
function originOf(u) { try { return new URL(u).origin; } catch { return u || ''; } }
function initPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (PERM_ALLOW.has(permission)) return callback(true);
    if (!PERM_ASK.has(permission)) return callback(false);
    // politique par défaut de l'utilisateur : « bloquer » = refus sans demander
    const dkey = permission === 'media' ? 'media' : permission === 'geolocation' ? 'geolocation' : permission === 'notifications' ? 'notifications' : null;
    if (dkey && permDefaults[dkey] === 'block') return callback(false);
    const origin = originOf((details && details.requestingUrl) || (wc && wc.getURL()));
    const key = origin + '|' + permission;
    if (permGrants.has(key)) return callback(permGrants.get(key));
    const host = (() => { try { return new URL(origin).hostname; } catch { return origin; } })();
    const res = await dialog.showMessageBox(win, {
      type: 'none', title: 'Autorisation', icon: path.join(__dirname, 'assets', 'icon.png'),
      message: `${host} souhaite ${PERM_LABELS[permission] || permission}.`,
      buttons: ['Autoriser', 'Bloquer'], defaultId: 0, cancelId: 1, noLink: true,
    });
    const ok = res.response === 0;
    permGrants.set(key, ok);
    persist(); // mémorise la décision entre les sessions (plus de prompt répété)
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (PERM_ALLOW.has(permission)) return true;
    const dkey = permission === 'media' ? 'media' : permission === 'geolocation' ? 'geolocation' : permission === 'notifications' ? 'notifications' : null;
    if (dkey && permDefaults[dkey] === 'block') return false;
    const key = originOf(requestingOrigin) + '|' + permission;
    return permGrants.get(key) === true;
  });
}

// ---------- plein écran HTML (vidéo) ----------
function enterHtmlFullscreen() { if (htmlFullscreen) return; htmlFullscreen = true; hideMenu(); hideTip(); hidePeek(); try { win.setFullScreen(true); } catch {} layout(); }
function leaveHtmlFullscreen() { if (!htmlFullscreen) return; htmlFullscreen = false; try { win.setFullScreen(false); } catch {} layout(); }

// ---------- page d'erreur ----------
const ERROR_FILE = path.join(__dirname, 'ui', 'error.html');
function isErrorPage(u) { try { return decodeURIComponent(u).startsWith('file://') && u.includes('/ui/error.html'); } catch { return false; } }
function loadErrorPage(tab, failedUrl, code, desc) {
  if (!tab.view) return;
  tab.errorURL = failedUrl;
  tab.view.webContents.loadFile(ERROR_FILE, { query: { url: failedUrl, code: String(code), desc: desc || '' } });
}

// ---------- autocomplétion de la barre d'adresse ----------
const stripScheme = (u) => (u || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
function looksLikeUrl(s) { return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(s.trim()) || /^localhost(:\d+)?/i.test(s.trim()); }
// score de « frécence » : fréquence + récence, avec gros bonus si l'entrée commence par la saisie
function prefixBoost(cand, q) {
  const disp = stripScheme(cand.url).toLowerCase(); const title = (cand.title || '').toLowerCase();
  if (disp.startsWith(q)) return 400;
  const host = disp.split('/')[0];
  if (host.startsWith(q)) return 350;
  if (title.startsWith(q)) return 250;
  return 0;
}
function matchQ(c, q) { if (!q) return true; const u = (c.url || '').toLowerCase(); const t = (c.title || '').toLowerCase(); return u.includes(q) || t.includes(q) || stripScheme(c.url).toLowerCase().includes(q); }
function omniSuggest(qraw) {
  const q = (qraw || '').trim().toLowerCase();
  if (!q) return [];
  const out = []; const seen = new Set();
  const push = (it) => { const k = it.kind + '|' + normalize(it.url || ''); if (seen.has(k)) return; seen.add(k); out.push(it); };
  for (const t of tabs) if (matchQ({ url: t.url, title: t.title }, q)) push({ kind: 'tab', id: t.id, title: t.title, url: t.url, favicon: t.favicon, score: 1000 + prefixBoost({ url: t.url, title: t.title }, q) });
  favWalk(favorites, (n) => { if (n.type === 'link' && matchQ({ url: n.url, title: n.title }, q)) push({ kind: 'favorite', title: n.title, url: n.url, favicon: n.favicon, score: 850 + prefixBoost({ url: n.url, title: n.title }, q) }); });
  const now = Date.now();
  for (const h of Object.values(history)) {
    if (!matchQ({ url: h.url, title: h.title }, q)) continue;
    const days = (now - (h.last || 0)) / 86400000;
    const rec = days < 1 ? 120 : days < 7 ? 80 : days < 30 ? 40 : 15;
    push({ kind: 'history', title: h.title, url: h.url, score: Math.min(780, (h.count || 1) * 25 + rec) + prefixBoost({ url: h.url, title: h.title }, q) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 6);
}
const suggestCache = new Map();
function googleSuggest(qraw) {
  const q = (qraw || '').trim();
  const eng = currentEngine();
  if (!q || !eng.suggest) return Promise.resolve([]);
  const ck = eng.id + '|' + q;
  if (suggestCache.has(ck)) return Promise.resolve(suggestCache.get(ck));
  return new Promise((resolve) => {
    let body = '', done = false;
    const finish = (v) => { if (done) return; done = true; if (v.length) { suggestCache.set(ck, v); if (suggestCache.size > 120) suggestCache.delete(suggestCache.keys().next().value); } resolve(v); };
    let req;
    try { req = net.request(eng.suggest.replace('%s', encodeURIComponent(q))); }
    catch { return finish([]); }
    const timer = setTimeout(() => { try { req.abort(); } catch {} finish([]); }, 2500);
    const done2 = (v) => { clearTimeout(timer); finish(v); };
    req.on('response', (res) => { res.on('data', (c) => { body += c; }); res.on('end', () => { try { const j = JSON.parse(body.toString()); done2(Array.isArray(j[1]) ? j[1].slice(0, 8) : []); } catch { done2([]); } }); });
    req.on('error', () => done2([]));
    req.setHeader('User-Agent', session.defaultSession.getUserAgent());
    req.end();
  });
}

// ---------- applis ----------
function ensureAppView(a) {
  let v = appViews.get(a.id);
  if (!v) {
    v = createView((ev, _e, arg) => { if (ev === 'page-favicon-updated' && Array.isArray(arg) && arg[0] && !a.icon) { a.favicon = arg[0]; } sendState(); });
    v.webContents.setWindowOpenHandler(({ url }) => { newTab({ url }); return { action: 'deny' }; });
    v.webContents.on('context-menu', (_e, params) => pageContextMenu(v.webContents, params, null));
    v.webContents.on('found-in-page', (_e, r) => { if (findWin && !findWin.isDestroyed() && findWin.isVisible()) findWin.webContents.send('find-result', { active: r.activeMatchOrdinal, total: r.matches }); });
    v.webContents.on('enter-html-full-screen', () => { if (current && current.kind === 'app' && current.id === a.id) enterHtmlFullscreen(); });
    v.webContents.on('leave-html-full-screen', () => leaveHtmlFullscreen());
    v.webContents.loadURL(a.url);
    appViews.set(a.id, v);
  }
  return v;
}
function activateApp(id) {
  const a = apps.find((x) => x.id === id);
  if (!a) return;
  const v = ensureAppView(a);
  current = { kind: 'app', id };
  attach(v);
  setSplitView(null); splitMode = null; // une appli masque la vue divisée
  v.webContents.focus();
  win.setTitle(a.name);
  hidePeek(); hideFind();
  sendState();
}

// ---------- widget Gmail (flux des non-lus, via la session connectée) ----------
const isGmailApp = (a) => /mail\.google\.com/i.test(a.url);
let gmailCount = 0;
function decodeXml(s) {
  return (s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').trim();
}
function parseGmailAtom(xml) {
  const fc = xml.match(/<fullcount>(\d+)<\/fullcount>/i);
  const messages = [];
  const re = /<entry>([\s\S]*?)<\/entry>/gi; let m;
  while ((m = re.exec(xml)) && messages.length < 20) {
    const e = m[1];
    const g = (r) => (e.match(r) || [])[1];
    const name = g(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/i);
    const email = g(/<author>[\s\S]*?<email>([\s\S]*?)<\/email>/i);
    const link = g(/<link[^>]*href="([^"]+)"/i);
    messages.push({
      subject: decodeXml(g(/<title>([\s\S]*?)<\/title>/i)) || '(sans objet)',
      summary: decodeXml(g(/<summary>([\s\S]*?)<\/summary>/i)),
      from: decodeXml(name) || decodeXml(email) || '?',
      date: g(/<(?:issued|modified|updated)>([\s\S]*?)<\/(?:issued|modified|updated)>/i) || '',
      link: link ? decodeXml(link) : '',
    });
  }
  return { authed: true, count: fc ? +fc[1] : 0, messages };
}
function fetchGmailFeed() {
  return new Promise((resolve) => {
    let done = false, body = '';
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try { req = net.request({ url: 'https://mail.google.com/mail/feed/atom', useSessionCookies: true, session: session.defaultSession }); }
    catch { return finish({ error: true }); }
    req.on('response', (res) => {
      const status = res.statusCode;
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        if (status === 401 || status === 403 || !/<feed/i.test(body)) return finish({ authed: false });
        finish(parseGmailAtom(body));
      });
    });
    req.on('login', () => finish({ authed: false }));
    req.on('error', () => finish({ error: true }));
    try { req.end(); } catch { finish({ error: true }); }
  });
}
function openGmailMessage(link) {
  const a = apps.find(isGmailApp) || apps.find((x) => x.id === 'gmail');
  if (!a) { if (link) navigateCurrent(link); return; }
  const v = ensureAppView(a);
  if (link) v.webContents.loadURL(link);
  current = { kind: 'app', id: a.id };
  attach(v); v.webContents.focus(); win.setTitle(a.name);
  hidePeek(); sendState();
}
async function pollGmail() {
  if (!apps.some(isGmailApp)) return;
  const r = await fetchGmailFeed().catch(() => null);
  if (r && r.authed) { gmailCount = r.count || 0; if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('gmail-count', gmailCount); }
}

// ---------- widget Google Chat (conversations non lues, via une vue cachée sur la session) ----------
// Pas de flux Atom pour Chat : on charge chat.google.com hors écran avec la session de
// l'utilisateur et on lit la liste des conversations dans le DOM (data-group-id + aria).
let chatView = null, chatViewIdle = null, chatCache = null; // cache 60 s : la SPA met ~3 s à peindre
function destroyChatView() { if (chatView) { try { chatView.webContents.close(); } catch {} chatView = null; } }
const CHAT_EXTRACT = `(() => {
  // Les premiers spans d'une conversation sont souvent des libellés de statut (« Unread », heure…) :
  // on prend le nom dans l'attribut title, sinon le premier texte plausible, sinon l'aria-label nettoyé.
  const BAD = /^(non lus?|unread|nouveau\\w*|new|épinglé\\w*|pinned|muted|masqué\\w*|en sourdine|active?|away|absent\\w*|hors ligne|online|offline|statut|status)$/i;
  const TIMEY = /^(\\d{1,2}[:h]\\d{2}|hier|yesterday|aujourd|today|\\d+ (min|h|j|d)\\b)/i;
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const plausible = (v) => v && v.length >= 2 && v.length <= 60 && !BAD.test(v) && !TIMEY.test(v) && !/non lu|unread/i.test(v);
  const nameOf = (el, label) => {
    for (const t of el.querySelectorAll('[title]')) { const v = clean(t.getAttribute('title')); if (plausible(v)) return v; }
    for (const sp of el.querySelectorAll('span')) { const v = clean(sp.textContent); if (plausible(v)) return v; }
    for (const part of (label || '').split(/[,.;·]/)) { const v = clean(part); if (plausible(v)) return v; }
    return '';
  };
  const seen = new Set(); const items = [];
  for (const el of document.querySelectorAll('[data-group-id]')) {
    const id = el.getAttribute('data-group-id') || '';
    if (!id || seen.has(id)) continue; seen.add(id);
    const label = el.getAttribute('aria-label') || '';
    const name = nameOf(el, label);
    if (!name) continue;
    const unread = /non lu|unread/i.test(label) || !!el.querySelector('[aria-label*="non lu" i], [aria-label*="unread" i]');
    items.push({ id, name: name.slice(0, 80), unread });
    if (items.length >= 40) break;
  }
  const available = items.length > 0 || !!document.querySelector('[role="list"], [role="navigation"], [data-group-id]');
  return { authed: true, available, items };
})()`;
function fetchChatFeed(force) {
  return new Promise((resolve) => {
    if (!force && chatCache && Date.now() - chatCache.t < 60000) return resolve(chatCache.data);
    let done = false;
    const finish = (data, cache) => {
      if (done) return; done = true;
      if (cache) chatCache = { t: Date.now(), data };
      clearTimeout(chatViewIdle);
      chatViewIdle = setTimeout(destroyChatView, 5 * 60 * 1000); // la vue cachée ne vit pas éternellement
      resolve(data);
    };
    setTimeout(() => finish({ error: true }, false), 20000); // garde-fou : jamais plus de 20 s
    try {
      if (!chatView || chatView.webContents.isDestroyed()) {
        chatView = new WebContentsView({ webPreferences: { sandbox: true } });
        try { chatView.webContents.setBackgroundThrottling(false); } catch {} // la vue est hors écran : sans ça la SPA se fige
        chatView.webContents.loadURL('https://chat.google.com/');
      } else if (force) {
        chatView.webContents.reload();
      }
    } catch { return finish({ error: true }, false); }
    const wc = chatView.webContents;
    const extract = async () => {
      if (/accounts\.google\./.test(wc.getURL())) return finish({ authed: false }, true);
      await new Promise((r) => setTimeout(r, 3000)); // laisse la SPA peindre sa liste
      if (done) return;
      let data;
      try { data = await wc.executeJavaScript(CHAT_EXTRACT, true); } catch { data = { error: true }; }
      if (data && !data.error && /accounts\.google\./.test(wc.getURL())) data = { authed: false };
      finish(data, !(data && data.error));
    };
    if (wc.isLoading()) wc.once('did-finish-load', extract); else extract();
  });
}
// Ouvre Chat (une conversation précise si on connaît son id « space/… » ou « dm/… »)
function openChat(groupId) {
  let url = 'https://chat.google.com/';
  if (typeof groupId === 'string') {
    if (groupId.startsWith('space/')) url += 'room/' + groupId.slice(6);
    else if (groupId.startsWith('dm/')) url += 'dm/' + groupId.slice(3);
  }
  const a = apps.find((x) => /chat\.google\.com/i.test(x.url));
  if (a) {
    const v = ensureAppView(a);
    v.webContents.loadURL(url);
    current = { kind: 'app', id: a.id };
    attach(v); v.webContents.focus(); win.setTitle(a.name);
  } else {
    newTab({ url });
  }
  hidePeek(); sendState();
}

// ---------- panneau d'aperçu au survol (widget façon Opera) ----------
let peekWin = null, peekAppId = null, peekHideTimer = null;
function ensurePeekWin() {
  if (peekWin && !peekWin.isDestroyed()) return peekWin;
  peekWin = new BrowserWindow({
    width: 424, height: 560, show: false, frame: false, resizable: false, minimizable: false,
    maximizable: false, skipTaskbar: true, parent: win, fullscreenable: false,
    transparent: true, // la page dessine un panneau arrondi + ombre (même langage que les panneaux de l'app)
    webPreferences: { preload: path.join(__dirname, 'peek-preload.js') },
  });
  peekWin.loadFile(path.join(__dirname, 'ui', 'peek.html'));
  peekWin.on('blur', () => hidePeek());
  return peekWin;
}
function showPeek(id, clientY) {
  const a = apps.find((x) => x.id === id);
  if (!a || !win) return;
  if (!isGmailApp(a)) return; // aperçu au survol réservé au widget Gmail
  if (current && current.kind === 'app' && current.id === id) return; // déjà en plein écran
  clearTimeout(peekHideTimer);
  let w;
  try { w = ensurePeekWin(); } catch { return; }
  const b = win.getContentBounds();
  const H = Math.min(560, b.height - 24);
  const y = Math.max(b.y + NAV, Math.min(b.y + (clientY || NAV) - 24, b.y + b.height - H - 12));
  w.setBounds({ x: Math.round(b.x + RAIL - 4), y: Math.round(y), width: 424, height: Math.round(H) }); // -4 : la marge d'ombre interne (12px) place le panneau à ~8px du rail
  peekAppId = id;
  const payload = { url: a.url, name: a.name, icon: a.icon || a.favicon || null, kind: isGmailApp(a) ? 'gmail' : 'web' };
  const send = () => { try { w.webContents.send('peek-load', payload); } catch {} };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send();
  w.showInactive(); // n'attrape pas le focus, l'app reste active
}
function hidePeek() { clearTimeout(peekHideTimer); if (peekWin && !peekWin.isDestroyed() && peekWin.isVisible()) peekWin.hide(); peekAppId = null; }
function hidePeekSoon() { clearTimeout(peekHideTimer); peekHideTimer = setTimeout(hidePeek, 260); }

function removeApp(id) {
  apps = apps.filter((a) => a.id !== id);
  const v = appViews.get(id);
  if (v) { if (contentView === v) attach(null); v.webContents.close(); appViews.delete(id); }
  if (current && current.kind === 'app' && current.id === id) { current = null; if (tabs[0]) activateTab(tabs[0].id); else newTab(); }
  sendState();
}

// ---------- veille / archive automatiques ----------
function housekeeping() {
  const now = Date.now();
  for (const t of [...tabs]) {
    if (isCurrentTab(t.id)) { t.lastActive = now; continue; }
    if (t.view && now - t.lastActive > DORMANT_AFTER) sleepTab(t);
    else if (!t.view && now - t.lastActive > ARCHIVE_AFTER) closeTab(t.id);
  }
  persist();
}

// ---------- menus contextuels personnalisés (au style de NaX) ----------
// Overlay transparent au-dessus de toute la fenêtre pour dessiner les menus par-dessus les vues natives.
let menuWin = null, menuFns = [];
function ensureMenuWin() {
  if (menuWin && !menuWin.isDestroyed()) return menuWin;
  menuWin = new BrowserWindow({
    show: false, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false, parent: win,
    backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'menu-preload.js') },
  });
  menuWin.loadFile(path.join(__dirname, 'ui', 'menu.html'));
  menuWin.on('blur', () => hideMenu());
  return menuWin;
}
function hideMenu() { if (menuWin && !menuWin.isDestroyed() && menuWin.isVisible()) menuWin.hide(); }

// ---------- tooltips personnalisés (overlay transparent, click-through) ----------
let tipWin = null;
function ensureTipWin() {
  if (tipWin && !tipWin.isDestroyed()) return tipWin;
  tipWin = new BrowserWindow({
    show: false, frame: false, transparent: true, focusable: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false, parent: win,
    backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'tip-preload.js') },
  });
  tipWin.setIgnoreMouseEvents(true); // laisse tout passer : ne bloque jamais l'app
  tipWin.loadFile(path.join(__dirname, 'ui', 'tip.html'));
  tipWin.webContents.once('did-finish-load', () => { syncTipBounds(); tipWin.showInactive(); });
  return tipWin;
}
function syncTipBounds() {
  if (tipWin && !tipWin.isDestroyed() && win) { const b = win.getContentBounds(); tipWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }); }
}
function hideTip() { if (tipWin && !tipWin.isDestroyed()) { try { tipWin.webContents.send('tip-hide'); } catch {} } }

// ---------- rechercher dans la page (Ctrl+F) ----------
let findWin = null;
function ensureFindWin() {
  if (findWin && !findWin.isDestroyed()) return findWin;
  findWin = new BrowserWindow({
    width: 380, height: 46, show: false, frame: false, transparent: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: true, focusable: true, parent: win,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1f2b' : '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'find-preload.js') },
  });
  findWin.loadFile(path.join(__dirname, 'ui', 'find.html'));
  return findWin;
}
function findBounds() { const b = win.getContentBounds(); const w = 380, h = 46; return { x: Math.round(b.x + b.width - w - 14), y: Math.round(b.y + NAV + 10), width: w, height: h }; }
function showFind() {
  if (!visibleWC()) return;
  const w = ensureFindWin(); w.setBounds(findBounds());
  const open = () => {
    w.show(); w.focus(); w.webContents.focus();
    try { w.webContents.send('find-open', { dark: nativeTheme.shouldUseDarkColors }); } catch {}
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', open); else open();
}
function hideFind() { const wc = visibleWC(); if (wc && !wc.isDestroyed()) wc.stopFindInPage('clearSelection'); if (findWin && !findWin.isDestroyed() && findWin.isVisible()) findWin.hide(); }

// ---------- overlay des suggestions (barre d'adresse) ----------
let suggestWin = null;
function ensureSuggestWin() {
  if (suggestWin && !suggestWin.isDestroyed()) return suggestWin;
  suggestWin = new BrowserWindow({
    show: false, frame: false, transparent: true, focusable: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false, parent: win,
    backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'suggest-preload.js') },
  });
  suggestWin.loadFile(path.join(__dirname, 'ui', 'suggest.html'));
  return suggestWin;
}
function hideSuggest() { if (suggestWin && !suggestWin.isDestroyed() && suggestWin.isVisible()) suggestWin.hide(); }
// template : liste de { label, click, enabled?, danger? } ou { type:'separator' }.
function popupMenu(template) {
  if (!win) return;
  // Masque les overlays flottants (aperçu Gmail, infobulle, suggestions) AVANT d'ouvrir le menu :
  // sinon, en prenant le focus, le menu fait perdre le focus au peek, ce qui déclenche une cascade
  // d'événements de focus qui rejouait l'animation du menu (bug « animation qui se répète »).
  hidePeek(); hideTip(); hideSuggest();
  const items = template.filter(Boolean);
  menuFns = items.map((i) => i.click || null);
  const view = items.map((i, idx) => i.type === 'separator' ? { sep: true } : { label: i.label, enabled: i.enabled !== false, danger: !!i.danger, idx });
  const cur = screen.getCursorScreenPoint();
  const b = win.getContentBounds();
  const w = ensureMenuWin();
  w.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  const payload = { items: view, x: cur.x - b.x, y: cur.y - b.y, dark: nativeTheme.shouldUseDarkColors };
  const send = () => { try { w.webContents.send('menu-show', payload); } catch {} };
  // on n'affiche PAS tout de suite : le rendu envoie 'menu-ready' quand le contenu est prêt et positionné,
  // ce qui évite de montrer brièvement le menu précédent (double animation).
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send();
}

function tabContextMenu(id) {
  const tab = tabById(id); if (!tab) return;
  const siblings = tabs.filter((t) => t.groupId === tab.groupId);
  const inGroup = siblings.length > 1;
  const grp = groupById(tab.groupId);
  const named = !!(grp && grp.title); // un onglet seul mais dans un groupe nommé : le groupe existe quand même
  const items = [
    { label: favByUrl(tab.url) ? 'Retirer des favoris' : 'Ajouter aux favoris', click: () => toggleFavoriteUrl(tab.url, tab.title, tab.favicon) },
    { label: 'Mettre en veille', enabled: !!tab.view && !isCurrentTab(id), click: () => sleepTab(tab) },
    { label: 'Dupliquer', click: () => newTab({ url: tab.url, openerId: tab.id }) },
    { label: "Copier l'adresse", click: () => clipboard.writeText(tab.url) },
    { type: 'separator' },
    { label: tab.partition ? 'Revenir à la session normale' : 'Passer en navigation privée', click: () => setTabSession(tab.id, !tab.partition) },
  ];
  items.push({ type: 'separator' });
  // nommer un onglet seul = créer un groupe d'un onglet (utile pour garder un nom, replier, etc.)
  items.push({ label: inGroup || named ? 'Renommer le groupe…' : 'Créer un groupe…', click: () => { uiFocus('rename-group', tab.groupId); setTimeout(() => { try { chrome.webContents.focus(); } catch {} }, 80); } }); // focus explicite : le menu est une fenêtre à part, sinon le clavier reste sur la page
  if (inGroup) items.push({ label: 'Sortir du groupe', click: () => { const ng = nextId++; groups.push({ id: ng, title: null }); tab.groupId = ng; sendState(); } });
  else if (named) items.push({ label: 'Dissoudre le groupe', click: () => { grp.title = null; grp.collapsed = false; sendState(); } });
  items.push({ type: 'separator' });
  items.push({ label: 'Fermer', danger: true, click: () => closeTab(id) });
  if (inGroup) items.push({ label: 'Fermer le groupe', danger: true, click: () => siblings.forEach((t) => closeTab(t.id)) });
  popupMenu(items);
}
function appContextMenu(id) {
  popupMenu([
    { label: 'Recharger', click: () => { const v = appViews.get(id); if (v) v.webContents.reload(); } },
    { label: 'Retirer du rail', danger: true, click: () => removeApp(id) },
  ]);
}
function favContextMenu(id) {
  const r = favFind(id); if (!r) return;
  const n = r.node; const items = [];
  if (n.type === 'link') {
    items.push({ label: 'Ouvrir', click: () => navigateCurrent(n.url) });
    items.push({ label: 'Ouvrir dans un nouvel onglet', click: () => newTab({ url: n.url }) });
  } else {
    items.push({ label: 'Ouvrir tous les liens', enabled: !!(n.children && n.children.length), click: () => openAllInFolder(id) });
    items.push({ label: 'Nouveau sous-dossier', click: () => { const nid = createFolder({ parentId: id }); if (n.collapsed) toggleFolder(id); chrome.webContents.send('rename-fav', nid); } });
  }
  items.push({ type: 'separator' });
  items.push({ label: 'Renommer', click: () => chrome.webContents.send('rename-fav', id) });
  if (n.type === 'folder') items.push({ label: 'Personnaliser (icône, couleur)…', click: () => chrome.webContents.send('customize-fav', id) });
  items.push({ label: 'Supprimer', danger: true, click: () => removeFavorite(id) });
  popupMenu(items);
}
// Extrait le contenu lisible de la page (URLs absolues) et l'envoie à l'interface pour conversion Markdown.
async function exportMarkdown(wc) {
  if (!wc || wc.isDestroyed()) return;
  const extractor = `(() => {
    const pick = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role=main]') || document.body;
    const clone = pick.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,iframe,svg,canvas,nav,header,footer,aside,form,button,[aria-hidden=true],.no-print').forEach(el => el.remove());
    clone.querySelectorAll('a[href]').forEach(a => { try { a.setAttribute('href', new URL(a.getAttribute('href'), location.href).href); } catch {} });
    clone.querySelectorAll('img[src]').forEach(im => { try { im.setAttribute('src', new URL(im.getAttribute('src'), location.href).href); } catch {} im.removeAttribute('srcset'); });
    return { title: document.title || location.hostname, url: location.href, html: clone.innerHTML };
  })()`;
  let data;
  try { data = await wc.executeJavaScript(extractor, true); } catch { return; }
  if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('export-md', data);
}

// wc = webContents de la page (onglet OU appli du rail) ; openerId = onglet ouvreur (null pour une appli).
function pageContextMenu(wc, p, openerId = null) {
  if (!wc || wc.isDestroyed()) return;
  const items = [];
  if (p.linkURL) {
    items.push({ label: 'Ouvrir dans un nouvel onglet', click: () => newTab({ url: p.linkURL, openerId, activate: false }) });
    items.push({ label: 'Copier le lien', click: () => clipboard.writeText(p.linkURL) });
    items.push({ type: 'separator' });
  }
  if (p.selectionText) {
    items.push({ label: 'Copier', click: () => wc.copy() });
    items.push({ label: `Rechercher « ${p.selectionText.slice(0, 30)} »`, click: () => newTab({ url: toUrl(p.selectionText), openerId }) });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) {
    items.push({ label: 'Couper', enabled: !!p.selectionText, click: () => wc.cut() });
    items.push({ label: 'Copier', enabled: !!p.selectionText, click: () => wc.copy() });
    items.push({ label: 'Coller', click: () => wc.paste() });
    items.push({ label: 'Tout sélectionner', click: () => wc.selectAll() });
    items.push({ type: 'separator' });
  }
  items.push({ label: 'Précédent', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
  items.push({ label: 'Suivant', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
  items.push({ label: 'Recharger', click: () => wc.reload() });
  items.push({ type: 'separator' });
  items.push({ label: 'Exporter en Markdown', click: () => exportMarkdown(wc) });
  items.push({ label: 'Copier l’adresse de la page', click: () => clipboard.writeText(wc.getURL()) });
  items.push({ label: 'Inspecter', click: () => wc.inspectElement(p.x, p.y) });
  popupMenu(items);
}

// Donne le clavier à l'interface (et non à la page) puis lui envoie un ordre de focus.
function uiFocus(channel, ...args) {
  chrome.webContents.focus();
  chrome.webContents.send(channel, ...args);
}

// ---------- raccourcis ----------
function buildMenu() {
  const withWC = (fn) => () => { const wc = currentWC(); if (wc) fn(wc); };
  const cycle = (dir) => {
    if (!tabs.length) return;
    const i = current && current.kind === 'tab' ? tabs.findIndex((t) => t.id === current.id) : -1;
    activateTab(tabs[(i + dir + tabs.length) % tabs.length].id);
  };
  const tpl = [{
    label: 'NaX',
    submenu: [
      { label: 'Nouvel onglet', accelerator: 'CmdOrCtrl+T', click: () => { newTab(); uiFocus('focus-url'); } },
      { label: 'Nouvel onglet privé', accelerator: 'CmdOrCtrl+Shift+N', click: () => { newTab({ partition: splitPartition('private') }); uiFocus('focus-url'); } },
      { label: "Fermer l'onglet", accelerator: 'CmdOrCtrl+W', click: () => { if (current && current.kind === 'tab') closeTab(current.id); } },
      { label: 'Rouvrir le dernier onglet fermé', accelerator: 'CmdOrCtrl+Shift+T', click: () => { const a = archive.shift(); if (a) newTab({ url: a.url }); } },
      { label: 'Adresse', accelerator: 'CmdOrCtrl+L', click: () => uiFocus('focus-url') },
      { label: 'Rechercher', accelerator: 'CmdOrCtrl+K', click: () => uiFocus('open-palette') },
      { label: 'Ajouter/retirer des favoris', accelerator: 'CmdOrCtrl+D', click: () => { const t = current && current.kind === 'tab' ? tabById(current.id) : null; if (t) toggleFavoriteUrl(t.url, t.title, t.favicon); } },
      { label: 'Afficher/masquer la liste', accelerator: 'CmdOrCtrl+B', click: () => { sidebarOpen = !sidebarOpen; layout(); sendState(); } },
      { label: 'Dernier onglet utilisé', accelerator: 'Ctrl+Tab', click: () => { const id = lastUsedTab(); if (id) activateTab(id); } },
      { label: 'Onglet précédent', accelerator: 'Ctrl+Shift+Tab', click: () => cycle(-1) },
      { label: 'Recharger', accelerator: 'CmdOrCtrl+R', click: withWC((wc) => wc.reload()) },
      { label: 'Recharger (F5)', accelerator: 'F5', visible: false, click: withWC((wc) => wc.reload()) },
      { label: 'Rechercher dans la page', accelerator: 'CmdOrCtrl+F', click: () => showFind() },
      { label: 'Imprimer…', accelerator: 'CmdOrCtrl+P', click: withWC((wc) => wc.print()) },
      { label: 'Quitter le plein écran', accelerator: 'Escape', visible: false, click: () => { if (htmlFullscreen) leaveHtmlFullscreen(); } },
      { label: 'Précédent', accelerator: 'Alt+Left', click: withWC((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()) },
      { label: 'Suivant', accelerator: 'Alt+Right', click: withWC((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()) },
      { label: 'Zoom +', accelerator: 'CmdOrCtrl+=', click: withWC((wc) => zoomStep(wc, 1)) },
      { label: 'Zoom -', accelerator: 'CmdOrCtrl+-', click: withWC((wc) => zoomStep(wc, -1)) },
      { label: 'Zoom par défaut', accelerator: 'CmdOrCtrl+0', click: withWC((wc) => zoomReset(wc)) },
      { label: 'Outils de dev (page)', accelerator: 'F12', click: withWC((wc) => wc.toggleDevTools()) },
      { label: 'Outils de dev (interface)', accelerator: 'CmdOrCtrl+Shift+I', click: () => chrome.webContents.toggleDevTools() },
      { role: 'quit', label: 'Quitter' },
    ],
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------- Claude : moteur de tâches ----------
// Chaque tâche lance « claude -p » (CLI Claude Code, authentifié par l'abonnement de l'utilisateur)
// en mode headless avec sortie stream-json : on relaie l'activité (recherches, lectures) et le
// résultat final au panneau, en continu.
const { spawn } = require('child_process');

function claudePublicTasks() {
  // volontairement sans le prompt complet répété partout : la liste reste légère à sérialiser
  return claudeTasks;
}
function sendClaudeTasks() {
  if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('claude-tasks', claudePublicTasks());
  persistClaudeTasks();
}
function claudeWorkDir() {
  const dir = path.join(app.getPath('userData'), 'claude-tasks');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
function claudeActivity(task, label) {
  task.activity.push({ t: Date.now(), label });
  if (task.activity.length > 120) task.activity.splice(0, task.activity.length - 120);
}
// Une ligne JSON du flux « stream-json » du CLI → mise à jour de la tâche.
function handleClaudeEvent(task, line) {
  let ev; try { ev = JSON.parse(line); } catch { return; }
  if (ev.type === 'system' && ev.subtype === 'init') {
    task.sessionId = ev.session_id || null;
    claudeActivity(task, 'Claude démarre…');
  } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    for (const b of ev.message.content) {
      if (b.type === 'text' && b.text) {
        task.output += (task.output ? '\n\n' : '') + b.text;
      } else if (b.type === 'tool_use') {
        const i = b.input || {};
        const label = b.name === 'WebSearch' ? 'Recherche web — ' + (i.query || '')
          : b.name === 'WebFetch' ? 'Lecture — ' + (i.url || 'une page')
          : b.name + (i.query || i.url ? ' — ' + (i.query || i.url) : '');
        claudeActivity(task, label);
      }
    }
  } else if (ev.type === 'result') {
    task.status = ev.is_error ? 'error' : 'done';
    if (typeof ev.result === 'string' && ev.result) task.output = ev.result; // le résultat final remplace le flux (évite les doublons)
    if (ev.is_error) task.error = (typeof ev.result === 'string' && ev.result) || ev.subtype || 'Erreur';
    task.durationMs = ev.duration_ms || null;
    task.numTurns = ev.num_turns || null;
    task.finishedAt = Date.now();
    if (task.status === 'done') {
      // finalité de la tâche : ouvrir UNIQUEMENT les pages-résultat listées par Claude (bloc nax-tabs).
      // Pas de repli automatique sur les liens du rapport : ils incluent les sources, que l'utilisateur ne veut pas voir s'ouvrir.
      task.tabs = claudeParseTabs(task);
      claudeActivity(task, task.tabs.length ? 'Îlot ouvert — ' + task.tabs.length + ' onglet' + (task.tabs.length > 1 ? 's' : '') : 'Aucune page à ouvrir');
      openClaudeIslandTabs(task, true);
    }
  }
  sendClaudeTasks();
}
// Lance le CLI pour une tâche (démarrage ou reprise) et branche le flux stream-json dessus.
function runClaudeProcess(task, prompt, resumeSession) {
  const args = [
    ...(resumeSession ? ['--resume', resumeSession] : []),
    '-p', prompt + CLAUDE_TABS_SUFFIX, // la consigne « conclure par des onglets » ne fait pas partie du titre
    '--output-format', 'stream-json', '--verbose',
    // travail de recherche uniquement : pas d'écriture disque ni de shell
    '--allowedTools', 'WebSearch,WebFetch',
  ];
  let proc = null;
  try {
    proc = spawn('claude', args, { cwd: claudeWorkDir(), env: process.env, windowsHide: true, shell: false });
  } catch (e) {
    task.status = 'error'; task.error = 'Lancement impossible : ' + e.message; task.finishedAt = Date.now();
    sendClaudeTasks(); return;
  }
  claudeProcs.set(task.id, proc);
  let buf = '', errBuf = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) handleClaudeEvent(task, line);
    }
  });
  proc.stderr.on('data', (d) => { errBuf = (errBuf + d.toString('utf8')).slice(-4000); });
  proc.on('error', (e) => {
    claudeProcs.delete(task.id);
    if (task.status !== 'running') return;
    task.status = 'error';
    task.error = e.code === 'ENOENT'
      ? 'CLI « claude » introuvable. Installe Claude Code (claude.com/claude-code) et connecte ton abonnement.'
      : e.message;
    task.finishedAt = Date.now();
    sendClaudeTasks();
  });
  proc.on('close', (code) => {
    claudeProcs.delete(task.id);
    if (task.status === 'running') { // sorti sans événement « result »
      task.status = code === 0 ? 'done' : 'error';
      if (code !== 0 && !task.error) task.error = (errBuf || 'claude a quitté avec le code ' + code).trim();
      task.finishedAt = Date.now();
    }
    sendClaudeTasks();
  });
}
function startClaudeTask(prompt) {
  const p = (prompt || '').trim();
  if (!p) return null;
  const task = {
    id: claudeNextId++, prompt: p,
    title: p.split('\n')[0].slice(0, 90),
    status: 'running', createdAt: Date.now(), finishedAt: null,
    output: '', error: null, activity: [], durationMs: null, numTurns: null, sessionId: null,
    history: [], curPrompt: null,
  };
  claudeTasks.unshift(task);
  runClaudeProcess(task, p, null);
  sendClaudeTasks();
  return task.id;
}
// Reprend une tâche terminée avec son contexte (--resume) pour demander une suite.
function continueClaudeTask(id, prompt) {
  const t = claudeTasks.find((x) => x.id === id);
  const p = (prompt || '').trim();
  if (!t || !p || t.status === 'running' || !t.sessionId) return;
  // l'échange précédent passe dans l'historique, la carte repart sur la suite
  t.history = t.history || [];
  t.history.push({ prompt: t.curPrompt || null, output: t.output, error: t.error });
  t.curPrompt = p; t.output = ''; t.error = null; t.tabs = null;
  t.status = 'running'; t.createdAt = Date.now(); t.finishedAt = null;
  t.activity = [];
  runClaudeProcess(t, p, t.sessionId);
  sendClaudeTasks();
}
function cancelClaudeTask(id) {
  const t = claudeTasks.find((x) => x.id === id);
  const proc = claudeProcs.get(id);
  if (proc) { try { proc.kill(); } catch {} claudeProcs.delete(id); }
  if (t && t.status === 'running') {
    t.status = 'canceled'; t.finishedAt = Date.now();
    claudeActivity(t, 'Annulée');
  }
  sendClaudeTasks();
}

// ---------- Claude : îlots ----------
// Un îlot « ouvert par Claude » est un groupe d'onglets ordinaire, marqué claude:true et
// relié à sa tâche par claudeTaskId. bornAt sert à l'animation d'apparition côté UI.
function claudeIslandOf(taskId) {
  const g = groups.find((x) => x.claudeTaskId === taskId);
  return g && tabs.some((t) => t.groupId === g.id) ? g : null;
}
function claudeIsland(task) {
  let g = claudeIslandOf(task.id);
  if (!g) {
    groups = groups.filter((x) => x.claudeTaskId !== task.id); // retire un éventuel îlot vidé
    g = { id: nextId++, title: task.title.slice(0, 48), claude: true, claudeTaskId: task.id, bornAt: Date.now() };
    groups.push(g);
  }
  return g;
}
// La finalité d'une tâche est d'ouvrir des onglets : on impose à Claude de conclure par un
// bloc ```nax-tabs``` listant les pages à ouvrir. Le bloc est retiré du rapport affiché.
const CLAUDE_TABS_SUFFIX = '\n\nINSTRUCTION NAVIGATEUR (obligatoire) : la finalité de cette tâche est d\'ouvrir dans le navigateur les pages qui SONT le résultat demandé — uniquement elles. '
  + 'N\'inclus JAMAIS tes sources de recherche, comparatifs, articles de presse ou pages intermédiaires consultées en chemin : seulement les pages finales que l\'utilisateur veut consulter. '
  + 'Si la demande précise un nombre (« 3 freelances », « les 5 meilleurs… »), ouvre exactement ce nombre de pages ; sinon reste minimal (1 à 4). '
  + 'Les URL viennent de tes recherches, jamais inventées. Termine ta réponse par un bloc de code ```nax-tabs``` contenant UNIQUEMENT ce tableau JSON :\n'
  + '```nax-tabs\n[{"url":"https://exemple.com/page","title":"Titre court"}]\n```';
function claudeParseTabs(task) {
  const m = /```nax-tabs\s*([\s\S]*?)```/.exec(task.output || '');
  if (!m) return [];
  let arr;
  try { arr = JSON.parse(m[1]); } catch { return []; }
  task.output = (task.output.replace(m[0], '').trim()); // le bloc technique ne pollue pas le rapport
  return (Array.isArray(arr) ? arr : [])
    .map((x) => ({ url: String((x && x.url) || ''), title: String((x && x.title) || '').slice(0, 120) }))
    .filter((x) => { try { return /^https?:$/.test(new URL(x.url).protocol); } catch { return false; } })
    .slice(0, 10);
}
// Ouvre (ou complète) l'îlot de la tâche avec ses onglets ; active le premier onglet ouvert.
function openClaudeIslandTabs(task, activate) {
  const list = task.tabs || [];
  if (!list.length) return;
  const g = claudeIsland(task);
  const already = new Set(tabs.filter((x) => x.groupId === g.id).map((x) => normalize(x.url)));
  let first = null;
  for (const it of list) {
    if (already.has(normalize(it.url))) continue;
    already.add(normalize(it.url));
    const tb = newTab({ url: it.url, groupId: g.id, activate: false });
    if (it.title) tb.title = it.title; // en attendant le vrai titre de la page
    if (!first) first = tb;
  }
  if (first && activate) activateTab(first.id); else sendState();
}
// Sources d'une tâche : liens http(s) du markdown final, dans l'ordre, dédupliqués.
function claudeTaskSources(task, max = 8) {
  const seen = new Set(); const out = [];
  const re = /\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^\s>]+)>|(?:^|[\s"'`[])(https?:\/\/[^\s)\]"'`<>]+)/g;
  let m;
  while ((m = re.exec(task.output || '')) && out.length < max) {
    const raw = (m[1] || m[2] || m[3] || '').replace(/[.,;:!?]+$/, '');
    try { const u = new URL(raw); if (!/^https?:$/.test(u.protocol) || seen.has(u.href)) continue; seen.add(u.href); out.push(u.href); } catch {}
  }
  return out;
}

// ---------- IPC ----------
function registerIpc() {
  const withWC = (fn) => () => { const wc = currentWC(); if (wc) fn(wc); };
  ipcMain.on('navigate', (_e, input) => navigateCurrent(input));
  ipcMain.on('back', withWC((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()));
  ipcMain.on('forward', withWC((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()));
  ipcMain.on('reload', withWC((wc) => (wc.isLoading() ? wc.stop() : wc.reload())));
  ipcMain.on('home', () => navigateCurrent(homepage));
  ipcMain.on('focus-page', withWC((wc) => wc.focus()));

  ipcMain.on('tab-new', () => { newTab(); uiFocus('focus-url'); });
  ipcMain.on('tab-new-private', () => { newTab({ partition: splitPartition('private') }); uiFocus('focus-url'); });
  ipcMain.on('tab-set-session', (_e, { id, private: priv } = {}) => setTabSession(id, !!priv));
  ipcMain.on('newtab-menu', () => popupMenu([
    { label: 'Session par défaut', click: () => { newTab(); uiFocus('focus-url'); } },
    { label: 'Navigation privée', click: () => { newTab({ partition: splitPartition('private') }); uiFocus('focus-url'); } },
    { label: 'Autre session (conservée)', click: () => { newTab({ partition: 'persist:nax-profile-b' }); uiFocus('focus-url'); } },
  ]));
  ipcMain.on('tab-activate', (_e, id) => activateTab(id));
  ipcMain.on('tab-close', (_e, id) => closeTab(id));
  ipcMain.on('tab-context', (_e, id) => tabContextMenu(id));
  ipcMain.on('group-rename', (_e, { id, title }) => { const g = groupById(id); if (g) { g.title = (title || '').trim() || null; sendState(); } });
  ipcMain.on('group-toggle', (_e, id) => { const g = groupById(id); if (g) { g.collapsed = !g.collapsed; sendState(); } });
  ipcMain.on('group-close', (_e, id) => tabs.filter((t) => t.groupId === id).forEach((t) => closeTab(t.id)));
  ipcMain.on('tab-move', (_e, opts) => moveTab(opts || {}));
  ipcMain.on('group-move', (_e, opts) => moveGroup(opts || {}));
  // ferme les deux onglets d'une paire divisée d'un coup
  ipcMain.on('tab-close-pair', (_e, id) => { const t = tabById(id); const p = t ? pairOf(t) : null; if (p) { closeTab(p.secondary.id); closeTab(p.primary.id); } else closeTab(id); });
  // déplace une paire divisée (primaire + secondaire restent adjacents et liés)
  ipcMain.on('tab-move-pair', (_e, o = {}) => {
    moveTab({ tabId: o.primaryId, afterTabId: o.afterTabId, targetGroupId: o.targetGroupId, makeNewGroup: o.makeNewGroup });
    const prim = tabById(o.primaryId);
    if (prim) moveTab({ tabId: o.secondaryId, afterTabId: o.primaryId, targetGroupId: prim.groupId });
  });
  ipcMain.on('set-theme', (_e, t) => { if (['system', 'light', 'dark'].includes(t)) { theme = t; applyTheme(); sendState(); } });
  ipcMain.on('app-peek', (_e, { id, clientY } = {}) => showPeek(id, clientY));
  ipcMain.on('app-peek-hide-soon', () => hidePeekSoon());
  ipcMain.on('peek-hover', (_e, inside) => { if (inside) clearTimeout(peekHideTimer); else hidePeekSoon(); });
  ipcMain.on('peek-open-full', () => { const id = peekAppId; hidePeek(); if (id) activateApp(id); });
  ipcMain.handle('gmail-feed', () => fetchGmailFeed());
  ipcMain.on('gmail-open', (_e, link) => openGmailMessage(link));
  ipcMain.handle('chat-feed', (_e, force) => fetchChatFeed(!!force));
  ipcMain.on('chat-open', (_e, groupId) => openChat(groupId));
  ipcMain.on('menu-ready', () => { if (menuWin && !menuWin.isDestroyed()) { menuWin.show(); menuWin.focus(); menuWin.webContents.send('menu-play'); } });
  ipcMain.on('tip-show', (_e, d) => { const w = ensureTipWin(); syncTipBounds(); const send = () => { try { w.webContents.send('tip-show', { ...d, dark: nativeTheme.shouldUseDarkColors }); } catch {} }; if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send(); });
  ipcMain.on('tip-hide', () => hideTip());
  ipcMain.handle('omni-suggest', (_e, q) => ({ local: omniSuggest(q), isUrl: looksLikeUrl(q || '') }));
  ipcMain.handle('omni-google', (_e, q) => googleSuggest(q));
  ipcMain.on('suggest-show', (_e, { items, sel, rect, dark, q } = {}) => {
    const w = ensureSuggestWin();
    const b = win.getContentBounds();
    const h = Math.min(420, 8 + (items ? items.length : 0) * 46 + 6);
    w.setBounds({ x: Math.round(b.x + rect.x), y: Math.round(b.y + rect.y), width: Math.round(rect.w), height: Math.max(1, Math.round(h)) });
    const send = () => { try { w.webContents.send('suggest-render', { items, sel, dark, q }); } catch {} };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send();
    if (!w.isVisible()) w.showInactive();
  });
  ipcMain.on('suggest-hide', () => hideSuggest());
  ipcMain.on('suggest-hover', (_e, idx) => { if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('suggest-hover', idx); });
  ipcMain.on('suggest-choose', (_e, idx) => { if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('suggest-choose', idx); });
  ipcMain.on('md-copy', (_e, text) => clipboard.writeText(text || ''));
  ipcMain.handle('md-download', async (_e, { filename, content } = {}) => {
    const safe = (filename || 'page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'page';
    const res = await dialog.showSaveDialog(win, { title: 'Enregistrer en Markdown', defaultPath: path.join(app.getPath('downloads'), safe + '.md'), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (res.canceled || !res.filePath) return { canceled: true };
    try { fs.writeFileSync(res.filePath, content || '', 'utf8'); return { ok: true, path: res.filePath }; } catch (e) { return { error: e.message }; }
  });
  ipcMain.on('find-open-req', () => showFind());
  ipcMain.on('find-query', (_e, { text, forward = true, findNext = false } = {}) => {
    const wc = visibleWC(); if (!wc || wc.isDestroyed()) return;
    if (!text) { wc.stopFindInPage('clearSelection'); return; }
    // NB : passer findNext:false explicitement empêche found-in-page de se déclencher au 1er appel.
    // Nouvelle recherche → on omet findNext ; navigation suivant/précédent → findNext:true.
    if (findNext) wc.findInPage(text, { forward, findNext: true });
    else wc.findInPage(text, { forward });
  });
  ipcMain.on('find-close', () => { hideFind(); const wc = visibleWC(); if (wc) wc.focus(); });
  ipcMain.handle('dl-list', () => downloads.map((d) => ({ ...d })));
  ipcMain.on('dl-open', (_e, id) => { const d = downloads.find((x) => x.id === id); if (d && d.state === 'completed') shell.openPath(d.savePath).catch(() => {}); });
  ipcMain.on('dl-folder', (_e, id) => { const d = downloads.find((x) => x.id === id); if (d) shell.showItemInFolder(d.savePath); });
  ipcMain.on('dl-cancel', (_e, id) => { const it = dlItems.get(id); if (it) it.cancel(); });
  ipcMain.on('dl-remove', (_e, id) => { const it = dlItems.get(id); if (it) it.cancel(); downloads = downloads.filter((x) => x.id !== id); dlItems.delete(id); sendDownloads(); });
  ipcMain.on('dl-clear', () => { downloads = downloads.filter((d) => d.state === 'progressing' || d.state === 'paused'); sendDownloads(); });
  ipcMain.on('menu-select', (_e, idx) => { hideMenu(); const fn = menuFns[idx]; menuFns = []; if (typeof fn === 'function') fn(); });
  ipcMain.on('menu-close', () => hideMenu());
  ipcMain.on('set-dev-mode', (_e, on) => setDevMode(on));
  ipcMain.handle('browsing-data-stats', () => browsingDataStats());
  ipcMain.handle('clear-browsing-data', (_e, opts) => clearBrowsingData(opts || {}));
  // Détail par catégorie (voir / supprimer élément par élément)
  ipcMain.handle('history-list', () => historyList());
  ipcMain.handle('history-remove', (_e, key) => { delete history[key]; persist(); return historyList(); });
  ipcMain.handle('perms-list', () => permsList());
  ipcMain.handle('perms-remove', (_e, key) => { permGrants.delete(key); persist(); sendState(); return permsList(); });
  ipcMain.handle('cookies-list', () => cookiesList());
  ipcMain.handle('cookies-remove', (_e, domain) => cookiesRemoveDomain(domain));
  ipcMain.handle('cache-size', () => session.defaultSession.getCacheSize().catch(() => 0));
  ipcMain.handle('cache-clear', async () => { try { await session.defaultSession.clearCache(); await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'shadercache'] }); } catch {} return session.defaultSession.getCacheSize().catch(() => 0); });
  // Réglages généraux (démarrage, accueil, téléchargements, zoom, langues, autorisations par défaut)
  ipcMain.handle('settings-get', () => ({
    homepage, newTabUrl, startupMode,
    downloadDir, downloadDirDefault: app.getPath('downloads'), askDownloadPath,
    defaultZoom, spellcheckOn, spellLangs: [...spellLangs],
    availLangs: (() => { try { return session.defaultSession.availableSpellCheckerLanguages || []; } catch { return []; } })(),
    perm: { ...permDefaults },
    version: app.getVersion(),
  }));
  ipcMain.handle('settings-set', (_e, p = {}) => {
    let langsChanged = false, zoomChanged = false;
    if (typeof p.homepage === 'string' && p.homepage.trim()) homepage = toUrl(p.homepage) || homepage;
    if (typeof p.newTabUrl === 'string') { const v = p.newTabUrl.trim(); newTabUrl = (v === '' || v === 'blank') ? v : (toUrl(v) || ''); }
    if (p.startupMode === 'restore' || p.startupMode === 'home') startupMode = p.startupMode;
    if (typeof p.downloadDir === 'string') downloadDir = p.downloadDir;
    if (typeof p.askDownloadPath === 'boolean') askDownloadPath = p.askDownloadPath;
    if (typeof p.defaultZoom === 'number' && p.defaultZoom > 0) { defaultZoom = p.defaultZoom; zoomChanged = true; }
    if (typeof p.spellcheckOn === 'boolean') { spellcheckOn = p.spellcheckOn; langsChanged = true; }
    if (Array.isArray(p.spellLangs)) { spellLangs = p.spellLangs.length ? p.spellLangs : ['fr']; langsChanged = true; }
    if (p.perm && typeof p.perm === 'object') permDefaults = { ...permDefaults, ...p.perm };
    if (langsChanged) applyLanguages();
    if (zoomChanged) applyZoomToAll();
    persist();
    return true;
  });
  ipcMain.handle('pick-download-dir', async () => {
    const res = await dialog.showOpenDialog(win, { title: 'Choisir le dossier de téléchargement', defaultPath: defaultDownloadDir(), properties: ['openDirectory', 'createDirectory'] });
    if (!res.canceled && res.filePaths[0]) { downloadDir = res.filePaths[0]; persist(); }
    return { dir: downloadDir, default: app.getPath('downloads') };
  });
  ipcMain.handle('zoom-list', () => Object.entries(zoomHosts).map(([host, factor]) => ({ host, factor })).sort((a, b) => a.host.localeCompare(b.host)));
  ipcMain.handle('zoom-reset', (_e, host) => { delete zoomHosts[host]; for (const wc of allWebContents()) { try { if (hostOf(wc.getURL()) === host) applyZoom(wc); } catch {} } persist(); return true; });
  ipcMain.handle('zoom-reset-all', () => { zoomHosts = {}; applyZoomToAll(); persist(); return true; });
  ipcMain.on('set-search-engine', (_e, id) => { if (SEARCH_ENGINES.some((e) => e.id === id)) { searchEngine = id; sendState(); } });
  ipcMain.on('dev-open', (_e, url) => { const dup = tabs.find((t) => sameTarget(url, t.url)); if (dup) activateTab(dup.id); else newTab({ url }); });
  ipcMain.on('fav-toggle', () => { const t = current && current.kind === 'tab' ? tabById(current.id) : null; if (t) toggleFavoriteUrl(t.url, t.title, t.favicon); });
  ipcMain.on('fav-add', (_e, o = {}) => addFavorite(o));
  ipcMain.on('fav-folder', (_e, o = {}) => { const id = createFolder(o); setImmediate(() => { if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('rename-fav', id); }); });
  ipcMain.on('fav-remove', (_e, id) => removeFavorite(id));
  ipcMain.on('fav-rename', (_e, { id, title }) => renameFavorite(id, title));
  ipcMain.on('fav-customize', (_e, { id, icon, color } = {}) => { const r = favFind(id); if (r && r.node.type === 'folder') { if (icon === null) delete r.node.icon; else if (icon !== undefined) r.node.icon = icon; if (color === null) delete r.node.color; else if (color !== undefined) r.node.color = color; sendState(); } });
  ipcMain.on('fav-toggle-folder', (_e, id) => toggleFolder(id));
  ipcMain.on('fav-open', (_e, id) => { const r = favFind(id); if (r && r.node.type === 'link') navigateCurrent(r.node.url); });
  ipcMain.on('fav-open-new', (_e, id) => { const r = favFind(id); if (r && r.node.type === 'link') newTab({ url: r.node.url }); });
  ipcMain.on('fav-open-all', (_e, id) => openAllInFolder(id));
  ipcMain.on('fav-move', (_e, o) => moveFavorite(o || {}));
  ipcMain.on('fav-context', (_e, id) => favContextMenu(id));

  ipcMain.on('app-activate', (_e, id) => activateApp(id));
  ipcMain.on('app-context', (_e, id) => appContextMenu(id));
  ipcMain.on('app-add', (_e, input) => {
    const url = toUrl(input); if (!url) return;
    const host = hostOf(url);
    const name = host.split('.')[0].replace(/^\w/, (c) => c.toUpperCase());
    apps.push({ id: 'app' + nextId++, name, url });
    sendState();
  });
  ipcMain.on('app-remove', (_e, id) => removeApp(id));
  // réordonne le rail : place id avant beforeId (ou en fin si beforeId absent)
  ipcMain.on('app-move', (_e, o) => {
    const i = apps.findIndex((a) => a.id === (o && o.id)); if (i < 0) return;
    const [a] = apps.splice(i, 1);
    const j = o.beforeId ? apps.findIndex((x) => x.id === o.beforeId) : -1;
    if (j < 0) apps.push(a); else apps.splice(j, 0, a);
    sendState();
  });
  // ajout depuis le catalogue de suggestions (nom connu, URL vérifiée, pas de doublon par hôte)
  ipcMain.on('app-add-preset', (_e, o) => {
    if (!o || typeof o.url !== 'string') return;
    let u; try { u = new URL(o.url); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    if (apps.some((a) => hostOf(a.url) === u.host)) return;
    const entry = { id: 'app' + nextId++, name: String(o.name || u.host).slice(0, 24), url: u.href };
    if (typeof o.icon === 'string' && /^https:\/\//.test(o.icon)) entry.icon = o.icon; // icône explicite (ex. Jira : l'hôte de l'appli n'a pas de favicon)
    apps.push(entry);
    sendState();
  });

  ipcMain.on('sidebar-toggle', () => { sidebarOpen = !sidebarOpen; layout(); sendState(); });
  // Redimensionnement de la liste : pendant le glisser on masque la page (vue native) pour garder la souris dans l'interface.
  ipcMain.on('sidebar-resize-start', () => { if (contentView) contentView.setVisible(false); });
  ipcMain.on('sidebar-resize', (_e, w) => { sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w))); layout(); });
  ipcMain.on('sidebar-resize-end', () => { if (contentView) contentView.setVisible(!overlayOpen); layout(); sendState(); });
  ipcMain.on('overlay', (_e, open) => {
    overlayOpen = !!open;
    if (contentView) contentView.setVisible(!overlayOpen);
    if (splitView) splitView.setVisible(!overlayOpen);
    if (overlayOpen) chrome.webContents.focus();
    else { const wc = currentWC(); if (wc) wc.focus(); }
    sendState();
  });
  // ---------- vue divisée ----------
  ipcMain.on('split-open', (_e, mode) => openSplit(mode));
  ipcMain.on('split-close', () => closeSplit());
  // menu de choix de session (via l'overlay natif, au-dessus des pages web)
  ipcMain.on('split-menu', () => popupMenu([
    { label: 'Cookies partagés', click: () => openSplit('shared') },
    { label: 'Navigation privée', click: () => openSplit('private') },
  ]));
  const withSplit = (fn) => () => { if (splitView && !splitView.webContents.isDestroyed()) fn(splitView.webContents); };
  ipcMain.on('split-back', withSplit((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()));
  ipcMain.on('split-forward', withSplit((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()));
  ipcMain.on('split-reload', withSplit((wc) => (wc.isLoading() ? wc.stop() : wc.reload())));
  ipcMain.on('split-navigate', (_e, input) => { const u = toUrl(input); if (u && splitView && !splitView.webContents.isDestroyed()) splitView.webContents.loadURL(u); });
  ipcMain.on('split-resize-start', () => { if (contentView) contentView.setVisible(false); if (splitView) splitView.setVisible(false); });
  ipcMain.on('split-resize', (_e, r) => { splitRatio = Math.min(0.8, Math.max(0.2, +r || 0.5)); layout(); });
  ipcMain.on('split-resize-end', () => { const vis = !overlayOpen; if (contentView) contentView.setVisible(vis); if (splitView) splitView.setVisible(vis); layout(); sendState(); });

  ipcMain.handle('search', (_e, q) => {
    const s = (q || '').trim().toLowerCase();
    const match = (t) => !s || (t.title || '').toLowerCase().includes(s) || (t.url || '').toLowerCase().includes(s);
    const open = tabs.filter(match).map((t) => ({ kind: t.view ? 'open' : 'dormant', id: t.id, title: t.title, url: t.url, favicon: t.favicon, group: groupTitle(groupById(t.groupId)) }));
    const arch = archive.map((a, index) => ({ ...a, index })).filter(match).slice(0, 20).map((a) => ({ kind: 'archive', index: a.index, title: a.title, url: a.url, favicon: a.favicon, closedAt: a.closedAt, group: a.groupTitle }));
    const favItem = (n) => n.type === 'folder'
      ? { kind: 'favorite', type: 'folder', id: n.id, title: n.title, count: (n.children || []).length, icon: n.icon || null, color: n.color || null }
      : { kind: 'favorite', type: 'link', id: n.id, title: n.title, url: n.url, favicon: n.favicon };
    // sans recherche : favoris de premier niveau (navigables) ; avec recherche : tout l'arbre.
    let favs = [];
    if (!s) favs = favorites.map(favItem);
    else favWalk(favorites, (n) => { if (n.type === 'folder' ? (n.title || '').toLowerCase().includes(s) : match(n)) favs.push(favItem(n)); });
    favs = favs.slice(0, 40);
    const openSet = new Set(tabs.map((t) => normalize(t.url)));
    const hist = Object.values(history).filter((h) => match(h) && !openSet.has(normalize(h.url))).sort((a, b) => b.count - a.count).slice(0, 10).map((h) => ({ kind: 'history', title: h.title, url: h.url, count: h.count }));
    return { open, favorites: favs, archive: arch, history: hist };
  });
  ipcMain.handle('archive-list', () => archive.slice(0, 300));
  ipcMain.on('archive-restore', (_e, index) => { const a = archive[index]; if (!a) return; archive.splice(index, 1); newTab({ url: a.url }); });
  ipcMain.on('archive-remove', (_e, index) => { archive.splice(index, 1); sendState(); });
  ipcMain.on('open-url', (_e, url) => navigateCurrent(url));
  ipcMain.on('open-url-new', (_e, url) => { const u = toUrl(url); if (u) newTab({ url: u }); });

  ipcMain.handle('pw-available', () => safeStorage.isEncryptionAvailable());
  ipcMain.handle('pw-import', () => importPasswordsCsv());
  ipcMain.handle('pw-list', () => passwords.map(({ password, ...p }) => ({ ...p, len: (password || '').length })));
  ipcMain.handle('pw-reveal', (_e, id) => { const p = passwords.find((x) => x.id === id); return p ? p.password : null; });
  ipcMain.on('pw-copy', (_e, id) => { const p = passwords.find((x) => x.id === id); if (!p) return; clipboard.writeText(p.password); setTimeout(async () => { try { if ((await clipboard.readText()) === p.password) clipboard.clear(); } catch {} }, 30000); });
  ipcMain.on('pw-open', (_e, id) => { const p = passwords.find((x) => x.id === id); if (p && p.url) navigateCurrent(p.url); });
  ipcMain.on('pw-delete', (_e, id) => { passwords = passwords.filter((p) => p.id !== id); persistPasswords(); });
  ipcMain.on('pw-clear', () => { passwords = []; persistPasswords(); });

  // ---------- Claude (tâches IA) ----------
  ipcMain.on('claude-toggle', () => { claudeOpen = !claudeOpen; layout(); sendState(); persistClaudeTasks(); if (claudeOpen) sendClaudeTasks(); });
  ipcMain.handle('claude-tasks', () => claudePublicTasks());
  ipcMain.handle('claude-run', (_e, prompt) => startClaudeTask(prompt));
  ipcMain.on('claude-cancel', (_e, id) => cancelClaudeTask(id));
  ipcMain.on('claude-continue', (_e, o) => continueClaudeTask(o && o.id, o && o.prompt));
  ipcMain.on('claude-remove', (_e, id) => {
    const t = claudeTasks.find((x) => x.id === id);
    if (t && t.status === 'running') cancelClaudeTask(id);
    claudeTasks = claudeTasks.filter((x) => x.id !== id);
    const g = groups.find((x) => x.claudeTaskId === id);
    if (g) g.claudeTaskId = null; // l'îlot survit à sa tâche, mais n'y renvoie plus
    sendClaudeTasks(); sendState();
  });
  ipcMain.on('claude-clear-done', () => { claudeTasks = claudeTasks.filter((t) => t.status === 'running'); sendClaudeTasks(); sendState(); });
  ipcMain.on('claude-open-md', (_e, id) => { // ouvre le résultat dans la visionneuse Markdown existante (plein écran)
    const t = claudeTasks.find((x) => x.id === id);
    if (t && t.output && chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('export-md', { title: t.title, md: t.output });
  });
  // un lien cliqué dans le résultat s'ouvre dans l'îlot de la tâche (créé au premier lien)
  ipcMain.on('claude-open-link', (_e, o) => {
    const t = claudeTasks.find((x) => x.id === (o && o.id)); if (!t) return;
    let u; try { u = new URL(o.url); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    newTab({ url: u.href, groupId: claudeIsland(t).id });
  });
  // (ré)ouvre l'îlot de la tâche avec ses onglets (bloc nax-tabs, sinon liens du rapport)
  ipcMain.on('claude-open-island', (_e, id) => {
    const t = claudeTasks.find((x) => x.id === id); if (!t) return;
    if (!t.tabs || !t.tabs.length) t.tabs = claudeTaskSources(t).map((url) => ({ url, title: '' }));
    openClaudeIslandTabs(t, true);
    sendClaudeTasks();
  });
  // retrouve l'îlot d'une tâche (active son onglet le plus récent)
  ipcMain.on('claude-focus-island', (_e, id) => {
    const g = claudeIslandOf(id); if (!g) return;
    const members = tabs.filter((t) => t.groupId === g.id);
    const mru = members.slice().sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
    if (mru) activateTab(mru.id);
  });
  // depuis l'îlot (badge ✦) → ouvre le panneau sur la tâche correspondante
  ipcMain.on('claude-reveal-task', (_e, taskId) => {
    if (!claudeOpen) { claudeOpen = true; layout(); }
    sendState(); sendClaudeTasks();
    if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send('claude-reveal', taskId);
  });
}

// ---------- démarrage ----------
// Google refuse la connexion si le user-agent contient « Electron » ou le nom de l'app
// (« This browser may not be secure »). On le nettoie pour qu'il ressemble à Chrome.
function cleanUserAgent() {
  const ua = session.defaultSession.getUserAgent();
  const clean = ua.replace(/ (?:browser|Electron)\/[\d.]+/gi, '').replace(/\s{2,}/g, ' ').trim();
  session.defaultSession.setUserAgent(clean);
  app.userAgentFallback = clean;
}

// Couleurs des boutons système (réduire/agrandir/fermer) superposés, selon le thème.
function overlayOptions() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#0a0d14' : '#f4f6fa', symbolColor: dark ? '#e8edf5' : '#10141c', height: NAV - 2 }; // 2 px de moins que le header : la barre de chargement (#progress, en bas) passe sous les boutons système
}
// Le thème pilote nativeTheme : Chromium force alors prefers-color-scheme partout
// (interface + pages web), et le CSS bascule via sa media query, sans rechargement.
function applyTheme() {
  nativeTheme.themeSource = theme; // 'system' | 'light' | 'dark'
  if (win) {
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0a0d14' : '#f4f6fa');
    try { win.setTitleBarOverlay(overlayOptions()); } catch {}
  }
}

function createWindow() {
  const currentTabId = load();
  loadPasswords();
  cleanUserAgent();
  applyTheme();
  win = new BaseWindow({
    width: 1400, height: 880, minWidth: 700, minHeight: 400, title: 'NaX',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0d14' : '#f4f6fa',
    titleBarStyle: 'hidden',          // pas de barre de titre système : le haut de l'UI fait office de header
    titleBarOverlay: overlayOptions(), // garde les boutons réduire/agrandir/fermer natifs en superposition
  });
  // l'option icon de BaseWindow n'alimente pas la barre des tâches Windows : on la pose explicitement
  try { win.setIcon(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.ico'))); } catch {}
  chrome = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.contentView.addChildView(chrome);
  layout();
  win.on('resize', () => { layout(); hidePeek(); hideMenu(); hideTip(); hideFind(); hideSuggest(); syncTipBounds(); });
  win.on('move', () => { hidePeek(); hideMenu(); hideTip(); hideFind(); hideSuggest(); syncTipBounds(); });
  win.on('hide', () => { hidePeek(); hideMenu(); hideTip(); hideSuggest(); });
  win.on('blur', () => hideTip());
  chrome.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  chrome.webContents.once('did-finish-load', () => {
    if (startupMode === 'home') { tabs = []; groups = []; current = null; newTab(); }
    else { const t = tabById(currentTabId) || tabs[0]; if (t) activateTab(t.id); else newTab(); }
    if (devMode) setDevMode(true); // relance le scan si le mode dev était actif
    setTimeout(pollGmail, 5000);          // pastille du compteur Gmail
    setInterval(pollGmail, 3 * 60 * 1000);
    ensureTipWin();                       // overlay des tooltips personnalisés
  });
  initDownloads();
  initPermissions();
  applyLanguages();
  // Langues préférées des pages (Accept-Language), piloté par les Paramètres.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
    if (acceptLanguage) details.requestHeaders['Accept-Language'] = acceptLanguage;
    cb({ requestHeaders: details.requestHeaders });
  });
  buildMenu();
  registerIpc();
  setInterval(housekeeping, 60 * 1000);
  initAutoUpdate();
}

// Mise à jour automatique via les Releases GitHub (dépôt public défini dans build.publish).
// Ne fait rien en dev : ne s'active que sur l'app installée.
function initAutoUpdate() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', async (info) => {
    const res = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Redémarrer maintenant', 'Plus tard'], defaultId: 0, cancelId: 1,
      title: 'Mise à jour de NaX',
      message: `NaX ${info.version} est prêt.`,
      detail: 'La mise à jour s’installera au redémarrage.',
    });
    if (res.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', () => {}); // silencieux : pas d'internet, dépôt absent, etc.
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);                     // au démarrage
  setInterval(check, 6 * 60 * 60 * 1000);      // puis toutes les 6 h
}

// Une seule instance : deux NaX sur le même profil se réécrivent state.json l'un sur l'autre
// (pertes d'applis du rail, de tâches Claude…). Un second lancement met la fenêtre existante au premier plan.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  destroyChatView();
  for (const [id, proc] of claudeProcs) { try { proc.kill(); } catch {} claudeProcs.delete(id); }
  clearTimeout(saveTimer);
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(snapshot())); } catch {}
  clearTimeout(claudeSaveTimer);
  try { fs.writeFileSync(CLAUDE_FILE, JSON.stringify({ tasks: claudeTasks, nextId: claudeNextId, claudeOpen })); } catch {}
});
