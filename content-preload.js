// Script injecté dans le MONDE PRINCIPAL de chaque page d'onglet (via executeJavaScript au chargement).
// Affiche un bouton flottant « Détacher » au survol d'une vidéo (façon Opera) qui bascule la vidéo
// en Picture-in-Picture natif de Chromium (fenêtre flottante toujours au premier plan).
// Le clic réel sur le bouton fournit le geste utilisateur exigé par requestPictureInPicture().
// NB : injecté dans le monde principal (pas en preload sandboxé) car un preload sandboxé
// n'expose pas ses éléments au DOM visible par la page.

(function () {
  if (window.__naxPipInit) return;
  window.__naxPipInit = true;

  const MIN_W = 180, MIN_H = 120;   // ignore les petites vidéos (vignettes, avatars)
  let btn = null, curVideo = null, hideTimer = null, raf = 0;

  function eligible(v) {
    if (!v || v.tagName !== 'VIDEO' || v.disablePictureInPicture) return false;
    const r = v.getBoundingClientRect();
    return r.width >= MIN_W && r.height >= MIN_H && r.bottom > 4 && r.top < innerHeight - 4;
  }

  function build() {
    if (btn) return btn;
    const b = document.createElement('div');
    btn = b;
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', 'Détacher la vidéo');
    b.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'display:none', 'align-items:center', 'gap:7px',
      'margin:0', 'padding:7px 12px 7px 10px', 'border-radius:10px', 'cursor:pointer', 'opacity:0',
      'font:600 12.5px Inter,system-ui,"Segoe UI",Arial,sans-serif', 'color:#fff', 'line-height:1',
      'letter-spacing:.01em', 'background:rgba(18,20,27,.86)',
      'backdrop-filter:blur(10px) saturate(1.2)', '-webkit-backdrop-filter:blur(10px) saturate(1.2)',
      'border:1px solid rgba(255,255,255,.18)', 'box-shadow:0 8px 24px rgba(0,0,0,.5)',
      'transition:opacity .16s ease', 'user-select:none', 'pointer-events:auto',
    ].join(';');
    b.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" style="flex:none;display:block">' +
      '<rect x="3" y="4.5" width="18" height="15" rx="2.2"></rect>' +
      '<rect x="12" y="11" width="7" height="5.5" rx="1.2" fill="#fff" stroke="none"></rect></svg>' +
      '<span style="white-space:nowrap">Détacher</span>';
    b.addEventListener('mouseenter', () => { clearTimeout(hideTimer); });
    b.addEventListener('mouseleave', scheduleHide);
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
    b.addEventListener('click', onClick, true);
    (document.body || document.documentElement).appendChild(b);
    return b;
  }

  async function onClick(e) {
    e.preventDefault(); e.stopPropagation();
    const v = curVideo;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        const same = document.pictureInPictureElement === v;
        await document.exitPictureInPicture();
        if (same) return;               // bascule : re-clic = refermer
      }
      if (document.pictureInPictureEnabled && v.requestPictureInPicture) await v.requestPictureInPicture();
    } catch (_) { /* refus du site / pas de geste : on ignore */ }
  }

  function show(v) {
    const b = build();
    const r = v.getBoundingClientRect();
    b.style.left = Math.round(r.left + r.width / 2) + 'px';
    b.style.top = Math.round(r.top + 12) + 'px';
    b.style.transform = 'translateX(-50%)';
    b.style.display = 'flex';
    void b.offsetWidth;
    b.style.opacity = '1';
  }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 260); }
  function hide() {
    curVideo = null;
    if (!btn) return;
    btn.style.opacity = '0';
    setTimeout(() => { if (btn && btn.style.opacity === '0') btn.style.display = 'none'; }, 180);
  }

  // Trouve la vidéo sous le curseur, même si des contrôles/overlays la recouvrent (ex. YouTube).
  function videoAt(x, y) {
    const top = document.elementFromPoint(x, y);
    if (top && top.tagName === 'VIDEO' && eligible(top)) return top;
    const vids = document.getElementsByTagName('video');
    for (let i = 0; i < vids.length; i++) {
      const v = vids[i];
      if (!eligible(v)) continue;
      const r = v.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v;
    }
    return null;
  }

  document.addEventListener('mousemove', (e) => {
    const v = videoAt(e.clientX, e.clientY);
    if (v) { curVideo = v; clearTimeout(hideTimer); show(v); }
    else if (curVideo) {
      if (btn && (e.target === btn || btn.contains(e.target))) return;
      scheduleHide();
    }
  }, true);

  // Suit la vidéo pendant le défilement / redimensionnement tant que le bouton est visible.
  const follow = () => {
    if (!curVideo || !btn || btn.style.display === 'none') return;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (curVideo) { if (eligible(curVideo)) show(curVideo); else hide(); }
    });
  };
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow, true);
})();
