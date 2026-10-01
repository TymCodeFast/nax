// Interface du navigateur : rend l'état envoyé par le process principal, renvoie les actions.
// Le rendu est « réconcilié » (nœuds conservés par clé) pour que les animations ne redémarrent pas à chaque mise à jour.
const $ = (id) => document.getElementById(id);
const root = $('root'), urlEl = $('url'), omnibox = $('omnibox'), navbar = $('navbar');
let state = null;
let urlFocused = false;
let renamingGroup = null;
// État replié de la section « en veille ». null = pas encore décidé (voir renderTabs).
let dormantCollapsed = (() => { try { const v = localStorage.getItem('dormantCollapsed'); return v === null ? null : v === '1'; } catch { return null; } })();
let dnd = null;          // glisser en cours (onglet ou groupe)
let suppressClick = false; // ignore le clic qui suit un glisser
let favCollapsed = (() => { try { const v = localStorage.getItem('favCollapsed'); return v === null ? null : v === '1'; } catch { return null; } })();
let renamingFav = null;
let renamingFavCtx = null; // 'sidebar' | 'panel' : où le champ de renommage doit s'afficher
let gmailUnread = 0;

const HOME = 'https://www.google.com/';
function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
const favicon = (t) => t.favicon || (hostOf(t.url) ? `https://www.google.com/s2/favicons?domain=${hostOf(t.url)}&sz=32` : null);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function icon(name, cls) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); if (cls) s.setAttribute('class', cls); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + name); s.appendChild(u); return s; }
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
function setSrc(img, src) { if (img.getAttribute('src') !== src) img.setAttribute('src', src); }
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'à l’instant'; if (m < 60) return `${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h`;
  const d = Math.round(h / 24); return d === 1 ? 'hier' : `${d} j`;
}
const isCurrent = (kind, id) => !!state.current && state.current.kind === kind && state.current.id === id;

// Réconciliation : garde les nœuds existants (par clé), anime les entrées/sorties, ne déplace que si l'ordre change.
function sync(container, items, keyOf, create, update) {
  const live = [...container.children].filter((c) => !c.classList.contains('leave'));
  const existing = new Map(live.map((c) => [c.dataset.key, c]));
  const seen = new Set();
  items.forEach((it, i) => {
    const k = String(keyOf(it));
    let node = existing.get(k);
    if (!node) {
      node = create(it); node.dataset.key = k;
      node.classList.add('enter'); node.addEventListener('animationend', () => node.classList.remove('enter'), { once: true });
    }
    update(node, it);
    seen.add(k);
    const cur = [...container.children].filter((c) => !c.classList.contains('leave'))[i];
    if (cur !== node) container.insertBefore(node, cur || null);
  });
  for (const [k, node] of existing) if (!seen.has(k)) {
    node.classList.add('leave');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 350);
  }
}

// ---------- rendu ----------
function render() {
  if (!state) return;
  root.classList.toggle('collapsed', !state.sidebarOpen);
  if (!resizing && state.sidebarWidth) root.style.setProperty('--side-w', state.sidebarWidth + 'px');
  renderApps(); renderTabs(); renderFavorites(); renderNav(); renderDevRail(); renderSplit();
  setText($('archive-count'), state.archiveCount ? String(state.archiveCount) : '');
  const devPane = document.querySelector('.settings-pane[data-pane="dev"]');
  if (openOverlay === 'settings' && devPane && !devPane.classList.contains('hidden')) renderDevPane();
  const favPane = document.querySelector('.settings-pane[data-pane="favorites"]');
  if (openOverlay === 'settings' && favPane && !favPane.classList.contains('hidden') && !(dnd && dnd.kind === 'favmgr') && renamingFav === null) renderFavPane();
}

function renderDevRail() {
  const projs = state.devProjects || [];
  const show = !!state.devMode && projs.length > 0;
  $('dev-rail').classList.toggle('hidden', !show);
  if (!show) return;
  sync($('dev-projects'), projs, (p) => 'p' + p.port,
    (p) => {
      const b = el('button', 'devproj');
      b.appendChild(el('span', 'tile'));
      b.appendChild(el('span', 'port'));
      b.onclick = () => { closeOverlay(); api.devOpen(p.url); };
      return b;
    },
    (b, p) => {
      const name = (p.title || '').replace(/^https?:\/\//, '').trim() || ('localhost:' + p.port);
      b.title = `${p.title}\n${p.url}`;
      setText(b.querySelector('.tile'), (name[0] || '#').toUpperCase());
      setText(b.querySelector('.port'), String(p.port));
    });
}

// Helpers d'arbre côté interface (miroir du main).
function favFindC(id, nodes = state.favorites || [], parent = null) {
  for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; if (n.id === id) return { node: n, parent, list: nodes, index: i }; if (n.children) { const r = favFindC(id, n.children, n); if (r) return r; } }
  return null;
}
function favCountLinks(nodes) { let c = 0; for (const n of nodes || []) { if (n.type === 'link') c++; if (n.children) c += favCountLinks(n.children); } return c; }
function favSubtreeIds(id) { const f = favFindC(id); const ids = new Set([id]); if (f && f.node.children) (function w(ns) { for (const n of ns) { ids.add(n.id); if (n.children) w(n.children); } })(f.node.children); return ids; }

function renderFavorites() {
  if (dnd && dnd.kind === 'fav') return; // ne pas reconstruire pendant un glisser
  const favs = state.favorites || [];
  const wrap = $('fav-wrap');
  wrap.classList.toggle('empty', favs.length === 0);
  setText($('fav-count'), favs.length ? String(favCountLinks(favs)) : '');
  if (favCollapsed === null) favCollapsed = false;
  wrap.classList.toggle('collapsed', favCollapsed);
  const box = $('favorites');
  const line = $('fav-line');
  box.innerHTML = '';
  if (line) box.appendChild(line); // conserver la ligne de dépôt
  renderFavNodes(favs, box, 0, null);
}
function renderFavNodes(nodes, box, depth, parentId) {
  nodes.forEach((n, index) => {
    box.appendChild(favRow(n, depth, parentId, index));
    if (n.type === 'folder' && !n.collapsed && n.children) renderFavNodes(n.children, box, depth + 1, n.id);
  });
}
function favRow(n, depth, parentId, index) {
  const isFolder = n.type === 'folder';
  const open = isFolder && !n.collapsed;
  const row = el('div', 'fav' + (isFolder ? ' folder' : '') + (open ? ' open' : ''));
  row.dataset.id = n.id; row.dataset.parent = parentId || ''; row.dataset.index = index; row.dataset.depth = depth; row.dataset.type = n.type;
  row.style.paddingLeft = (10 + depth * 15) + 'px';
  if (isFolder) {
    row.appendChild(icon('i-forward', 'fav-chev'));
    const ico = el('span', 'fav-ico'); ico.appendChild(icon('i-folder')); row.appendChild(ico);
  } else {
    const img = el('img', 'fav-ico'); img.alt = ''; img.src = n.favicon || `https://www.google.com/s2/favicons?domain=${hostOf(n.url)}&sz=32`; img.onerror = () => { img.style.visibility = 'hidden'; };
    row.appendChild(img);
  }
  const titleEl = el('span', 'title');
  if (renamingFav === n.id && renamingFavCtx !== 'panel') {
    const inp = el('input'); inp.value = n.title || '';
    let done = false;
    const finish = (save) => { if (done) return; done = true; renamingFav = null; renamingFavCtx = null; if (save) api.favRename({ id: n.id, title: inp.value }); else render(); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
    inp.onmousedown = (e) => e.stopPropagation();
    titleEl.appendChild(inp);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  } else {
    setText(titleEl, n.title || (isFolder ? 'Dossier' : hostOf(n.url) || n.url));
    titleEl.ondblclick = (e) => { e.stopPropagation(); renamingFav = n.id; renamingFavCtx = 'sidebar'; render(); };
  }
  row.appendChild(titleEl);
  if (isFolder) {
    row.appendChild(el('span', 'fav-count', String((n.children || []).length)));
    // Ouvre le dossier dans la vue agrandie (palette), même style que la recherche.
    const openBtn = el('button', 'fav-open'); openBtn.title = 'Ouvrir le dossier en grand';
    openBtn.appendChild(icon('i-expand'));
    openBtn.onclick = (e) => { e.stopPropagation(); openFolderInPalette(n.id); };
    row.appendChild(openBtn);
  }
  row.title = isFolder ? n.title : n.url;
  // Suppression : uniquement via le clic droit (menu contextuel).
  row.onclick = () => { if (suppressClick || renamingFav === n.id) return; if (isFolder) api.favToggleFolder(n.id); else api.favOpen(n.id); };
  row.onauxclick = (e) => { if (e.button === 1 && !isFolder) api.favOpenNew(n.id); };
  row.oncontextmenu = (e) => { e.preventDefault(); api.favContext(n.id); };
  row.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('.fav-open') && renamingFav !== n.id) beginFavDrag(e, n.id); });
  return row;
}

function renderApps() {
  sync($('apps'), state.apps, (a) => a.id,
    (a) => {
      const b = el('button', 'app');
      const img = el('img'); img.alt = '';
      img.onerror = () => { img.replaceWith(el('span', 'letter', a.name[0])); };
      b.appendChild(img);
      b.appendChild(el('span', 'badge'));
      b.onclick = () => { closeOverlay(); api.appActivate(a.id); };
      b.oncontextmenu = (e) => { e.preventDefault(); api.appContext(a.id); };
      // aperçu au survol (petit panneau flottant)
      let peekTimer = null;
      b.onmouseenter = () => { clearTimeout(peekTimer); peekTimer = setTimeout(() => api.appPeek(b.dataset.appId, Math.round(b.getBoundingClientRect().top)), 320); };
      b.onmouseleave = () => { clearTimeout(peekTimer); api.appPeekHideSoon(); };
      return b;
    },
    (b, a) => {
      b.title = a.name;
      b.dataset.appId = a.id;
      b.classList.toggle('active', isCurrent('app', a.id));
      const img = b.querySelector('img'); if (img) setSrc(img, a.icon || a.favicon || `https://www.google.com/s2/favicons?domain=${hostOf(a.url)}&sz=64`);
      const badge = b.querySelector('.badge');
      const n = /mail\.google\.com/i.test(a.url) ? gmailUnread : 0;
      if (n > 0) { setText(badge, n > 99 ? '99+' : String(n)); badge.classList.add('on'); }
      else badge.classList.remove('on');
    });
}

// Regroupe les membres en unités : une paire divisée = 1 unité (deux tuiles), sinon 1 onglet.
function tabUnits(members) {
  const out = [], used = new Set();
  for (const m of members) {
    if (used.has(m.id)) continue;
    const sec = members.find((x) => x.splitParent === m.id);
    if (sec && !m.splitParent) { out.push({ key: 'pair-' + m.id, pair: true, primary: m, secondary: sec }); used.add(m.id); used.add(sec.id); }
    else if (m.splitParent && members.some((x) => x.id === m.splitParent)) { used.add(m.id); } // rendu via son primaire
    else { out.push({ key: 't' + m.id, pair: false, tab: m }); used.add(m.id); }
  }
  return out;
}
function createUnit(u) { return u.pair ? createPairRow(u) : createTabRow(u.tab); }
function updateUnit(node, u) { if (u.pair) updatePairRow(node, u); else updateTabRow(node, u.tab); }

