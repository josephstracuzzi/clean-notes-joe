# Development

Notes for working on Clean Notes Joe. For what the apps do and how to use them, see [README.md](README.md).

## Running and testing
```bash
npm install
npm start                 # Clean Notes Joe
npm start -- talk.pptx    # ... with a deck (.pptx or .odp) opened in FILE
npm run start:sender      # Clean Notes Joe Sender
npm test                  # the .pptx / .odp reader, network sync and the changelog check
npm run build             # both portable .exe files in dist/ (Windows)
npm run build:mac         # both Mac apps in dist/ (on a Mac)
```

## Test deck
`test_decks/Clean Notes Joe Test Deck.pptx` is where the LOAD dialog starts until you've opened a deck. Its 10 slides tell a short history of Canada, and their notes cover very short notes, several short lines, no notes, one paragraph, notes long enough to scroll, a full script, soft line breaks and blank lines, a hidden slide, special characters and other scripts (French accents, Inuktitut syllabics), and all-caps notes. Each slide says on it what it tests. The notes are in `tools/make-test-deck.js`; rebuild the deck with `node tools/make-test-deck.js` (no dependencies: it reuses the deck's own theme and layouts and rewrites every title, slide text and set of notes).

## Branches and versions
The project works the same way as [Playback Joe](https://github.com/josephstracuzzi/playback-joe).

**Feature branches.** Each feature or batch of fixes gets its own branch from `main`, named in capitals after the feature: `SOURCE-INDICATOR`, `HIDDEN-SLIDES`, `BUGFIX`. Branches are kept after they're merged.

**Every commit is a version.** Each commit that changes the app bumps the version in `package.json` (shown as the blue badge next to the logo and in both window titles), adds a matching `## [x.y.z] - date` section to [CHANGELOG.md](CHANGELOG.md), and is titled with the version and a short summary, with the details as a list underneath:
```
Clean Notes Joe 0.6.1: source label above the slide list

- NETWORK, LOCAL or FILE in its own colour above the cuelist
- ...
```
MINOR (0.6.0 → 0.7.0) for a new feature or setting, PATCH (0.6.0 → 0.6.1) for a fix or refinement, MAJOR for changes that break saved settings or how the app is operated. `npm test` fails if the version in `package.json` has no changelog section.

**Merging.** When a branch is done and tried in the app, `main` is moved forward to it (no merge commit, no pull request), then pushed:
```bash
git switch main
git merge --ff-only SOURCE-INDICATOR
git push origin main SOURCE-INDICATOR
```
README, roadmap and other docs-only commits go straight onto `main`, without a version.

**Releases.** Only chosen versions become releases, from `main`:
1. `npm run build` makes both portable `.exe` files in `dist/`.
2. `git tag vx.y.z` and `git push origin vx.y.z`.
3. Publish a GitHub release titled **Clean Notes Joe x.y.z** with both `.exe` files attached. Publishing it starts the **Release builds** workflow (`.github/workflows/release-builds.yml`), which builds both Mac apps on GitHub, checks they start, and attaches the four Mac zips a few minutes later. The notes list the downloads, the SmartScreen warning, what's new since the last release, and where settings are kept.

## Project layout
| File | What it does |
|---|---|
| `main.js` | main process: show state, windows, displays, settings, global keys, IPC |
| `preload.js` | the bridge the pages use to talk to the main process |
| `index.html` | operator console |
| `output.html` | fullscreen notes output (runs the auto-scroll) |
| `notes-view.js` | the notes renderer, shared by the output and the PGM preview |
| `pptx.js` | reads slide titles, notes and hidden slides from a `.pptx` or `.odp` (no dependencies) |
| `network.js` | network sync: senders announce themselves and serve their notes; a receiver follows one paired sender |
| `sender-main.js`, `sender-preload.js`, `sender.html` | Clean Notes Joe Sender (built with `electron-builder.sender.json`) |
| `live.js` | follows PowerPoint, or LibreOffice Impress, through a hidden Windows PowerShell process (COM). Also has an untested macOS path for PowerPoint |
| `test/` | `npm test`: the `.pptx` and `.odp` reader, network sync (real sockets) and the changelog check |
| `test_decks/` | the test deck (bundled with the app) |
| `docs/` | the screenshots in this README |
