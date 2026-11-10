# Clean Notes Joe
Designed by Joseph Stracuzzi

**Your PowerPoint speaker notes, big and clean on a second screen.** Open a deck, or let Clean Notes Joe
follow PowerPoint live. The notes for the current slide fill a fullscreen display, sized to fit, and
scroll gently when there's too much to fit. A companion to [Playback Joe](https://github.com/josephstracuzzi/playback-joe).

---

## Run it

```
npm install
npm start
```

`npm start -- talk.pptx` opens a deck straight away. Otherwise the last deck comes back.

## Two windows
- **Operator console** on your main screen: the slide list, a PGM preview that matches the output exactly,
  the slide timer, transport and all display settings.
- **Output** with only the notes. With a second display connected it opens fullscreen there. On a single
  screen it opens as a 16:9 window in the top-right corner. **DISPLAY** picks a specific screen, and the output
  moves by itself when a display is plugged in or unplugged.

## Two sources
- **+ OPEN DECK** reads the notes from a `.pptx`. Step with ◀ PREV / NEXT ▶, the arrow keys, PgUp/PgDn
  (most clickers) or by clicking a slide. Save the deck in PowerPoint and it reloads by itself.
- **LIVE** follows the slide PowerPoint is on, in the slideshow and in the editor.
  Notes come straight from PowerPoint, so edits show up before you save.
  - Tip: in PowerPoint's *Slide Show* settings, send the show to the projector and turn off *Presenter View*
    if it would take over the screen you use for notes.

## Display settings
| | |
|---|---|
| Text | font, bold, uppercase, alignment, line spacing, paragraph gap, side margin |
| Colour | presets (white, yellow, green, cyan on black, white on navy, black on white) or any colours |
| Fit & scroll | **auto-fit** picks the largest size between MIN and MAX that fits. If it still doesn't fit, **auto-scroll** starts after the START DELAY at the chosen SPEED. Drag the bar under the timer to scroll by hand |
| Screen | slide number, slide timer, clock, centre vertically, **mirror** for teleprompter glass |

Sizes are in points at 1080p and scale with the output, so text looks the same on any screen.
Settings and the last deck are remembered in `%APPDATA%\clean-notes-joe`.

## Keys
| Key | Action |
|---|---|
| **← / →**, **PgUp / PgDn** | previous / next slide (file mode) |
| **↑ / ↓** | scroll |
| **Space** | pause / resume auto-scroll |
| **Home** | back to the top, restart the start delay |
| **- / +** | smaller / bigger text |
| **Ctrl+Alt** + any of the above | the same, while PowerPoint or another app has focus (can be turned off under SCREEN → KEYS) |

## Versioning
The version lives in `package.json` (currently shown as the blue badge next to the logo and in both window
titles). Every release has a section in [CHANGELOG.md](CHANGELOG.md) and a git tag. `npm test` fails if the
version in `package.json` has no changelog section.

To release:
1. Add a `## [x.y.z] - date` section at the top of `CHANGELOG.md` describing the changes.
2. Run `npm version patch` (fixes), `npm version minor` (new features) or `npm version major`. This checks the
   changelog, bumps `package.json`, commits and creates the `vx.y.z` tag.
3. `npm run build`, then `git push --follow-tags` and attach `dist/Clean Notes Joe x.y.z Portable.exe` to a GitHub
   release for the tag.

## Build
Windows 10 / 11 (64-bit) for now:
```
npm run build         # dist/Clean Notes Joe <version> Portable.exe
```
The app is portable (nothing to install) and not code-signed, so on first launch Windows SmartScreen says
"Windows protected your PC". Click **More info → Run anyway**.

## Project layout
| File | What it does |
|---|---|
| `main.js` | main process: show state, windows, displays, settings, global keys, IPC |
| `preload.js` | the bridge the pages use to talk to the main process |
| `index.html` | operator console |
| `output.html` | fullscreen notes output (runs the auto-scroll) |
| `notes-view.js` | the notes renderer, shared by the output and the PGM preview |
| `pptx.js` | reads slide titles and notes from a `.pptx` (no dependencies) |
| `live.js` | follows PowerPoint through a hidden Windows PowerShell process (COM). Also has an untested macOS path for later |
| `test/` | `npm test`: the `.pptx` reader and the changelog check |