function createPairRow(u) {
  const row = el('div', 'pair-row');
  row.appendChild(pairTile(u.primary.id));
  const lk = el('span', 'pair-link'); lk.appendChild(icon('i-link')); row.appendChild(lk);
  row.appendChild(pairTile(u.secondary.id));
  return row;
}
function pairTile(id) {
  const t = el('div', 'pair-tile'); t.dataset.id = id;
  const ico = el('span', 'ico'); ico.appendChild(el('span', 'dot')); t.appendChild(ico);
  t.appendChild(el('span', 'title'));
  const x = el('button', 'x'); x.title = 'Fermer'; x.appendChild(icon('i-close'));
  x.onclick = (e) => { e.stopPropagation(); api.tabClose(id); };
  t.appendChild(x);
  t.onclick = () => { if (suppressClick) return; closeOverlay(); api.tabActivate(id); };
  t.onauxclick = (e) => { if (e.button === 1) api.tabClose(id); };
  t.oncontextmenu = (e) => { e.preventDefault(); api.tabContext(id); };
  return t;
}
function updatePairRow(node, u) {
  const sp = state.split || {};
  const active = sp.active && (u.primary.id === sp.primaryId || u.secondary.id === sp.secondaryId);
  node.classList.toggle('active', active);
  const tiles = node.querySelectorAll('.pair-tile');
  updatePairTile(tiles[0], u.primary, sp.active && u.primary.id === sp.primaryId);
  updatePairTile(tiles[1], u.secondary, sp.active && u.secondary.id === sp.secondaryId);
  const priv = u.secondary.splitMode === 'private' || !!u.secondary.partition;
  tiles[1].classList.toggle('private', priv);
}
function updatePairTile(tile, t, isActive) {
  tile.classList.toggle('cur', !!isActive);
  tile.classList.toggle('dormant', !!t.dormant);
  tile.classList.toggle('loading', !!t.loading);
  tile.title = t.title || hostOf(t.url) || t.url;
  const ico = tile.querySelector('.ico');
  const src = favicon(t);
  let img = ico.querySelector('img');
  if (src) {
    if (!img) { img = el('img'); img.alt = ''; img.onerror = () => { img.remove(); if (!ico.querySelector('.dot')) ico.appendChild(el('span', 'dot')); }; ico.innerHTML = ''; ico.appendChild(img); }
    setSrc(img, src);
  } else if (!ico.querySelector('.dot')) { ico.innerHTML = ''; ico.appendChild(el('span', 'dot')); }
  setText(tile.querySelector('.title'), t.title || hostOf(t.url) || 'Onglet');
}

function createTabRow(t) {
  const row = el('div', 'tab');
  const ico = el('span', 'ico'); ico.appendChild(el('span', 'dot')); row.appendChild(ico);
  row.appendChild(el('span', 'title'));
  row.appendChild(el('span', 'sub'));
  const link = el('span', 'tab-link'); link.title = 'Volets liés'; link.appendChild(icon('i-link')); row.appendChild(link);
  const x = el('button', 'x'); x.title = 'Fermer'; x.appendChild(icon('i-close'));
  x.onclick = (e) => { e.stopPropagation(); api.tabClose(t.id); };
  row.appendChild(x);
  row.onclick = () => { if (suppressClick) return; closeOverlay(); api.tabActivate(t.id); };
  row.onauxclick = (e) => { if (e.button === 1) api.tabClose(t.id); };
  row.oncontextmenu = (e) => { e.preventDefault(); api.tabContext(t.id); };
  row.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('.x')) beginTabDrag(e, t.id); });
  return row;
}
function updateTabRow(row, t) {
  const sp = state.split || {};
  const inActivePair = sp.active && (t.id === sp.primaryId || t.id === sp.secondaryId);
  row.classList.toggle('active', isCurrent('tab', t.id) || inActivePair);
  const linked = !!t.splitParent || (state.tabs || []).some((x) => x.splitParent === t.id);
  row.classList.toggle('linked', linked);
  row.classList.toggle('split-secondary', !!t.splitParent);
  row.classList.toggle('dormant', !!t.dormant);
  row.classList.toggle('loading', !!t.loading);
  row.title = t.url;
  const ico = row.querySelector('.ico');
  const src = favicon(t);
  let img = ico.querySelector('img');
  if (src) {
    if (!img) { img = el('img'); img.alt = ''; img.onerror = () => { img.remove(); if (!ico.querySelector('.dot')) ico.appendChild(el('span', 'dot')); }; ico.innerHTML = ''; ico.appendChild(img); }
    setSrc(img, src);
  } else if (!ico.querySelector('.dot')) { ico.innerHTML = ''; ico.appendChild(el('span', 'dot')); }
  setText(row.querySelector('.title'), t.title || hostOf(t.url) || 'Nouvel onglet');
  setText(row.querySelector('.sub'), t.dormant ? ago(t.lastActive) : '');
}

function renderTabs() {
  if (dnd) return; // ne pas réordonner le DOM sous la souris pendant un glisser
  // Les onglets en veille restent à leur place dans la liste (simplement grisés), ils ne sont plus déplacés.
  const visibleGroups = state.groups.map((g) => ({ ...g, members: state.tabs.filter((t) => t.groupId === g.id) })).filter((g) => g.members.length);

  sync($('tabs'), visibleGroups, (g) => g.id,
    () => { const gEl = el('div', 'group'); gEl.appendChild(el('div', 'group-title')); gEl.appendChild(el('div', 'group-tabs')); return gEl; },
    (gEl, g) => {
      // une « paire divisée » (2 onglets liés) n'est pas un vrai groupe : pas d'en-tête de groupe, juste le lien
      const pairOnly = g.members.length === 2 && g.members.some((m) => m.splitParent && g.members.some((o) => o.id === m.splitParent)) && !g.custom;
      const multi = g.members.length > 1 && !pairOnly;
      const collapsed = multi && !!g.collapsed;
      gEl.classList.toggle('multi', multi);
      gEl.classList.toggle('pair', pairOnly);
      gEl.classList.toggle('collapsed', collapsed);
      gEl.classList.toggle('hasactive', collapsed && g.members.some((t) => isCurrent('tab', t.id)));
      const head = gEl.querySelector('.group-title');
      head.style.display = multi ? '' : 'none';
      if (multi) renderGroupHead(head, g, collapsed);
      // une paire divisée (primaire + secondaire) se rend en UNE ligne à deux tuiles côte à côte
      sync(gEl.querySelector('.group-tabs'), tabUnits(g.members), (u) => u.key, createUnit, updateUnit);
    });

  // Ancienne section « en veille » désactivée : les onglets dormants vivent dans la liste.
  const wrap = $('dormant-wrap');
  if (wrap) { wrap.classList.add('empty'); const db = $('dormant'); if (db && db.children.length) db.innerHTML = ''; }
}

function renderGroupHead(head, g, collapsed) {
  const renaming = renamingGroup === g.id;
  if (head.dataset.mode !== (renaming ? 'edit' : 'view')) {
    head.innerHTML = ''; head.dataset.mode = renaming ? 'edit' : 'view';
    if (renaming) {
      const inp = el('input'); inp.value = g.custom ? g.title : ''; inp.placeholder = g.title;
      let done = false;
      const finish = (save) => { if (done) return; done = true; renamingGroup = null; if (save) api.groupRename({ id: g.id, title: inp.value }); else render(); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
      inp.onblur = () => finish(true);
      head.appendChild(inp);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      return;
    }
    const chev = el('button', 'g-chev'); chev.title = 'Réduire / déplier le groupe'; chev.appendChild(icon('i-forward'));
    chev.onclick = (e) => { e.stopPropagation(); if (!suppressClick) api.groupToggle(g.id); };
    head.appendChild(chev);
    const name = el('span', 'name'); name.title = 'Clic pour réduire, double-clic pour renommer, glisser pour déplacer';
    name.ondblclick = (e) => { e.stopPropagation(); renamingGroup = g.id; render(); };
    name.onclick = () => { if (!suppressClick) api.groupToggle(g.id); };
    head.appendChild(name);
    head.appendChild(el('div', 'g-stack'));
    head.appendChild(el('span', 'n'));
    const x = el('button', 'icon-btn'); x.title = 'Fermer le groupe'; x.appendChild(icon('i-close'));
    x.onclick = (e) => { e.stopPropagation(); api.groupClose(g.id); }; head.appendChild(x);
    head.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('.icon-btn') && !e.target.closest('.g-chev') && head.dataset.mode === 'view') beginGroupDrag(e, g.id); });
  }
  if (!renaming) {
    const name = head.querySelector('.name');
    setText(name, g.title || 'Groupe'); name.classList.toggle('custom', !!g.custom);
    setText(head.querySelector('.n'), String(g.members.length));
    const stack = head.querySelector('.g-stack');
    stack.innerHTML = '';
    if (collapsed) {
      g.members.slice(0, 4).forEach((t) => {
        const src = favicon(t); if (!src) return;
        const im = el('img'); im.src = src; im.alt = ''; im.onerror = () => im.remove(); stack.appendChild(im);
      });
    }
  }
}

function renderNav() {
  const n = state.nav;
  $('back').disabled = !n.canGoBack;
  $('forward').disabled = !n.canGoForward;
  $('reload').querySelector('use').setAttribute('href', n.loading ? '#i-stop' : '#i-reload');
  $('reload').title = n.loading ? 'Arrêter' : 'Recharger (Ctrl+R)';
  navbar.classList.toggle('loading', !!n.loading);
  const isHome = n.url === HOME;
  omnibox.classList.toggle('secure', !isHome && n.url.startsWith('https://'));
  $('omni-icon').querySelector('use').setAttribute('href', !isHome && n.url.startsWith('https://') ? '#i-lock' : '#i-globe');
  if (!urlFocused) {
    urlEl.value = isHome ? '' : n.url;
    setText($('omni-host'), '');
  }
  const star = $('fav-star');
  const onTab = !!(state.current && state.current.kind === 'tab');
  star.disabled = !onTab;
  star.classList.toggle('active', !!state.favActive);
  star.title = state.favActive ? 'Retirer des favoris (Ctrl+D)' : 'Ajouter aux favoris (Ctrl+D)';
}

// ---------- barre de nav ----------
$('back').onclick = () => api.back();
$('forward').onclick = () => api.forward();
$('reload').onclick = () => api.reload();
$('home').onclick = () => api.home();
$('omni-hint').onclick = () => openPalette();
$('fav-star').onclick = () => api.favToggle();
$('fav-toggle-sec').onclick = () => {
  favCollapsed = !favCollapsed;
  try { localStorage.setItem('favCollapsed', favCollapsed ? '1' : '0'); } catch {}
  $('fav-wrap').classList.toggle('collapsed', favCollapsed);
};
$('fav-new-folder').onclick = (e) => { e.stopPropagation(); if (favCollapsed) { favCollapsed = false; $('fav-wrap').classList.remove('collapsed'); } api.favFolder({}); };
// ---------- autocomplétion de la barre d'adresse ----------
const stripScheme = (u) => (u || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
let omniItems = [], omniSel = -1, omniOpen = false, typedQuery = '', prevLen = 0, deleting = false;
let lastLocal = [], lastIsUrl = false, gTimer = null; const gCache = {};

function omniRect() { const r = omnibox.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4, w: r.width }; }
function toDisplay(it) {
  if (it.kind === 'tab') return { kind: 'tab', title: it.title || hostOf(it.url), secondary: stripScheme(it.url), tag: 'Onglet', url: it.url, favicon: it.favicon };
  if (it.kind === 'favorite') return { kind: 'favorite', title: it.title || stripScheme(it.url), secondary: stripScheme(it.url), tag: 'Favori', url: it.url, favicon: it.favicon };
  if (it.kind === 'history') return { kind: 'history', title: it.title || stripScheme(it.url), secondary: stripScheme(it.url), url: it.url };
  if (it.kind === 'url') return { kind: 'url', title: stripScheme(it.url), secondary: 'Ouvrir le site', url: it.url };
  return { kind: 'search', title: it.query, secondary: 'Rechercher sur ' + engineName() };
}
function engineName() { const es = (state && state.searchEngines) || []; const e = es.find((x) => x.id === (state && state.searchEngine)); return e ? e.name : 'Google'; }
function renderSuggest() {
  if (!omniItems.length) { closeSuggest(); return; }
  api.suggestShow({ items: omniItems.map(toDisplay), sel: omniSel, rect: omniRect(), dark: isDark(), q: typedQuery });
  omniOpen = true;
}
function closeSuggest() { if (omniOpen) { api.suggestHide(); omniOpen = false; } omniSel = -1; }

