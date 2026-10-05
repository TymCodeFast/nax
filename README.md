<p align="center">
  <img src="assets/icon.png" width="96" alt="NaX logo">
</p>

<h1 align="center">NaX</h1>

<p align="center">
  <b>The browser that tidies up your tabs for you.</b><br>
  Open source · Chromium-based · Windows 10 and 11
</p>

<p align="center">
  <a href="https://github.com/TymCodeFast/nax/releases/latest"><img src="https://img.shields.io/github/v/release/TymCodeFast/nax?label=version&color=2f6fe4" alt="Latest version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/free-yes-0ea5e9" alt="Free">
  <img src="https://img.shields.io/badge/open%20source-yes-7385ff" alt="Open source">
</p>

<p align="center">
  <a href="https://github.com/TymCodeFast/nax/releases/latest"><b>⬇ Download NaX</b></a>
  &nbsp;·&nbsp;
  <a href="#features"><b>Features</b></a>
  &nbsp;·&nbsp;
  <a href="#install"><b>Install</b></a>
  &nbsp;·&nbsp;
  <a href="#for-developers"><b>Develop</b></a>
</p>

<p align="center">
  <img src="docs/screenshots/apercu.png" alt="NaX preview: grouped tabs on the left, bookmarks at the bottom, web page in the middle" width="900">
</p>

---

## Why NaX?

A regular browser always ends up with forty tabs and no way to find anything.
Everyone promises to clean them up later. NaX tackles the problem the other way around:
**organize later, or never.**

NaX automatically groups what you open together, puts to sleep what you no longer
touch, and keeps everything you've ever opened one search away. You stay in control,
without the chore of tidying up.

---

## Features

### Tabs that organize themselves

| | |
|---|---|
| **Automatic groups** | A page opened from another one stays grouped with the page that opened it. The group names itself, and a double-click renames it. |
| **Collapsible groups** | One click shrinks a group to a single bar (name, favicons, count). NaX remembers the state. |
| **No duplicates** | Typing the address of a page that's already open takes you back to it. Ctrl+Enter forces a new tab. |
| **Sleep** | A tab left idle for 2 hours goes to sleep, greyed out, without losing its place. One click wakes it up. |
| **Archive** | A closed tab, or one asleep for 3 days, moves to the archive. Nothing gets lost. |
| **Search everywhere** | Ctrl+K finds open tabs, sleeping tabs, the archive and your history. |

### Organize with the mouse

Drag and drop a tab to reorder it, group it or pull it out of a group. Move a whole
group by its header. Right-click gives you the same actions.

### Your apps in the rail

- **Gmail**: a built-in widget with your unread emails (sender, subject, preview) and a badge on the icon. One click opens the email.
- **Calendar, Drive and your own sites**: one click opens them. Add any site with `+`.

### Bookmarks, passwords, downloads

- **Bookmark tree**: folders, subfolders, drag and drop. Ctrl+D bookmarks a page.
- **Password vault**: encrypted with the Windows vault (DPAPI), never stored in plain text on disk. Import from Chrome via CSV. The clipboard is cleared after 30 seconds.
- **Downloads**: progress, and a panel to open the file or show it in its folder.

### A complete browser

- **Home page** with a search bar, on the Home button and for new tabs. It follows your search engine.
- **Find in page** (Ctrl+F), printing, saving pages (HTML or MHTML).
- **Screen sharing** for Meet, Teams or Zoom on the web, with an option to share computer audio.
- **Per-site permissions**: camera, microphone, notifications, location.
- **Private windows and tabs**: nothing is written to disk or history, and granted permissions are forgotten on close.
- **Multiple windows**, restored at startup with their position and size.
- **Links to other apps** (Teams, Zoom, Slack, `mailto:`…): NaX asks before opening them.
- **Markdown export**: turns a page into clean text, ready to paste.
- **Smart search** in the address bar: tabs, bookmarks, history and suggestions, with autocomplete.
- **Customizable keyboard shortcuts**, listed and editable in Settings.
- **Theme**: light, dark or automatic. Search engine of your choice: Google, DuckDuckGo, Bing, Qwant, Ecosia, Brave, Startpage.
- **Interface in English or French**, switchable in Settings without restarting.
- **Default browser**: register from Settings, then pick NaX in Windows Settings.

---

## Install

