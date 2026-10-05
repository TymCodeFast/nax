// Traduction de l'interface (fenêtre principale, fenêtres flottantes et processus principal).
// tr('Texte en français', { var }) renvoie le texte dans la langue choisie, ou le français à défaut.
// Les dictionnaires vivent dans ui/locales/ (voir languages.js pour ajouter une langue).
(function (root) {
  const isNode = typeof module === 'object' && module.exports && typeof window === 'undefined';
  const LANGS = isNode ? require('./locales/languages.js') : (root.NAX_LANGUAGES || []);
  const SOURCE = (LANGS.find((l) => l.source) || { code: 'fr' }).code;
  const DEFAULT = 'en';
  let lang = SOURCE;
  let dict = null; // chargé à la première traduction
  const missing = new Set();
  const listeners = new Set();

  const known = (code) => LANGS.some((l) => l.code === code);
  const info = () => LANGS.find((l) => l.code === lang) || { code: lang, locale: lang };

  function fill(s, vars) {
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s;
  }
  function t(key, vars) {
    let s = key;
    if (lang !== SOURCE) {
      if (!dict) dict = dictFor(lang);
      // même texte français, sens différents : tr('Zoom par défaut', { _ctx: 'raccourci' }) cherche d'abord « raccourci::Zoom par défaut »
      const ck = vars && vars._ctx ? vars._ctx + '::' + key : null;
      if (dict && ck && Object.prototype.hasOwnProperty.call(dict, ck)) s = dict[ck];
      else if (dict && Object.prototype.hasOwnProperty.call(dict, key)) s = dict[key];
      else missing.add(key);
    }
    return fill(s, vars);
  }
  // pluriel selon les règles de la langue affichée : one = forme singulier (française), other = forme plurielle
  let plural = null;
  function tn(n, one, other, vars) {
    try { if (!plural || plural.lang !== lang) plural = { lang, rules: new Intl.PluralRules(info().locale) }; } catch { plural = null; }
    const form = plural ? plural.rules.select(n) : (Math.abs(n) <= 1 ? 'one' : 'other');
    return t(form === 'one' ? one : other, Object.assign({ n }, vars));
  }

  function dictFor(code) {
    if (code === SOURCE) return {};
    if (isNode) { try { return require('./locales/' + code + '.js'); } catch { return {}; } }
    return (root.NAX_LOCALES && root.NAX_LOCALES[code]) || null;
  }
  function apply(code) {
    lang = code; dict = dictFor(code); missing.clear(); plural = null;
    if (!isNode) { try { document.documentElement.lang = code; } catch {} translateDom(); }
    for (const fn of listeners) { try { fn(lang); } catch {} }
  }
  // Navigateur : charge ui/locales/<code>.js à la volée si besoin
  function setLang(code) {
    if (!known(code)) code = DEFAULT;
    if (isNode || code === SOURCE || dictFor(code)) { apply(code); return Promise.resolve(lang); }
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = scriptBase() + 'locales/' + code + '.js';
      s.onload = s.onerror = () => { apply(code); resolve(lang); };
      document.head.appendChild(s);
    });
  }
  function scriptBase() {
    const me = document.querySelector('script[src$="i18n.js"]');
    return me ? me.getAttribute('src').replace(/i18n\.js$/, '') : '';
  }

  // ---- DOM statique (texte écrit dans les .html) ----
  // On mémorise le texte français d'origine de chaque nœud pour pouvoir changer de langue à chaud.
  // Un nœud modifié depuis par le code n'est plus touché.
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const origText = new WeakMap(); // Text -> { src, out }
  const origAttr = new WeakMap(); // Element -> { [attr]: { src, out } }
  let origTitle = null;
  function translateText(node) {
    const raw = node.nodeValue;
    let rec = origText.get(node);
    if (rec && raw !== rec.out) { origText.delete(node); return; }
    const src = rec ? rec.src : raw;
    const key = src.trim();
    if (!key || !/[A-Za-zÀ-ÿ]/.test(key)) return;
    const out = src.replace(key, t(key));
    if (!rec) { rec = { src }; origText.set(node, rec); }
    rec.out = out;
    if (out !== raw) node.nodeValue = out;
  }
  function translateAttrs(elm) {
    let recs = origAttr.get(elm);
    for (const a of ATTRS) {
      if (!elm.hasAttribute(a)) continue;
      const raw = elm.getAttribute(a);
      const rec = recs && recs[a];
      if (rec && raw !== rec.out) { delete recs[a]; continue; }
      const src = rec ? rec.src : raw;
      if (!src.trim()) continue;
      const out = t(src.trim());
      if (!recs) { recs = {}; origAttr.set(elm, recs); }
      recs[a] = { src, out };
      if (out !== raw) elm.setAttribute(a, out);
    }
  }
  function translateDom(rootEl) {
    if (typeof document === 'undefined') return;
    const start = rootEl || document.documentElement;
    if (!start) return;
    if (!rootEl && document.title) { if (origTitle == null) origTitle = document.title; document.title = t(origTitle); }
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          const tag = n.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'svg' || tag === 'SVG') return NodeFilter.FILTER_REJECT;
          if (n.hasAttribute('data-no-i18n')) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType === 3) translateText(n); else translateAttrs(n);
    }
  }

  const api = {
    t, tn, tr: t, trn: tn, setLang, translateDom,
    get lang() { return lang; },
    get locale() { return info().locale || lang; },
    languages: LANGS, source: SOURCE, defaultLang: DEFAULT, isKnown: known,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    missing: () => [...missing],
  };

  if (isNode) { module.exports = api; return; }
  root.I18N = api; root.tr = t; root.trn = tn; // « tr » : « t » sert souvent de variable (onglet)
  // Langue initiale : ?lang=xx dans l'adresse de la page (fenêtres flottantes), sinon la page la fixe elle-même
  let initial = null;
  try { initial = new URLSearchParams(location.search).get('lang'); } catch {}
  if (initial && known(initial) && initial !== SOURCE) {
    lang = initial;
    // chargement synchrone pendant l'analyse de la page : le dictionnaire est prêt avant les scripts suivants
    document.write('<script src="' + scriptBase() + 'locales/' + initial + '.js"><\/script>');
  }
  const ready = () => { if (lang !== SOURCE) apply(lang); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})(this);