function buildList(q, local, isUrl, googleArr) {
  const items = [];
  const has = (pred) => items.some(pred);
  for (const it of local) items.push(it);
  if (isUrl) { const u = /:\/\//.test(q) ? q : 'https://' + q; if (!has((x) => x.url && stripScheme(x.url).toLowerCase() === stripScheme(u).toLowerCase())) items.unshift({ kind: 'url', url: u }); }
  for (const s of (googleArr || [])) { if (has((x) => x.kind === 'search' && x.query.toLowerCase() === s.toLowerCase())) continue; if (local.some((l) => (l.title || '').toLowerCase() === s.toLowerCase())) continue; items.push({ kind: 'search', query: s }); }
  if (!isUrl && !has((x) => x.kind === 'search' && x.query.toLowerCase() === q.toLowerCase())) items.push({ kind: 'search', query: q });
  omniItems = items.slice(0, 8);
}
function applyInline(q) {
  omniSel = -1;
  if (deleting) return;
  const ql = q.toLowerCase();
  const idx = omniItems.findIndex((it) => it.url && stripScheme(it.url).toLowerCase().startsWith(ql) && stripScheme(it.url).length > q.length);
  if (idx >= 0) {
    const disp = stripScheme(omniItems[idx].url);
    urlEl.value = q + disp.slice(q.length);
    try { urlEl.setSelectionRange(q.length, urlEl.value.length); } catch {}
    omniSel = idx;
  }
}
async function onOmniInput() {
  const q = urlEl.value;
  deleting = q.length < prevLen; prevLen = q.length;
  typedQuery = q;
  if (!q.trim()) { closeSuggest(); return; }
  const r = await api.omniSuggest(q);
  if (typedQuery !== q) return; // saisie plus récente
  lastLocal = r.local; lastIsUrl = r.isUrl;
  buildList(q, r.local, r.isUrl, gCache[q]);
  applyInline(q);
  renderSuggest();
  scheduleGoogle(q);
}
function scheduleGoogle(q) {
  clearTimeout(gTimer);
  if (gCache[q]) return; // déjà en cache, déjà fusionné
  gTimer = setTimeout(async () => {
    const arr = await api.omniGoogle(q);
    gCache[q] = arr;
    if (typedQuery === q && omniOpen) { const keepSel = omniSel; buildList(q, lastLocal, lastIsUrl, arr); omniSel = Math.min(keepSel, omniItems.length - 1); renderSuggest(); }
  }, 130);
}
function previewSel() {
  if (omniSel < 0) { urlEl.value = typedQuery; }
  else { const it = omniItems[omniSel]; urlEl.value = it.kind === 'search' ? it.query : (it.url || typedQuery); }
  try { urlEl.setSelectionRange(urlEl.value.length, urlEl.value.length); } catch {}
  renderSuggest();
}
function commitOmni(item, newTab) {
  const typed = urlEl.value.trim(); // capturer AVANT le blur (qui réinitialise le champ)
  closeSuggest();
  urlEl.blur();
  if (!item) { if (typed) (newTab ? api.openUrlNew(typed) : api.navigate(typed)); return; }
  if (item.kind === 'tab') api.tabActivate(item.id);
  else if (item.kind === 'search') (newTab ? api.openUrlNew(item.query) : api.navigate(item.query));
  else (newTab ? api.openUrlNew(item.url) : api.navigate(item.url));
}

urlEl.addEventListener('focus', () => { urlFocused = true; omnibox.classList.add('focus'); prevLen = urlEl.value.length; setTimeout(() => urlEl.select(), 0); });
urlEl.addEventListener('blur', () => { urlFocused = false; omnibox.classList.remove('focus'); closeSuggest(); renderNav(); });
urlEl.addEventListener('input', onOmniInput);
urlEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (!omniItems.length) return; omniSel = omniSel + 1 >= omniItems.length ? -1 : omniSel + 1; previewSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (!omniItems.length) return; omniSel = omniSel <= -1 ? omniItems.length - 1 : omniSel - 1; previewSel(); }
  else if (e.key === 'Enter') { e.preventDefault(); commitOmni(omniSel >= 0 ? omniItems[omniSel] : null, e.ctrlKey); }
  else if (e.key === 'Escape') { if (omniOpen) { closeSuggest(); renderNav(); } else { urlEl.blur(); api.focusPage(); } }
  else if (e.key === 'Tab' && omniOpen && omniSel >= 0) { e.preventDefault(); previewSel(); }
});
api.onSuggestHover((idx) => { omniSel = idx; renderSuggest(); });
api.onSuggestChoose((idx) => { if (omniItems[idx]) commitOmni(omniItems[idx], false); });

$('tab-new').onclick = () => { closeOverlay(); api.tabNew(); };
$('sidebar-toggle').onclick = () => api.sidebarToggle();
$('dormant-toggle').onclick = () => {
  dormantCollapsed = !dormantCollapsed;
  try { localStorage.setItem('dormantCollapsed', dormantCollapsed ? '1' : '0'); } catch {}
  $('dormant-wrap').classList.toggle('collapsed', dormantCollapsed);
};

// ---------- glisser-déposer des onglets et des groupes ----------
const tabsBox = () => $('tabs');
function dropLine() { let l = $('drop-line'); if (!l) { l = el('div'); l.id = 'drop-line'; tabsBox().appendChild(l); } return l; }
function clearHints() {
  tabsBox().querySelectorAll('.drop-into, .drop-merge').forEach((e) => e.classList.remove('drop-into', 'drop-merge'));
  const l = $('drop-line'); if (l) l.style.display = 'none';
}
function showLine(clientYpix, loose) {
  const box = tabsBox(), br = box.getBoundingClientRect();
  const l = dropLine(); l.style.display = 'block'; l.classList.toggle('loose', !!loose);
  l.style.top = (clientYpix - br.top + box.scrollTop) + 'px';
}
function autoScroll(ev) {
  const box = (dnd && dnd.kind === 'favmgr') ? document.querySelector('.settings-content') : tabsBox();
  if (!box) return;
  const r = box.getBoundingClientRect(), m = 26;
  if (ev.clientY < r.top + m) box.scrollTop -= 9;
  else if (ev.clientY > r.bottom - m) box.scrollTop += 9;
}
// Moteur commun : seuil de départ, fantôme suiveur, nettoyage, suppression du clic post-glisser.
function runDrag(startEvent, srcEl, h) {
  const sx = startEvent.clientX, sy = startEvent.clientY;
  let started = false, ghost = null, dx = 0, dy = 0;
  const onMove = (ev) => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      started = true; dnd = { kind: h.kind };
      document.body.classList.add('dragging');
      srcEl.classList.add('drag-src');
      const r = srcEl.getBoundingClientRect(); dx = sx - r.left; dy = sy - r.top;
      ghost = srcEl.cloneNode(true); ghost.id = 'drag-ghost'; ghost.classList.add('drag-ghost'); ghost.classList.remove('drag-src');
      ghost.style.width = r.width + 'px'; document.body.appendChild(ghost);
      h.onStart && h.onStart();
    }
    ghost.style.left = (ev.clientX - dx) + 'px'; ghost.style.top = (ev.clientY - dy) + 'px';
    h.onMove(ev); autoScroll(ev);
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
    if (started) {
      h.onDrop();
      ghost && ghost.remove(); srcEl.classList.remove('drag-src'); clearHints(); clearFavHints();
      document.body.classList.remove('dragging'); dnd = null;
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 80);
    }
  };
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  startEvent.preventDefault();
}

function beginTabDrag(startEvent, tabId) {
  const srcRow = startEvent.currentTarget;
  let plan = null;
  runDrag(startEvent, srcRow, {
    kind: 'tab',
    onStart: () => { dnd.tabId = tabId; },
    onMove: (ev) => { plan = tabPlan(ev); paintTabPlan(plan); },
    onDrop: () => commitTab(plan),
  });
}
function tabPlan(ev) {
  const box = tabsBox();
  const rows = [...box.querySelectorAll('.tab')].filter((r) => +r.dataset.key !== dnd.tabId);
  const tabOf = (r) => state.tabs.find((t) => t.id === +r.dataset.key);
  const members = (gid) => state.tabs.filter((t) => t.groupId === gid).length;
  const y = ev.clientY;
  let hover = null, band = 0;
  for (const r of rows) { const b = r.getBoundingClientRect(); if (y >= b.top && y <= b.bottom) { hover = r; band = (y - b.top) / b.height; break; } }
  if (hover) {
    const ht = tabOf(hover);
    if (band > 0.28 && band < 0.72) return { kind: 'join', groupId: ht.groupId, afterTabId: ht.id, hoverRow: hover, multi: members(ht.groupId) > 1 };
    return reorderPlan(rows, hover, band >= 0.5, tabOf);
  }
  return reorderPlan(rows, rows[rows.length - 1] || null, true, tabOf);
}
function reorderPlan(rows, ref, after, tabOf) {
  let prev, next;
  if (!ref) { prev = null; next = rows[0] || null; }
  else { const i = rows.indexOf(ref); if (after) { prev = ref; next = rows[i + 1] || null; } else { prev = rows[i - 1] || null; next = ref; } }
  const gp = prev ? tabOf(prev).groupId : null;
  const gn = next ? tabOf(next).groupId : null;
  const same = (gp != null && gp === gn) ? gp : null;
  return { kind: 'reorder', afterTabId: prev ? +prev.dataset.key : null, groupId: same, makeNewGroup: same == null, prev, next };
}
function paintTabPlan(plan) {
  clearHints();
  if (plan.kind === 'join') {
    if (plan.multi) plan.hoverRow.closest('.group').classList.add('drop-into');
    else plan.hoverRow.classList.add('drop-merge');
    return;
  }
  let yPix;
  if (plan.next) yPix = plan.next.getBoundingClientRect().top;
  else if (plan.prev) yPix = plan.prev.getBoundingClientRect().bottom;
  else yPix = tabsBox().getBoundingClientRect().top + 4;
  showLine(yPix, plan.makeNewGroup);
}
function commitTab(plan) {
  if (!plan) return;
  api.tabMove({ tabId: dnd.tabId, afterTabId: plan.afterTabId, targetGroupId: plan.groupId, makeNewGroup: plan.kind === 'join' ? false : plan.makeNewGroup });
}

function beginGroupDrag(startEvent, groupId) {
  const srcGroup = startEvent.currentTarget.closest('.group');
  let plan = null;
  runDrag(startEvent, srcGroup, {
    kind: 'group',
    onStart: () => { dnd.groupId = groupId; },
    onMove: (ev) => { plan = groupPlan(ev); paintGroupPlan(plan); },
    onDrop: () => { if (plan) api.groupMove({ groupId, beforeGroupId: plan.beforeGroupId }); },
  });
}
function groupPlan(ev) {
  const box = tabsBox();
  const gidOf = (gEl) => { const r = gEl.querySelector('.tab'); return r ? (state.tabs.find((t) => t.id === +r.dataset.key) || {}).groupId : null; };
  const others = [...box.querySelectorAll('.group')].filter((gEl) => gidOf(gEl) !== dnd.groupId);
  const y = ev.clientY;
  for (const gEl of others) { const b = gEl.getBoundingClientRect(); if (y < b.top + b.height / 2) return { beforeGroupId: gidOf(gEl), ref: gEl, pos: 'before' }; }
  return { beforeGroupId: null, ref: others[others.length - 1] || null, pos: 'after' };
}
function paintGroupPlan(plan) {
  clearHints();
  if (!plan.ref) { showLine(tabsBox().getBoundingClientRect().top + 4, false); return; }
  const b = plan.ref.getBoundingClientRect();
  showLine(plan.pos === 'before' ? b.top : b.bottom, false);
}

// ---------- glisser-déposer dans l'arbre des favoris ----------
function favLine() { let l = $('fav-line'); if (!l) { l = el('div'); l.id = 'fav-line'; $('favorites').appendChild(l); } return l; }
function clearFavHints() {
  $('favorites').querySelectorAll('.fav-into').forEach((e) => e.classList.remove('fav-into'));
  const l = $('fav-line'); if (l) l.style.display = 'none';
}
function beginFavDrag(startEvent, id) {
  const srcRow = startEvent.currentTarget;
  let plan = null;
  runDrag(startEvent, srcRow, {
    kind: 'fav',
    onStart: () => { dnd.favId = id; dnd.subtree = favSubtreeIds(id); },
    onMove: (ev) => { plan = favPlan(ev); paintFavPlan(plan); },
    onDrop: () => { if (plan) api.favMove({ id, targetParentId: plan.targetParentId, beforeId: plan.beforeId }); },
  });
}
function favPlan(ev) {
  const box = $('favorites');
  const rows = [...box.querySelectorAll('.fav')].filter((r) => !dnd.subtree.has(r.dataset.id));
  const y = ev.clientY;
  let hover = null, band = 0;
  for (const r of rows) { const b = r.getBoundingClientRect(); if (y >= b.top && y <= b.bottom) { hover = r; band = (y - b.top) / b.height; break; } }
  if (!hover) {
    const last = rows[rows.length - 1];
    const yPix = last ? last.getBoundingClientRect().bottom : box.getBoundingClientRect().top + 4;
    return { targetParentId: null, beforeId: null, mode: 'reorder', depth: 0, yPix };
  }
  const hid = hover.dataset.id;
  const isFolder = hover.dataset.type === 'folder';
  const open = hover.classList.contains('open');
  const f = favFindC(hid);
  const hasChildren = !!(f && f.node.children && f.node.children.length);
  const rect = hover.getBoundingClientRect();
  // milieu d'un dossier → déposer dedans
  if (isFolder && band > 0.3 && band < 0.7) return { mode: 'into', into: hid, targetParentId: hid, beforeId: null };
  const before = band < 0.5;
  // juste après un dossier ouvert non vide → en 1re position dans le dossier
  if (!before && isFolder && open && hasChildren) {
    const first = f.node.children[0];
    return { mode: 'into', into: hid, targetParentId: hid, beforeId: first.id, yPix: rect.bottom, depth: +hover.dataset.depth + 1 };
  }
  const parentId = hover.dataset.parent || null;
  const beforeId = before ? hid : (f.list[f.index + 1] ? f.list[f.index + 1].id : null);
  return { mode: 'reorder', targetParentId: parentId, beforeId, depth: +hover.dataset.depth, yPix: before ? rect.top : rect.bottom };
}
function paintFavPlan(plan) {
  clearFavHints();
  const box = $('favorites'), br = box.getBoundingClientRect();
  if (plan.mode === 'into') {
    const el0 = [...box.querySelectorAll('.fav')].find((r) => r.dataset.id === plan.into);
    if (el0) el0.classList.add('fav-into');
    if (plan.yPix == null) return; // simple mise en surbrillance
  }
  const l = favLine(); l.style.display = 'block';
  l.style.left = (10 + (plan.depth || 0) * 15) + 'px';
  l.style.top = (plan.yPix - br.top + box.scrollTop) + 'px';
}