1. Open the [Releases page](https://github.com/TymCodeFast/nax/releases/latest) and download `NaX-Setup-x.y.z.exe`.
2. Run it. NaX installs into your user folder, and Start menu and desktop shortcuts are created.
3. Windows SmartScreen may show a warning, because the installer isn't signed by a recognized publisher yet. Click "More info", then "Run anyway".

**Your data** (bookmarks, passwords, settings, tabs) lives in `%APPDATA%/NaX`. It survives updates, and uninstalling doesn't delete it.

### Automatic updates

NaX checks at startup, then every 6 hours. When a newer version is available, a discreet bubble appears in the bottom-right corner. Nothing is downloaded without your consent: "Download", then "Restart" to install, or "Later".

---

## Keyboard shortcuts

Every shortcut can be changed in Settings → Shortcuts.

<details>
<summary>See all default shortcuts</summary>

| Key | Action |
|---|---|
| Ctrl+T / Ctrl+W | new tab / close tab |
| Ctrl+Shift+P | new private tab |
| Ctrl+N / Ctrl+Shift+N | new window / new private window |
| Ctrl+Shift+W | close window |
| Ctrl+Shift+T | reopen last closed tab |
| Ctrl+L / Alt+D / F6 | address bar |
| Ctrl+K | search everywhere |
| Ctrl+B | collapse the tab list |
| Ctrl+Tab | last used tab |
| Ctrl+PgDn / Ctrl+PgUp | next / previous tab |
| Ctrl+1 … Ctrl+8 / Ctrl+9 | nth tab / last tab |
| Alt+← / Alt+→ | back / forward |
| Alt+Home | home page |
| Ctrl+R, F5 / Ctrl+Shift+R, Ctrl+F5 | reload / reload without cache |
| Ctrl+F | find in page |
| Ctrl+D | add or remove bookmark |
| Ctrl+H / Ctrl+J | history / downloads |
| Ctrl+Shift+Del | clear browsing data |
| Ctrl+S / Ctrl+P | save page / print |
| Ctrl+U | view page source |
| Ctrl+= / Ctrl+- / Ctrl+0 | zoom |
| F11 | full screen |
| F12 / Ctrl+Shift+I | developer tools (page / interface) |

</details>

---

## Roadmap

- Personalized suggestions on the home page.
- Notification badges on apps (upcoming event, etc.).
- A "recurring" view, computed from history.
- Web form autofill.
- Apps in a side panel, in addition to full screen.

---

## For developers

NaX is an Electron app. No complex build chain.

### Run in dev mode

Requirements: Node.js, then `npm install` (once).

    npm start

For a demo without your data (separate profile, neutral tabs): `npm run demo`. The demo profile is `%APPDATA%/NaX-demo` and never touches the real profile.

NaX only allows one instance per profile: close the installed version before running `npm start`, otherwise the dev build gets redirected to it.

### Structure

- `main.js`: main process. A window, an interface view covering it, and a single content view (tab or app) laid on top. Model for tabs, groups, apps, archive, history and sleep.
- `preload.js`: IPC bridge exposed to the interface (`window.api`). Overlay windows each have their own `*-preload.js`.
- `ui/`: interface (rail, tab list, navigation bar, palette, menus, tooltips, home page, update bubble).
- State is persisted in `%APPDATA%/NaX/state.json`.

To add a setting: a `.settings-navitem` in the nav, a `.settings-pane` in the content (`ui/index.html`), and the wiring in `ui/app.js`.

### Translations

The interface is written in French in the code: the French texts are the translation keys, wrapped in `tr('…')` (and `trn()` for plurals). Dictionaries live in `ui/locales/`, one file per language (`en.js` maps each French text to its English version). A missing key falls back to French.

To add a language: copy `ui/locales/en.js` to `ui/locales/<code>.js`, translate the values (keep the French keys and the `{variables}`), then add the language to `ui/locales/languages.js`. It then appears in Settings → Languages.

Changing a French text in the code also changes its key: update the matching entry in each locale file.

### Build the installer

    npm run dist

Output: `dist/NaX Setup x.y.z.exe` (NSIS installer) and `dist/win-unpacked/NaX.exe`.

### Versions

A single number, in `package.json` (`version`). It's shown in the installer and in Settings → About, and used by automatic updates. [Semver](https://semver.org/) scheme:

| Number | Stage |
|---|---|
| `0.0.x` | closed beta (history) |
| `0.1.x`, `0.2.x`… | **beta** (current) |
| `1.0.0` | first stable release |

Auto-update never offers a version lower than or equal to the installed one. Never republish a number that has already been published.

### Publish a release

1. Bump the version: `npm run bump` (patch) or `npm run bump:minor`. No Git tag is created at this step.
2. Create a GitHub token with the `repo` scope, then publish:

        # PowerShell
        $env:GH_TOKEN = "ghp_xxx"
        npm run publish

   electron-builder builds the installer and creates a GitHub Release tagged `v<version>`, with `NaX-Setup-<version>.exe` and `latest.yml`, the file the app reads to detect updates.

### Contributing

Contributions are welcome. Open an issue to discuss an idea, then a pull request.

---

## License

Distributed under the MIT license. See [LICENSE](LICENSE).
