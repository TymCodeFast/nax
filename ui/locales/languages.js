// Langues de l'interface de NaX. Le français est la langue source : les textes sont écrits en français
// dans le code et servent de clés. Pour ajouter une langue :
//   1. copier ui/locales/en.js en ui/locales/<code>.js et traduire chaque valeur (garder les clés françaises
//      et les variables {n}, {name}… telles quelles) ;
//   2. l'ajouter à la liste ci-dessous (code, nom affiché dans sa propre langue, locale pour dates et nombres).
// Une clé absente du fichier retombe sur le texte français. Une clé « contexte::Texte » traduit un texte
// appelé avec tr('Texte', { _ctx: 'contexte' }) quand le même mot français a deux sens.
(function (root, langs) {
  if (typeof module === 'object' && module.exports) module.exports = langs;
  else root.NAX_LANGUAGES = langs;
})(this, [
  { code: 'en', name: 'English', locale: 'en-US' },
  { code: 'fr', name: 'Français', locale: 'fr-FR', source: true },
]);