// ---------- redimensionnement de la liste ----------
let resizing = false;
const RAIL_W = 60, SIDE_MIN = 180, SIDE_MAX = 520;
$('resizer').addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizing = true; document.body.classList.add('resizing');
  api.sidebarResizeStart();
  let w = state ? state.sidebarWidth : 264, raf = 0;
  const move = (ev) => {
    w = Math.min(SIDE_MAX, Math.max(SIDE_MIN, ev.clientX - RAIL_W));
    root.style.setProperty('--side-w', w + 'px');
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; api.sidebarResize(w); });
  };
  const up = () => {
    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
    resizing = false; document.body.classList.remove('resizing');
    api.sidebarResize(w); api.sidebarResizeEnd();
  };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
});

// ---------- vue divisée (deux volets) ----------
function renderSplit() {
  const active = !!(state.split && state.split.active);
  document.body.classList.toggle('split', active);
  const tbR = $('split-tb-right'), div = $('split-divider'), nav = $('navbar');
  if (!active) { tbR.classList.add('hidden'); div.classList.add('hidden'); nav.style.width = ''; return; }
  const contentW = $('content').clientWidth || 1;
  const leftW = Math.max(160, Math.round((contentW - 6) * (state.splitRatio || 0.5)));
  nav.style.width = leftW + 'px';
  tbR.classList.remove('hidden'); tbR.style.left = (leftW + 6) + 'px';
  const hideOverlay = !!openOverlay;
  div.classList.toggle('hidden', hideOverlay); div.style.left = leftW + 'px';
  // mise à jour de la barre du volet droit
  const n = state.splitNav || {};
  $('sp-back').disabled = !n.canGoBack; $('sp-forward').disabled = !n.canGoForward;
  $('sp-reload').querySelector('use').setAttribute('href', n.loading ? '#i-stop' : '#i-reload');
  const spUrl = $('sp-url');
  if (document.activeElement !== spUrl) spUrl.value = n.url || '';
  const badge = $('sp-badge');
  const priv = state.split.mode === 'private';
  setText(badge, priv ? 'Privé' : 'Partagé');
  badge.classList.toggle('private', priv);
}
$('sp-back').onclick = () => api.splitBack();
$('sp-forward').onclick = () => api.splitForward();
$('sp-reload').onclick = () => api.splitReload();
$('sp-close').onclick = () => api.splitClose();
$('sp-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { api.splitNavigate(e.target.value); e.target.blur(); } });

// Bouton « Diviser la vue » : bascule ou propose le mode de session (menu natif, au-dessus des pages).
$('split-btn').onclick = () => {
  if (state && state.split && state.split.active) api.splitClose();
  else api.splitMenu();
};

// Séparateur déplaçable entre les deux volets.
$('split-divider').addEventListener('mousedown', (e) => {
  e.preventDefault();
  document.body.classList.add('resizing');
  api.splitResizeStart();
  const cont = $('content');
  const move = (ev) => {
    const r = cont.getBoundingClientRect();
    const ratio = Math.min(0.8, Math.max(0.2, (ev.clientX - r.left - 3) / Math.max(1, r.width - 6)));
    $('navbar').style.width = Math.round((r.width - 6) * ratio) + 'px';
    $('split-tb-right').style.left = (Math.round((r.width - 6) * ratio) + 6) + 'px';
    $('split-divider').style.left = Math.round((r.width - 6) * ratio) + 'px';
    api.splitResize(ratio);
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); api.splitResizeEnd(); };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
});

// ---------- overlays ----------
let openOverlay = null;
function showOverlay(id) { closeOverlay(); openOverlay = id; $(id).classList.remove('hidden'); api.overlay(true); }
function closeOverlay() { if (!openOverlay) return; $(openOverlay).classList.add('hidden'); openOverlay = null; api.overlay(false); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openOverlay) { e.preventDefault(); closeOverlay(); } });
document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('mousedown', (e) => { if (e.target === o) closeOverlay(); }));

// Palette Ctrl+K
const pInput = $('palette-input'), pRes = $('palette-results');
let pItems = [], pSel = 0;
let pNavigated = false; // l'utilisateur a-t-il choisi un résultat aux flèches ?
let pFolder = null;     // id du dossier de favoris ouvert dans la palette (vue dossier)
function openPalette() { showOverlay('palette'); pInput.value = ''; pNavigated = false; pFolder = null; pInput.focus(); runSearch(); }
$('palette-btn').onclick = openPalette;
function openFolderView(id) { pFolder = id; pInput.value = ''; pNavigated = false; pInput.focus(); runSearch(); }
// Ouvre directement la palette sur la vue d'un dossier (depuis la sidebar).
function openFolderInPalette(id) { showOverlay('palette'); pInput.value = ''; pNavigated = false; pFolder = id; pInput.focus(); runSearch(); }
// Vue d'un dossier de favoris : son contenu, avec un fil d'ariane et un retour.
function renderFolder() {
  const f = favFindC(pFolder);
  if (!f || f.node.type !== 'folder') { pFolder = null; return runSearch(); }
  pItems = []; pRes.innerHTML = '';
  const back = el('div', 'res-back'); back.appendChild(icon('i-back'));
  const bi = el('span', 'res-back-ico'); bi.appendChild(icon('i-folder')); back.appendChild(bi);
  back.appendChild(el('span', 'res-back-t', f.node.title || 'Dossier'));
  back.onclick = () => { pFolder = null; pInput.value = ''; runSearch(); };
  pRes.appendChild(back);
  const q = pInput.value.trim().toLowerCase();
  const kids = (f.node.children || []).filter((n) => !q || (n.title || '').toLowerCase().includes(q) || (n.url || '').toLowerCase().includes(q));
  pRes.appendChild(el('div', 'res-section', q ? 'Dans ce dossier' : 'Contenu du dossier'));
  for (const n of kids) {
    const it = n.type === 'folder'
      ? { kind: 'favorite', type: 'folder', id: n.id, title: n.title, count: (n.children || []).length }
      : { kind: 'favorite', type: 'link', id: n.id, title: n.title, url: n.url, favicon: n.favicon };
    pItems.push(it); pRes.appendChild(resRow(it, pItems.length - 1));
  }
  if (!kids.length) pRes.appendChild(el('div', 'empty-msg', q ? 'Rien ne correspond dans ce dossier.' : 'Dossier vide.'));
  pSel = 0; markSel();
}
async function runSearch() {
  if (pFolder) return renderFolder();
  const q = pInput.value;
  const r = await api.search(q);
  if (pInput.value !== q || openOverlay !== 'palette') return;
  pItems = []; pRes.innerHTML = '';
  const section = (label, items) => {
    if (!items.length) return;
    pRes.appendChild(el('div', 'res-section', label));
    for (const it of items) { pItems.push(it); pRes.appendChild(resRow(it, pItems.length - 1)); }
  };
  section('Ouverts', r.open.filter((x) => x.kind === 'open'));
  section('Favoris', r.favorites || []);
  section('En veille', r.open.filter((x) => x.kind === 'dormant'));
  section('Archive', r.archive);
  section('Historique', r.history);
  if (q.trim() && !pItems.length) pRes.appendChild(el('div', 'empty-msg', 'Rien ici. Entrée pour chercher sur Google.'));
  pSel = 0; markSel();
}
function resRow(it, i) {
  const row = el('div', 'res'); row.dataset.i = i; row.style.setProperty('--i', Math.min(i, 12));
  const isFolder = it.kind === 'favorite' && it.type === 'folder';
  if (isFolder) { const ic = el('span', 'res-folder'); ic.appendChild(icon('i-folder')); row.appendChild(ic); }
  else { const img = el('img'); img.src = it.favicon || `https://www.google.com/s2/favicons?domain=${hostOf(it.url)}&sz=32`; img.alt = ''; row.appendChild(img); }
  const t = el('div', 't');
  t.appendChild(el('div', 'title', it.title || it.url || 'Dossier'));
  t.appendChild(el('div', 'url', isFolder ? (it.count ? it.count + (it.count > 1 ? ' éléments' : ' élément') : 'Dossier vide') : it.url));
  row.appendChild(t);
  const tag = isFolder ? 'dossier' : it.kind === 'open' ? (it.group || '') : it.kind === 'dormant' ? 'en veille' : it.kind === 'favorite' ? 'favori' : it.kind === 'archive' ? `fermé ${ago(it.closedAt)}` : `${it.count}×`;
  if (tag) row.appendChild(el('span', 'tag' + (it.kind === 'dormant' ? ' dormant' : '') + (isFolder ? ' folder' : ''), tag));
  if (isFolder) row.appendChild(icon('i-forward', 'res-chev'));
  row.onclick = (e) => choose(it, e.ctrlKey);
  row.onmousemove = () => { if (pSel !== i) { pSel = i; markSel(); } };
  return row;
}
function markSel() { pRes.querySelectorAll('.res').forEach((r) => r.classList.toggle('sel', +r.dataset.i === pSel)); const s = pRes.querySelector('.res.sel'); if (s) s.scrollIntoView({ block: 'nearest' }); }
function choose(it, newTab) {
  // Un dossier de favoris n'ouvre pas une page : il ouvre sa vue dans la palette.
  if (it && it.kind === 'favorite' && it.type === 'folder') { openFolderView(it.id); return; }
  closeOverlay();
  if (!it) { const q = pInput.value.trim(); if (q) api.openUrlNew(q); return; }
  if (it.kind === 'open' || it.kind === 'dormant') api.tabActivate(it.id);
  else if (it.kind === 'archive') api.archiveRestore(it.index);
  else if (it.kind === 'favorite') { if (newTab) api.favOpenNew(it.id); else api.favOpen(it.id); }
  else if (newTab) api.openUrlNew(it.url); else api.openUrl(it.url);
}
pInput.addEventListener('input', () => { pNavigated = false; runSearch(); });
pInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pFolder) { e.preventDefault(); e.stopPropagation(); pFolder = null; pInput.value = ''; runSearch(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); pNavigated = true; pSel = Math.min(pSel + 1, pItems.length - 1); markSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); pNavigated = true; pSel = Math.max(pSel - 1, 0); markSel(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const q = pInput.value.trim();
    // Hors vue dossier : texte tapé sans sélection aux flèches → recherche dans un NOUVEL onglet.
    if (!pFolder && q && !pNavigated) { closeOverlay(); api.openUrlNew(q); return; }
    // Sinon on active la sélection (un dossier ouvre sa vue, un lien s'ouvre en nouvel onglet).
    choose(pItems[pSel], true);
  }
});

// Archive
$('archive-btn').onclick = async () => {
  showOverlay('archive');
  const list = await api.archiveList();
  const box = $('archive-list'); box.innerHTML = '';
  if (!list.length) { box.appendChild(el('div', 'empty-msg', 'Aucune page archivée pour le moment. Les onglets fermés ou trop vieux arrivent ici.')); return; }
  let lastDay = '';
  list.forEach((a, index) => {
    const day = new Date(a.closedAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (day !== lastDay) { box.appendChild(el('div', 'day', day)); lastDay = day; }
    const row = el('div', 'res'); row.style.setProperty('--i', Math.min(index, 14));
    const img = el('img'); img.src = a.favicon || `https://www.google.com/s2/favicons?domain=${hostOf(a.url)}&sz=32`; img.alt = ''; row.appendChild(img);
    const t = el('div', 't'); t.appendChild(el('div', 'title', a.title || a.url)); t.appendChild(el('div', 'url', a.url)); row.appendChild(t);
    if (a.groupTitle) row.appendChild(el('span', 'tag', a.groupTitle));
    const rm = el('button', 'rm'); rm.title = 'Oublier définitivement'; rm.appendChild(icon('i-close'));
    rm.onclick = (e) => { e.stopPropagation(); api.archiveRemove(index); row.remove(); };
    row.appendChild(rm);
    row.onclick = () => { closeOverlay(); api.archiveRestore(index); };
    box.appendChild(row);
  });
};
$('archive-close').onclick = closeOverlay;

// Ajout d'appli
$('app-add').onclick = () => { showOverlay('addapp'); $('addapp-input').value = ''; $('addapp-input').focus(); };
$('addapp-cancel').onclick = closeOverlay;
const addApp = () => { const v = $('addapp-input').value.trim(); if (v) api.appAdd(v); closeOverlay(); };
$('addapp-ok').onclick = addApp;
$('addapp-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addApp(); });

// ---------- paramètres ----------
function openSettings(pane = 'appearance') {
  showOverlay('settings');
  selectSettingsPane(pane);
  if (pane === 'passwords') refreshPasswords();
}
function selectSettingsPane(pane) {
  document.querySelectorAll('.settings-navitem').forEach((b) => b.classList.toggle('active', b.dataset.pane === pane));
  document.querySelectorAll('.settings-pane').forEach((s) => s.classList.toggle('hidden', s.dataset.pane !== pane));
  if (pane === 'passwords') refreshPasswords();
  if (pane === 'dev') renderDevPane();
  if (pane === 'search') renderSearchPane();
  if (pane === 'favorites') renderFavPane();
  if (pane === 'privacy') { bdView = null; bdQuery = ''; renderPrivacyPane(); }
  if (pane === 'appearance') renderAppearanceZoom();
  if (pane === 'startup') renderStartupPane();
  if (pane === 'downloads') renderDownloadsPane();
  if (pane === 'languages') renderLanguagesPane();
  if (pane === 'permissions') renderPermissionsPane();
}
const ENGINE_DOMAIN = { google: 'google.com', duckduckgo: 'duckduckgo.com', bing: 'bing.com', qwant: 'qwant.com', ecosia: 'ecosia.org', brave: 'search.brave.com', startpage: 'startpage.com' };
function engFavicon(id) { const im = el('img', 'dd-fav'); im.alt = ''; im.src = `https://www.google.com/s2/favicons?domain=${ENGINE_DOMAIN[id] || 'google.com'}&sz=32`; im.onerror = () => { im.style.visibility = 'hidden'; }; return im; }
let ddOutside = null;
function closeEngineDD() { const dd = $('engine-dd'); const m = dd.querySelector('.dd-menu'); if (m) m.classList.add('hidden'); dd.classList.remove('open'); if (ddOutside) { document.removeEventListener('mousedown', ddOutside, true); ddOutside = null; } }
function renderSearchPane() {
  const dd = $('engine-dd');
  const engines = (state && state.searchEngines) || [];
  const curId = (state && state.searchEngine) || 'google';
  const cur = engines.find((e) => e.id === curId) || engines[0] || { name: 'Google' };
  dd.innerHTML = '';
  const btn = el('button', 'dd-button');
  btn.appendChild(engFavicon(curId));
  btn.appendChild(el('span', 'dd-label', cur.name));
  btn.appendChild(icon('i-forward', 'dd-chev'));
  dd.appendChild(btn);
  const menu = el('div', 'dd-menu hidden');
  engines.forEach((e) => {
    const o = el('div', 'dd-option' + (e.id === curId ? ' sel' : ''));
    o.appendChild(engFavicon(e.id));
    o.appendChild(el('span', 'dd-name', e.name));
    if (e.id === curId) { const chk = icon('i-check', 'dd-check'); o.appendChild(chk); }
    o.onmousedown = (ev) => { ev.preventDefault(); api.setSearchEngine(e.id); closeEngineDD(); };
    menu.appendChild(o);
  });
  dd.appendChild(menu);
  btn.onclick = (ev) => {
    ev.stopPropagation();
    const willOpen = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !willOpen);
    dd.classList.toggle('open', willOpen);
    if (willOpen) { ddOutside = (e2) => { if (!dd.contains(e2.target)) closeEngineDD(); }; setTimeout(() => document.addEventListener('mousedown', ddOutside, true), 0); }
    else closeEngineDD();
  };
}
// ---------- gestion des favoris (panneau paramètres) ----------
// Repli local au gestionnaire : par défaut tout est déplié (« affichage complet »),
// indépendant de l'état replié de la sidebar.
let favMgrCollapsed = new Set();
let favMgrQuery = '';

function renderFavPane() {
  if (dnd && dnd.kind === 'favmgr') return; // ne pas reconstruire pendant un glisser
  const box = $('fav-manager');
  const favs = state.favorites || [];
  box.innerHTML = '';
  if (!favs.length) {
    box.appendChild(el('div', 'favm-empty', 'Aucun favori pour l’instant. Ajoute une page avec l’étoile de la barre d’adresse.'));
    return;
  }
  const q = favMgrQuery.trim().toLowerCase();
  if (q) { renderFavSearch(favs, box, q); return; }
  renderFavMgrNodes(favs, box, 0, null);
}
function renderFavMgrNodes(nodes, box, depth, parentId) {
  nodes.forEach((n, index) => {
    box.appendChild(favMgrRow(n, depth, parentId, index));
    if (n.type === 'folder' && n.children && !favMgrCollapsed.has(n.id)) renderFavMgrNodes(n.children, box, depth + 1, n.id);
  });
}
function favMgrRow(n, depth, parentId, index) {
  const isFolder = n.type === 'folder';
  const collapsed = isFolder && favMgrCollapsed.has(n.id);
  const row = el('div', 'favm-row' + (isFolder ? ' folder' : '') + (isFolder && !collapsed ? ' open' : ''));
  row.dataset.id = n.id; row.dataset.parent = parentId || ''; row.dataset.index = index; row.dataset.depth = depth; row.dataset.type = n.type;
  row.style.paddingLeft = (12 + depth * 20) + 'px';
  if (isFolder) row.appendChild(icon('i-forward', 'favm-chev'));
  else row.appendChild(el('span', 'favm-chev spacer'));
  if (isFolder) { const ic = el('span', 'favm-ico'); ic.appendChild(icon('i-folder')); row.appendChild(ic); }
  else { const img = el('img', 'favm-ico'); img.alt = ''; img.src = n.favicon || `https://www.google.com/s2/favicons?domain=${hostOf(n.url)}&sz=32`; img.onerror = () => { img.style.visibility = 'hidden'; }; row.appendChild(img); }
  const main = el('div', 'favm-main');
  if (renamingFav === n.id && renamingFavCtx === 'panel') {
    const inp = el('input', 'favm-input'); inp.value = n.title || '';
    let done = false;
    const finish = (save) => { if (done) return; done = true; renamingFav = null; renamingFavCtx = null; if (save) api.favRename({ id: n.id, title: inp.value }); else renderFavPane(); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
    inp.onmousedown = (e) => e.stopPropagation();
    main.appendChild(inp);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  } else {
    main.appendChild(el('div', 'favm-title', n.title || (isFolder ? 'Dossier' : hostOf(n.url) || n.url)));
    const count = (n.children || []).length;
    main.appendChild(el('div', 'favm-sub', isFolder ? (count ? count + (count > 1 ? ' éléments' : ' élément') : 'vide') : n.url));
  }
  row.appendChild(main);
  const acts = el('div', 'favm-actions');
  if (isFolder) { const openall = actBtn('i-plus', 'Tout ouvrir'); openall.onclick = (e) => { e.stopPropagation(); api.favOpenAll(n.id); }; acts.appendChild(openall); }
  else { const open = actBtn('i-plus', 'Ouvrir dans un nouvel onglet'); open.onclick = (e) => { e.stopPropagation(); api.favOpenNew(n.id); }; acts.appendChild(open); }
  const ren = actBtn('i-edit', 'Renommer'); ren.onclick = (e) => { e.stopPropagation(); renamingFav = n.id; renamingFavCtx = 'panel'; renderFavPane(); }; acts.appendChild(ren);
  const del = actBtn('i-trash', isFolder ? 'Supprimer le dossier et son contenu' : 'Retirer des favoris'); del.classList.add('danger'); del.onclick = (e) => { e.stopPropagation(); api.favRemove(n.id); }; acts.appendChild(del);
  row.appendChild(acts);
  row.title = isFolder ? (n.title || 'Dossier') : n.url;
  row.onclick = () => { if (suppressClick || renamingFav === n.id) return; if (isFolder) { if (favMgrCollapsed.has(n.id)) favMgrCollapsed.delete(n.id); else favMgrCollapsed.add(n.id); renderFavPane(); } else api.favOpen(n.id); };
  row.oncontextmenu = (e) => { e.preventDefault(); api.favContext(n.id); };
  row.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('.favm-actions') && !e.target.closest('.favm-input') && renamingFav !== n.id) beginFavMgrDrag(e, n.id); });
  return row;
}
function actBtn(ic, title) { const b = el('button', 'favm-act'); b.title = title; b.appendChild(icon(ic)); return b; }

// Recherche : liste plate des liens correspondants, avec le chemin de leur dossier.
function renderFavSearch(favs, box, q) {
  const hits = [];
  (function walk(nodes, chain) {
    for (const n of nodes) {
      if (n.type === 'folder') { if (n.children) walk(n.children, chain.concat(n.title || 'Dossier')); }
      else if ((n.title || '').toLowerCase().includes(q) || (n.url || '').toLowerCase().includes(q)) hits.push({ n, path: chain });
    }
  })(favs, []);
  if (!hits.length) { box.appendChild(el('div', 'favm-empty', 'Aucun favori ne correspond à « ' + favMgrQuery.trim() + ' ».')); return; }
  for (const { n, path } of hits) {
    const row = el('div', 'favm-row link result');
    row.appendChild(el('span', 'favm-chev spacer'));
    const img = el('img', 'favm-ico'); img.alt = ''; img.src = n.favicon || `https://www.google.com/s2/favicons?domain=${hostOf(n.url)}&sz=32`; img.onerror = () => { img.style.visibility = 'hidden'; }; row.appendChild(img);
    const main = el('div', 'favm-main');
    main.appendChild(el('div', 'favm-title', n.title || hostOf(n.url) || n.url));
    const sub = el('div', 'favm-sub');
    if (path.length) { const badge = el('span', 'favm-path'); badge.appendChild(icon('i-folder')); badge.appendChild(el('span', null, path.join(' / '))); sub.appendChild(badge); }
    sub.appendChild(el('span', 'favm-url', n.url)); main.appendChild(sub);
    row.appendChild(main);
    const acts = el('div', 'favm-actions');
    const open = actBtn('i-plus', 'Ouvrir dans un nouvel onglet'); open.onclick = (e) => { e.stopPropagation(); api.favOpenNew(n.id); }; acts.appendChild(open);
    const del = actBtn('i-trash', 'Retirer des favoris'); del.classList.add('danger'); del.onclick = (e) => { e.stopPropagation(); api.favRemove(n.id); }; acts.appendChild(del);
    row.appendChild(acts);
    row.title = n.url;
    row.onclick = () => { if (suppressClick) return; api.favOpen(n.id); };
    box.appendChild(row);
  }
}

// Glisser-déposer dans le gestionnaire (réutilise api.favMove).
function favMgrLine() { let l = $('favm-line'); if (!l) { l = el('div'); l.id = 'favm-line'; $('fav-manager').appendChild(l); } return l; }
function clearFavMgrHints() { $('fav-manager').querySelectorAll('.favm-into').forEach((e) => e.classList.remove('favm-into')); const l = $('favm-line'); if (l) l.style.display = 'none'; }
function beginFavMgrDrag(startEvent, id) {
  const srcRow = startEvent.currentTarget;
  let plan = null;
  runDrag(startEvent, srcRow, {
    kind: 'favmgr',
    onStart: () => { dnd.favId = id; dnd.subtree = favSubtreeIds(id); },
    onMove: (ev) => { plan = favMgrPlan(ev); paintFavMgrPlan(plan); },
    onDrop: () => { clearFavMgrHints(); if (plan) api.favMove({ id, targetParentId: plan.targetParentId, beforeId: plan.beforeId }); },
  });
}
function favMgrPlan(ev) {
  const box = $('fav-manager');
  const rows = [...box.querySelectorAll('.favm-row')].filter((r) => !dnd.subtree.has(r.dataset.id));
  const y = ev.clientY;
  let hover = null, band = 0;
  for (const r of rows) { const b = r.getBoundingClientRect(); if (y >= b.top && y <= b.bottom) { hover = r; band = (y - b.top) / b.height; break; } }
  if (!hover) {
    const last = rows[rows.length - 1];
    const yPix = last ? last.getBoundingClientRect().bottom : box.getBoundingClientRect().top + 4;
    return { targetParentId: null, beforeId: null, mode: 'reorder', depth: 0, yPix };
  }
  const hid = hover.dataset.id;
  const isFolder = hover.dataset.type === 'folder';
  const open = hover.classList.contains('open');
  const f = favFindC(hid);
  const hasChildren = !!(f && f.node.children && f.node.children.length);
  const rect = hover.getBoundingClientRect();
  if (isFolder && band > 0.3 && band < 0.7) return { mode: 'into', into: hid, targetParentId: hid, beforeId: null };
  const before = band < 0.5;
  if (!before && isFolder && open && hasChildren) {
    const first = f.node.children[0];
    return { mode: 'into', into: hid, targetParentId: hid, beforeId: first.id, yPix: rect.bottom, depth: +hover.dataset.depth + 1 };
  }
  const parentId = hover.dataset.parent || null;
  const beforeId = before ? hid : (f.list[f.index + 1] ? f.list[f.index + 1].id : null);
  return { mode: 'reorder', targetParentId: parentId, beforeId, depth: +hover.dataset.depth, yPix: before ? rect.top : rect.bottom };
}
function paintFavMgrPlan(plan) {
  clearFavMgrHints();
  const box = $('fav-manager'), br = box.getBoundingClientRect();
  if (plan.mode === 'into') {
    const el0 = [...box.querySelectorAll('.favm-row')].find((r) => r.dataset.id === plan.into);
    if (el0) el0.classList.add('favm-into');
    if (plan.yPix == null) return;
  }
  const l = favMgrLine(); l.style.display = 'block';
  l.style.left = (12 + (plan.depth || 0) * 20) + 'px';
  l.style.top = (plan.yPix - br.top + box.scrollTop) + 'px';
}
// Boutons du panneau favoris
$('favm-newfolder').onclick = () => api.favFolder({});
$('favm-search').addEventListener('input', (e) => { favMgrQuery = e.target.value; renderFavPane(); });
$('favm-expand').onclick = () => { favMgrCollapsed.clear(); renderFavPane(); };
$('favm-collapse').onclick = () => { favWalkAll((n) => { if (n.type === 'folder') favMgrCollapsed.add(n.id); }); renderFavPane(); };
function favWalkAll(fn, nodes = (state && state.favorites) || []) { for (const n of nodes) { fn(n); if (n.children) favWalkAll(fn, n.children); } }

// ---------- données de navigation (paramètres) : navigateur à deux niveaux ----------
const plural = (n, s, p) => n + ' ' + (n > 1 ? (p || s + 's') : s);
function fmtBytes(b) { b = +b || 0; if (b < 1024) return b + ' o'; const u = ['Ko', 'Mo', 'Go', 'To']; let i = -1; do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1); return (b < 10 ? b.toFixed(1) : Math.round(b)) + ' ' + u[i]; }
const PERM_LABELS = {
  notifications: 'Notifications', geolocation: 'Localisation', media: 'Caméra et micro',
  'display-capture': 'Partage d’écran', midi: 'MIDI', midiSysex: 'MIDI (SysEx)',
  pointerLock: 'Verrouillage du curseur', fullscreen: 'Plein écran', openExternal: 'Ouvrir une app externe',
  'clipboard-read': 'Lecture du presse-papiers', 'clipboard-sanitized-write': 'Écriture du presse-papiers',
  'persistent-storage': 'Stockage persistant', 'background-sync': 'Synchro en arrière-plan',
  'idle-detection': 'Détection d’inactivité', 'window-management': 'Gestion des fenêtres', hid: 'Périphériques HID',
  serial: 'Port série', usb: 'Périphériques USB', bluetooth: 'Bluetooth',
};
const permLabel = (p) => PERM_LABELS[p] || (p || 'Autorisation');
const BD_CATS = [
  { key: 'history', name: 'Historique de navigation', icon: 'i-globe' },
  { key: 'cookies', name: 'Cookies et données de sites', icon: 'i-lock' },
  { key: 'cache', name: 'Images et fichiers en cache', icon: 'i-download' },
  { key: 'archive', name: 'Onglets archivés', icon: 'i-archive' },
  { key: 'perms', name: 'Autorisations de sites', icon: 'i-shield' },
  { key: 'downloads', name: 'Liste des téléchargements', icon: 'i-download' },
];
let bdView = null;   // null = liste des catégories ; sinon clé de catégorie
let bdQuery = '';
let bdStats = {}, bdCookieCount = 0, bdCacheBytes = 0;

async function renderPrivacyPane() {
  if (!bdView) return renderBdCategories();
  return renderBdDetail(bdView);
}

async function renderBdCategories() {
  const box = $('bd-list'); box.innerHTML = '';
  bdStats = await api.browsingDataStats().catch(() => ({})) || {};
  try { bdCookieCount = (await api.cookiesList()).length; } catch { bdCookieCount = 0; }
  try { bdCacheBytes = await api.cacheSize(); } catch { bdCacheBytes = 0; }
  const descOf = (k) => {
    if (k === 'history') return bdStats.history ? plural(bdStats.history, 'site visité', 'sites visités') : 'Aucun site';
    if (k === 'cookies') return bdCookieCount ? plural(bdCookieCount, 'site') : 'Aucun site';
    if (k === 'cache') return bdCacheBytes ? fmtBytes(bdCacheBytes) : 'Vide';
    if (k === 'archive') return bdStats.archive ? plural(bdStats.archive, 'page fermée', 'pages fermées') : 'Aucune page';
    if (k === 'perms') return bdStats.perms ? plural(bdStats.perms, 'décision mémorisée', 'décisions mémorisées') : 'Aucune autorisation';
    if (k === 'downloads') return bdStats.downloads ? plural(bdStats.downloads, 'entrée', 'entrées') : 'Aucune entrée';
    return '';
  };
  BD_CATS.forEach((c) => {
    const row = el('div', 'bd-row');
    const ic = el('span', 'bd-ico'); ic.appendChild(icon(c.icon)); row.appendChild(ic);
    const main = el('div', 'bd-main');
    main.appendChild(el('div', 'bd-name', c.name));
    main.appendChild(el('div', 'bd-desc', descOf(c.key)));
    row.appendChild(main);
    row.appendChild(icon('i-forward', 'bd-chev'));
    row.onclick = () => { bdView = c.key; bdQuery = ''; renderPrivacyPane(); };
    box.appendChild(row);
  });
}

function bdActBtn(ic, title, fn, danger) {
  const b = el('button', 'bd-act' + (danger ? ' danger' : '')); b.title = title; b.appendChild(icon(ic));
  b.onclick = (e) => { e.stopPropagation(); fn(); };
  return b;
}
function bdItemRow({ icoDomain, icoSvg, title, sub, meta, actions }) {
  const row = el('div', 'bd-item');
  if (icoDomain) { const img = el('img', 'bd-item-ico'); img.alt = ''; img.src = `https://www.google.com/s2/favicons?domain=${icoDomain}&sz=32`; img.onerror = () => { img.style.visibility = 'hidden'; }; row.appendChild(img); }
  else { const s = el('span', 'bd-item-ico svg'); s.appendChild(icon(icoSvg || 'i-globe')); row.appendChild(s); }
  const main = el('div', 'bd-item-main');
  main.appendChild(el('div', 'bd-item-title', title || ''));
  if (sub) main.appendChild(el('div', 'bd-item-sub', sub));
  row.appendChild(main);
  if (meta) row.appendChild(el('span', 'bd-item-meta', meta));
  const acts = el('div', 'bd-item-acts'); (actions || []).forEach((a) => acts.appendChild(a)); row.appendChild(acts);
  return row;
}

async function renderBdDetail(key) {
  const cat = BD_CATS.find((c) => c.key === key);
  const box = $('bd-list'); box.innerHTML = '';
  const head = el('div', 'bd-dhead');
  const back = el('button', 'bd-back'); back.appendChild(icon('i-back')); back.appendChild(el('span', null, 'Catégories'));
  back.onclick = () => { bdView = null; bdQuery = ''; renderPrivacyPane(); };
  head.appendChild(back);
  const title = el('div', 'bd-dtitle'); title.appendChild(icon(cat.icon)); title.appendChild(el('span', null, cat.name)); head.appendChild(title);
  const clearAll = el('button', 'btn danger sm'); clearAll.appendChild(icon('i-trash')); clearAll.appendChild(el('span', null, 'Tout effacer'));
  head.appendChild(clearAll);
  box.appendChild(head);

  if (key === 'cache') {
    const card = el('div', 'bd-cache');
    card.appendChild(el('div', 'bd-cache-size', bdCacheBytes ? fmtBytes(bdCacheBytes) : 'Vide'));
    card.appendChild(el('div', 'bd-cache-desc muted', 'Images et fichiers mis en cache pour accélérer le rechargement des sites. Les vider libère de l’espace ; aucun site ne vous déconnecte.'));
    box.appendChild(card);
    clearAll.onclick = async () => { clearAll.disabled = true; try { bdCacheBytes = await api.cacheClear(); } catch {} renderPrivacyPane(); };
    return;
  }

  const sw = el('div', 'bd-search'); sw.appendChild(icon('i-search'));
  const inp = el('input'); inp.type = 'text'; inp.placeholder = 'Filtrer…'; inp.spellcheck = false; inp.autocomplete = 'off'; inp.value = bdQuery;
  sw.appendChild(inp); box.appendChild(sw);
  const listEl = el('div', 'bd-items'); box.appendChild(listEl);
  const empty = el('div', 'favm-empty', 'Rien à afficher ici.');

  const rows = [];
  const add = (rowEl, text) => { rows.push({ row: rowEl, text: (text || '').toLowerCase() }); listEl.appendChild(rowEl); };
  const applyFilter = () => { const q = bdQuery.trim().toLowerCase(); let any = false; rows.forEach((r) => { const show = !q || r.text.includes(q); r.row.style.display = show ? '' : 'none'; if (show) any = true; }); empty.style.display = any ? 'none' : ''; };
  inp.oninput = () => { bdQuery = inp.value; applyFilter(); };

  const reopen = () => { renderPrivacyPane(); };

  if (key === 'history') {
    const items = await api.historyList().catch(() => []);
    items.forEach((it) => {
      const row = bdItemRow({ icoDomain: hostOf(it.url), title: it.title || hostOf(it.url) || it.url, sub: it.url, meta: it.last ? ago(it.last) : '',
        actions: [
          bdActBtn('i-plus', 'Ouvrir dans un nouvel onglet', () => { closeOverlay(); api.openUrlNew(it.url); }),
          bdActBtn('i-trash', 'Supprimer de l’historique', () => { api.historyRemove(it.key); row.remove(); }, true),
        ] });
      add(row, (it.title || '') + ' ' + it.url);
    });
    clearAll.onclick = async () => { await api.clearBrowsingData({ history: true }); reopen(); };
  } else if (key === 'cookies') {
    const items = await api.cookiesList().catch(() => []);
    items.forEach((it) => {
      const row = bdItemRow({ icoDomain: it.domain, title: it.domain, sub: plural(it.count, 'cookie'),
        actions: [bdActBtn('i-trash', 'Supprimer les cookies de ce site', () => { api.cookiesRemove(it.domain); row.remove(); }, true)] });
      add(row, it.domain);
    });
    clearAll.onclick = async () => { await api.clearBrowsingData({ cookies: true }); reopen(); };
  } else if (key === 'perms') {
    const items = await api.permsList().catch(() => []);
    items.forEach((it) => {
      const row = bdItemRow({ icoDomain: hostOf(it.origin) || it.origin, title: it.origin, sub: permLabel(it.permission) + ' · ' + (it.allowed ? 'Autorisé' : 'Bloqué'),
        actions: [bdActBtn('i-trash', 'Oublier cette décision', () => { api.permsRemove(it.key); row.remove(); }, true)] });
      add(row, it.origin + ' ' + it.permission);
    });
    clearAll.onclick = async () => { await api.clearBrowsingData({ perms: true }); reopen(); };
  } else if (key === 'archive') {
    const items = await api.archiveList().catch(() => []);
    items.forEach((it, i) => {
      const row = bdItemRow({ icoDomain: hostOf(it.url), title: it.title || hostOf(it.url) || it.url, sub: it.url, meta: it.closedAt ? ago(it.closedAt) : '',
        actions: [
          bdActBtn('i-reload', 'Rouvrir', () => { closeOverlay(); api.archiveRestore(i); }),
          bdActBtn('i-trash', 'Supprimer de l’archive', () => { api.archiveRemove(i); reopen(); }, true),
        ] });
      add(row, (it.title || '') + ' ' + it.url);
    });
    clearAll.onclick = async () => { await api.clearBrowsingData({ archive: true }); reopen(); };
  } else if (key === 'downloads') {
    const items = await api.dlList().catch(() => []);
    items.forEach((it) => {
      const done = it.state === 'completed';
      const row = bdItemRow({ icoSvg: 'i-download', title: it.filename || 'Téléchargement', sub: done ? fmtBytes(it.received || it.total) : (it.state || ''),
        actions: [
          done ? bdActBtn('i-plus', 'Ouvrir le fichier', () => api.dlOpen(it.id)) : null,
          bdActBtn('i-trash', 'Retirer de la liste', () => { api.dlRemove(it.id); row.remove(); }, true),
        ].filter(Boolean) });
      add(row, it.filename || '');
    });
    clearAll.onclick = async () => { await api.clearBrowsingData({ downloads: true }); reopen(); };
  }

  listEl.appendChild(empty);
  applyFilter();
}

// ---------- réglages généraux (démarrage, téléchargements, zoom, langues, autorisations) ----------
let cfg = null;
// Petit menu déroulant réutilisable (étiquettes seules), au style de NaX.
function makeSelect(container, value, options, onChange) {
  container.innerHTML = '';
  const cur = options.find((o) => o.value === value) || options[0] || { label: '' };
  const btn = el('button', 'dd-button');
  btn.appendChild(el('span', 'dd-label', cur.label));
  btn.appendChild(icon('i-forward', 'dd-chev'));
  container.appendChild(btn);
  const menu = el('div', 'dd-menu hidden');
  let outside = null;
  const close = () => { menu.classList.add('hidden'); container.classList.remove('open'); if (outside) { document.removeEventListener('mousedown', outside, true); outside = null; } };
  options.forEach((o) => {
    const it = el('div', 'dd-option' + (o.value === value ? ' sel' : ''));
    it.appendChild(el('span', 'dd-name', o.label));
    if (o.value === value) it.appendChild(icon('i-check', 'dd-check'));
    it.onmousedown = (e) => { e.preventDefault(); close(); onChange(o.value); };
    menu.appendChild(it);
  });
  container.appendChild(menu);
  btn.onclick = (e) => {
    e.stopPropagation();
    const willOpen = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !willOpen); container.classList.toggle('open', willOpen);
    if (willOpen) { outside = (e2) => { if (!container.contains(e2.target)) close(); }; setTimeout(() => document.addEventListener('mousedown', outside, true), 0); }
    else close();
  };
}

// Apparence : zoom par défaut + zoom mémorisé par site
const ZOOM_OPTS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200].map((z) => ({ value: z, label: z + ' %' }));
async function renderAppearanceZoom() {
  cfg = await api.settingsGet().catch(() => ({})) || {};
  makeSelect($('zoom-dd'), Math.round((cfg.defaultZoom || 1) * 100), ZOOM_OPTS, async (v) => { await api.settingsSet({ defaultZoom: v / 100 }); renderAppearanceZoom(); });
  const box = $('zoom-sites'); box.innerHTML = '';
  const sites = await api.zoomList().catch(() => []);
  if (!sites.length) return;
  const head = el('div', 'zoom-head');
  head.appendChild(el('span', 'zoom-head-t', 'Zoom mémorisé par site'));
  const resetAll = el('button', 'linklike', 'Tout réinitialiser'); resetAll.onclick = async () => { await api.zoomResetAll(); renderAppearanceZoom(); };
  head.appendChild(resetAll); box.appendChild(head);
  sites.forEach((s) => {
    const row = el('div', 'zoom-row');
    const img = el('img', 'zoom-fav'); img.alt = ''; img.src = `https://www.google.com/s2/favicons?domain=${s.host}&sz=32`; img.onerror = () => { img.style.visibility = 'hidden'; }; row.appendChild(img);
    row.appendChild(el('span', 'zoom-host', s.host));
    row.appendChild(el('span', 'zoom-pct', Math.round(s.factor * 100) + ' %'));
    const x = el('button', 'bd-act danger'); x.title = 'Réinitialiser ce site'; x.appendChild(icon('i-close'));
    x.onclick = async () => { await api.zoomReset(s.host); renderAppearanceZoom(); };
    row.appendChild(x); box.appendChild(row);
  });
}

// Au démarrage
async function renderStartupPane() {
  cfg = await api.settingsGet().catch(() => ({})) || {};
  makeSelect($('startup-dd'), cfg.startupMode || 'restore', [
    { value: 'restore', label: 'Reprendre mes onglets' },
    { value: 'home', label: 'Ouvrir la page d’accueil' },
  ], async (v) => { await api.settingsSet({ startupMode: v }); cfg.startupMode = v; });
  $('homepage-input').value = cfg.homepage || '';
  const ntVal = cfg.newTabUrl === '' || cfg.newTabUrl == null ? 'home' : cfg.newTabUrl === 'blank' ? 'blank' : 'custom';
  makeSelect($('newtab-dd'), ntVal, [
    { value: 'home', label: 'Page d’accueil' },
    { value: 'blank', label: 'Page vierge' },
    { value: 'custom', label: 'Adresse personnalisée' },
  ], async (v) => {
    if (v === 'home') await api.settingsSet({ newTabUrl: '' });
    else if (v === 'blank') await api.settingsSet({ newTabUrl: 'blank' });
    else await api.settingsSet({ newTabUrl: ($('newtab-input').value.trim() || 'about:blank') });
    renderStartupPane();
  });
  const isCustom = ntVal === 'custom';
  $('newtab-url-row').style.display = isCustom ? '' : 'none';
  $('newtab-input').value = isCustom ? (cfg.newTabUrl || '') : '';
}
$('homepage-input').addEventListener('change', async (e) => { await api.settingsSet({ homepage: e.target.value }); });
$('newtab-input').addEventListener('change', async (e) => { await api.settingsSet({ newTabUrl: e.target.value.trim() || 'about:blank' }); });

// Téléchargements
async function renderDownloadsPane() {
  cfg = await api.settingsGet().catch(() => ({})) || {};
  const custom = !!cfg.downloadDir;
  setText($('dl-dir-path'), (cfg.downloadDir || cfg.downloadDirDefault || '') + (custom ? '' : ' (par défaut)'));
  $('dl-ask').checked = !!cfg.askDownloadPath;
}
$('dl-dir-btn').onclick = async () => { const r = await api.pickDownloadDir(); if (r) setText($('dl-dir-path'), r.dir || r.default); };
$('dl-ask').onchange = async (e) => { await api.settingsSet({ askDownloadPath: e.target.checked }); };

// Langues
const LANG_OPTIONS = [
  { code: 'fr', name: 'Français' }, { code: 'en-US', name: 'Anglais (US)' }, { code: 'en-GB', name: 'Anglais (UK)' },
  { code: 'es-ES', name: 'Espagnol' }, { code: 'de-DE', name: 'Allemand' }, { code: 'it-IT', name: 'Italien' },
  { code: 'pt-BR', name: 'Portugais (Brésil)' }, { code: 'nl-NL', name: 'Néerlandais' }, { code: 'pl-PL', name: 'Polonais' }, { code: 'ru', name: 'Russe' },
];
async function renderLanguagesPane() {
  cfg = await api.settingsGet().catch(() => ({})) || {};
  $('spell-toggle').checked = !!cfg.spellcheckOn;
  const sel = new Set(cfg.spellLangs || ['fr']);
  const avail = new Set(cfg.availLangs || []);
  const box = $('lang-list'); box.innerHTML = '';
  LANG_OPTIONS.forEach((l) => {
    const row = el('div', 'lang-row' + (sel.has(l.code) ? ' on' : ''));
    const chk = el('span', 'bd-check'); chk.appendChild(icon('i-check')); row.appendChild(chk);
    row.appendChild(el('span', 'lang-name', l.name));
    if (!avail.has(l.code)) row.appendChild(el('span', 'lang-note', 'correcteur indispo'));
    row.onclick = async () => {
      if (sel.has(l.code)) { if (sel.size <= 1) return; sel.delete(l.code); } else sel.add(l.code);
      row.classList.toggle('on', sel.has(l.code));
      await api.settingsSet({ spellLangs: [...sel] });
    };
    box.appendChild(row);
  });
}
$('spell-toggle').onchange = async (e) => { await api.settingsSet({ spellcheckOn: e.target.checked }); };

// Autorisations des sites (politique par défaut)
const PERM_ROWS = [
  { key: 'notifications', name: 'Notifications', desc: 'Bannières et alertes envoyées par les sites.', opts: [['ask', 'Demander'], ['block', 'Bloquer']] },
  { key: 'geolocation', name: 'Localisation', desc: 'Accès à votre position géographique.', opts: [['ask', 'Demander'], ['block', 'Bloquer']] },
  { key: 'media', name: 'Caméra et micro', desc: 'Accès à la caméra et au microphone.', opts: [['ask', 'Demander'], ['block', 'Bloquer']] },
  { key: 'popups', name: 'Pop-ups et redirections', desc: 'Fenêtres ouvertes automatiquement par les sites.', opts: [['allow', 'Autoriser'], ['block', 'Bloquer']] },
];
async function renderPermissionsPane() {
  cfg = await api.settingsGet().catch(() => ({})) || {};
  const perm = cfg.perm || {};
  const box = $('perm-list'); box.innerHTML = '';
  PERM_ROWS.forEach((p) => {
    const row = el('div', 'setting-row');
    const label = el('div', 'setting-label'); label.appendChild(el('div', 'setting-name', p.name)); label.appendChild(el('div', 'setting-desc muted', p.desc)); row.appendChild(label);
    const dd = el('div', 'dropdown'); row.appendChild(dd); box.appendChild(row);
    makeSelect(dd, perm[p.key] || p.opts[0][0], p.opts.map(([v, l]) => ({ value: v, label: l })), async (v) => { const patch = { perm: {} }; patch.perm[p.key] = v; await api.settingsSet(patch); });
  });
}

document.querySelectorAll('.settings-navitem').forEach((b) => { b.onclick = () => selectSettingsPane(b.dataset.pane); });
$('settings-btn').onclick = () => openSettings();
$('settings-row').onclick = () => openSettings();
$('settings-close').onclick = closeOverlay;
// Thème : renvoie le choix au process principal, qui pilote nativeTheme (donc le CSS bascule).
document.querySelectorAll('#theme-seg .seg').forEach((b) => { b.onclick = () => api.setTheme(b.dataset.theme); });
function reflectTheme() {
  const th = (state && state.theme) || 'dark';
  document.querySelectorAll('#theme-seg .seg').forEach((b) => b.classList.toggle('active', b.dataset.theme === th));
}
// Mode développeur
$('dev-toggle').onchange = (e) => api.setDevMode(e.target.checked);
function renderDevPane() {
  $('dev-toggle').checked = !!(state && state.devMode);
  const box = $('dev-list'); box.innerHTML = '';
  if (!state.devMode) return;
  const projs = state.devProjects || [];
  if (!projs.length) { box.appendChild(el('div', 'dev-empty', 'Aucun serveur de dev détecté pour l’instant. Lance un projet (npm run dev…) et il apparaîtra ici et dans le rail.')); return; }
  for (const p of projs) {
    const row = el('div', 'dev-item');
    row.appendChild(el('span', 'dot'));
    const who = el('div', 'who'); who.appendChild(el('div', 't', p.title)); who.appendChild(el('div', 'u', p.url)); row.appendChild(who);
    const b = el('button', 'open', 'Ouvrir'); b.onclick = () => { closeOverlay(); api.devOpen(p.url); }; row.appendChild(b);
    box.appendChild(row);
  }
}

// ---------- mots de passe ----------
const pwBody = $('pw-body'), pwSearch = $('pw-search');
let pwItems = [];
async function refreshPasswords() {
  pwItems = await api.pwList();
  $('pw-search-wrap').classList.toggle('hidden', pwItems.length === 0);
  renderPasswords();
}
function renderPasswords() {
  const q = pwSearch.value.trim().toLowerCase();
  const list = pwItems.filter((p) => !q || (p.name || '').toLowerCase().includes(q) || (p.url || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q));
  pwBody.innerHTML = '';
  if (!pwItems.length) {
    const e = el('div', 'pw-empty');
    const big = el('div', 'big'); big.appendChild(icon('i-key')); e.appendChild(big);
    e.appendChild(el('div', null, 'Aucun mot de passe pour l’instant.'));
    const b = el('button', 'btn'); b.appendChild(icon('i-download')); b.appendChild(el('span', null, 'Importer depuis Chrome'));
    b.onclick = () => showOverlay('pw-guide'); e.appendChild(b);
    pwBody.appendChild(e); return;
  }
  if (!list.length) { pwBody.appendChild(el('div', 'empty-msg', 'Aucun résultat.')); return; }
  list.forEach((p, i) => {
    const row = el('div', 'pw-row'); row.style.setProperty('--i', Math.min(i, 16));
    const img = el('img'); img.alt = ''; img.src = `https://www.google.com/s2/favicons?domain=${hostOf(p.url)}&sz=32`;
    img.onerror = () => { img.style.visibility = 'hidden'; };
    row.appendChild(img);
    const who = el('div', 'who');
    who.appendChild(el('div', 'site', p.name || hostOf(p.url) || p.url));
    who.appendChild(el('div', 'user', p.username || '—'));
    row.appendChild(who);
    const secret = el('div', 'secret hidden-dots', '•'.repeat(Math.min(p.len || 8, 12)));
    row.appendChild(secret);
    const acts = el('div', 'acts');
    const eye = el('button', 'pw-act'); eye.title = 'Afficher'; eye.appendChild(icon('i-eye'));
    let shown = false;
    eye.onclick = async () => {
      shown = !shown;
      if (shown) { const val = await api.pwReveal(p.id); secret.textContent = val || ''; secret.classList.remove('hidden-dots'); eye.querySelector('use').setAttribute('href', '#i-eye-off'); }
      else { secret.textContent = '•'.repeat(Math.min(p.len || 8, 12)); secret.classList.add('hidden-dots'); eye.querySelector('use').setAttribute('href', '#i-eye'); }
    };
    const copy = el('button', 'pw-act'); copy.title = 'Copier'; copy.appendChild(icon('i-copy'));
    copy.onclick = () => { api.pwCopy(p.id); copy.classList.add('copied'); copy.querySelector('use').setAttribute('href', '#i-check'); toast('Mot de passe copié, effacé du presse-papiers dans 30 s'); setTimeout(() => { copy.classList.remove('copied'); copy.querySelector('use').setAttribute('href', '#i-copy'); }, 1400); };
    const go = el('button', 'pw-act'); go.title = 'Ouvrir le site'; go.appendChild(icon('i-globe'));
    go.onclick = () => { closeOverlay(); api.pwOpen(p.id); };
    const del = el('button', 'pw-act danger'); del.title = 'Supprimer'; del.appendChild(icon('i-trash'));
    del.onclick = () => { api.pwDelete(p.id); refreshPasswords(); };
    acts.append(eye, copy, go, del);
    row.appendChild(acts);
    pwBody.appendChild(row);
  });
}
async function runImport() {
  const r = await api.pwImport();
  if (!r || r.canceled) return;
  if (r.error) { toast(r.error); return; }
  await refreshPasswords();
  const parts = [];
  if (r.imported) parts.push(`${r.imported} ajouté${r.imported > 1 ? 's' : ''}`);
  if (r.updated) parts.push(`${r.updated} mis à jour`);
  toast(parts.length ? parts.join(', ') + '. Pense à supprimer le CSV.' : 'Aucun mot de passe trouvé dans ce fichier.');
}
let toastTimer = null;
function toast(msg) {
  const old = document.querySelector('.toast'); if (old) old.remove();
  const t = el('div', 'toast'); t.appendChild(icon('i-check')); t.appendChild(el('span', null, msg));
  $('content').appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 4000);
}
$('pw-import').onclick = () => showOverlay('pw-guide');
$('pw-guide-cancel').onclick = () => openSettings('passwords');
$('pw-guide-pick').onclick = async () => { await runImport(); openSettings('passwords'); };
pwSearch.addEventListener('input', renderPasswords);

// ---------- export Markdown ----------
let mdContent = '', mdTitle = 'page';
function buildTurndown() {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', hr: '---' });
  try { if (window.turndownPluginGfm && window.turndownPluginGfm.gfm) td.use(window.turndownPluginGfm.gfm); } catch {}
  td.addRule('stripEmptyLinks', { filter: (n) => n.nodeName === 'A' && !n.textContent.trim(), replacement: () => '' });
  return td;
}
// Nettoie le HTML dérivé de la page avant de l'afficher dans l'interface (anti-XSS).
function sanitizeHtml(html) {
  const tpl = document.createElement('template'); tpl.innerHTML = html || '';
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,textarea,svg').forEach((e) => e.remove());
  tpl.content.querySelectorAll('*').forEach((e) => {
    [...e.attributes].forEach((a) => { const n = a.name.toLowerCase(); if (n.startsWith('on') || (['href', 'src'].includes(n) && /^\s*javascript:/i.test(a.value))) e.removeAttribute(a.name); });
  });
  return tpl.innerHTML;
}
function renderMdPreview(md) {
  const box = $('md-preview');
  let html = '';
  try { html = window.marked ? window.marked.parse(md) : ('<pre>' + md.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</pre>'); } catch { html = '<p>(aperçu indisponible)</p>'; }
  box.innerHTML = '<div class="md-render">' + sanitizeHtml(html) + '</div>';
}
function mdShowTab(which) {
  $('md-tab-preview').classList.toggle('active', which === 'preview');
  $('md-tab-source').classList.toggle('active', which === 'source');
  $('md-preview').classList.toggle('hidden', which !== 'preview');
  $('md-source').classList.toggle('hidden', which !== 'source');
}
api.onExportMd((data) => {
  let body = '';
  try { body = buildTurndown().turndown(data.html || ''); } catch { body = ''; }
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  mdTitle = data.title || 'page';
  mdContent = `# ${data.title || ''}\n\n[Source](${data.url})\n\n---\n\n${body}\n`;
  $('md-sub').textContent = data.url;
  $('md-source').value = mdContent;
  renderMdPreview(mdContent);
  mdShowTab('preview');
  showOverlay('export-md');
});
$('md-tab-preview').onclick = () => mdShowTab('preview');
$('md-tab-source').onclick = () => mdShowTab('source');
$('md-close').onclick = closeOverlay;
$('md-copy').onclick = () => { api.mdCopy(mdContent); toast('Markdown copié'); };
$('md-download').onclick = async () => { const r = await api.mdDownload({ filename: mdTitle, content: mdContent }); if (r && r.ok) toast('Enregistré'); };

// ---------- messages du process principal ----------
api.onState((s) => { state = s; render(); reflectTheme(); });
api.onFocusUrl(() => { closeOverlay(); urlEl.focus(); });
api.onOpenPalette(() => (openOverlay === 'palette' ? closeOverlay() : openPalette()));
api.onRenameGroup((id) => { renamingGroup = id; render(); });
api.onRenameFav((id) => {
  renamingFav = id;
  const favPane = document.querySelector('.settings-pane[data-pane="favorites"]');
  const inPanel = openOverlay === 'settings' && favPane && !favPane.classList.contains('hidden');
  renamingFavCtx = inPanel ? 'panel' : 'sidebar';
  if (inPanel) { favMgrCollapsed.delete(id); renderFavPane(); }
  else render();
});
api.onGmailCount((n) => { gmailUnread = n || 0; if (state) renderApps(); });

// ---------- téléchargements ----------
let downloadsList = [];
function fmtBytes(n) { if (!n) return '0 o'; const u = ['o', 'Ko', 'Mo', 'Go']; const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024))); return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i]; }
function renderDownloads() {
  const box = $('dl-list'); if (!box) return;
  box.innerHTML = '';
  if (!downloadsList.length) { box.appendChild(el('div', 'empty-msg', 'Aucun téléchargement pour l’instant.')); return; }
  for (const d of downloadsList) {
    const row = el('div', 'dl-row');
    const ic = el('div', 'dl-ic'); ic.appendChild(icon(d.state === 'completed' ? 'i-check' : d.state === 'progressing' || d.state === 'paused' ? 'i-download' : 'i-close')); row.appendChild(ic);
    const mid = el('div', 'dl-mid');
    mid.appendChild(el('div', 'dl-name', d.filename));
    if (d.state === 'progressing' || d.state === 'paused') {
      const bar = el('div', 'dl-bar'); const fill = el('div', 'dl-fill'); if (d.total) fill.style.width = Math.round(100 * d.received / d.total) + '%'; else fill.classList.add('indet'); bar.appendChild(fill); mid.appendChild(bar);
      mid.appendChild(el('div', 'dl-sub', d.total ? `${fmtBytes(d.received)} / ${fmtBytes(d.total)}` : fmtBytes(d.received)));
    } else if (d.state === 'completed') {
      mid.appendChild(el('div', 'dl-sub', fmtBytes(d.received)));
    } else {
      mid.appendChild(el('div', 'dl-sub', d.state === 'cancelled' ? 'Annulé' : 'Échec'));
    }
    row.appendChild(mid);
    const acts = el('div', 'dl-acts');
    if (d.state === 'completed') {
      const open = el('button', 'pw-act'); open.title = 'Ouvrir'; open.appendChild(icon('i-globe')); open.onclick = () => api.dlOpen(d.id); acts.appendChild(open);
      const fold = el('button', 'pw-act'); fold.title = 'Voir dans le dossier'; fold.appendChild(icon('i-folder')); fold.onclick = () => api.dlFolder(d.id); acts.appendChild(fold);
    } else if (d.state === 'progressing' || d.state === 'paused') {
      const cancel = el('button', 'pw-act danger'); cancel.title = 'Annuler'; cancel.appendChild(icon('i-close')); cancel.onclick = () => api.dlCancel(d.id); acts.appendChild(cancel);
    }
    const rm = el('button', 'pw-act'); rm.title = 'Retirer de la liste'; rm.appendChild(icon('i-trash')); rm.onclick = () => api.dlRemove(d.id); acts.appendChild(rm);
    row.appendChild(acts);
    box.appendChild(row);
  }
}
function updateDlBadge() {
  const active = downloadsList.filter((d) => d.state === 'progressing' || d.state === 'paused').length;
  setText($('dl-badge'), active ? String(active) : '');
  $('downloads-btn').classList.toggle('active-dl', active > 0);
}
$('downloads-btn').onclick = async () => { downloadsList = await api.dlList(); renderDownloads(); showOverlay('downloads'); };
$('downloads-close').onclick = closeOverlay;
$('dl-clear').onclick = () => api.dlClear();
api.onDownloads((list) => { downloadsList = list || []; updateDlBadge(); if (openOverlay === 'downloads') renderDownloads(); });
api.onDownloadStarted(() => { toast('Téléchargement démarré'); });

// ---------- tooltips personnalisés (remplacent les infobulles natives) ----------
let tipTimer = null, tipEl = null;
function hideTip() { clearTimeout(tipTimer); if (tipEl) { tipEl = null; api.tipHide(); } }
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[title], [data-tip]');
  if (!t) return;
  let text = t.getAttribute('title');
  if (text) { t.dataset.tip = text; t.removeAttribute('title'); } // coupe l'infobulle native, garde le texte
  else text = t.dataset.tip;
  if (!text) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    if (!document.body.contains(t)) return;
    const r = t.getBoundingClientRect();
    tipEl = t;
    api.tipShow({ text, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, side: t.closest('#rail') ? 'right' : 'below' });
  }, 450);
});
document.addEventListener('mouseout', (e) => {
  const from = e.target.closest('[data-tip]');
  if (!from) return;
  const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tip]');
  if (to === from) return; // toujours dans le même élément → ne pas masquer
  hideTip();
});
document.addEventListener('mousedown', hideTip, true);
window.addEventListener('wheel', hideTip, true);
window.addEventListener('blur', hideTip);
