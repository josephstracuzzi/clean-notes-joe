# Clean Notes Joe
Designed by Joseph Stracuzzi

**Your PowerPoint speaker notes, big and clean on a second screen.** Load a deck, or let Clean Notes Joe
follow PowerPoint. The notes for the current slide fill a fullscreen display, sized to fit, and
scroll gently when there's too much to fit. A companion to [Playback Joe](https://github.com/josephstracuzzi/playback-joe).

---

## Run it

```
npm install
npm start               # Clean Notes Joe
npm run start:sender    # Clean Notes Joe Sender
```

`npm start -- talk.pptx` opens a deck straight away. Otherwise the last deck comes back.

## Two windows
- **Operator console** on your main screen: the slide list, a PGM preview that matches the output exactly,
  the slide timer, transport and all display settings.
- **Output** with only the notes. With a second display connected it opens fullscreen there. On a single
  screen it opens as a 16:9 window in the top-right corner. **DISPLAY** picks a specific screen, and the output
  moves by itself when a display is plugged in or unplugged.

## Three sources
The buttons top left pick where the notes come from: **LOCAL · NETWORK · FILE** (the active one is lit: green when
working, amber while waiting, red when the network connection is lost). **LOAD** opens a `.pptx` and **REFRESH** reads it
again.

- **FILE** shows the notes of the deck opened with **LOAD**. Step with ◀ PREV / NEXT ▶, the arrow keys, PgUp/PgDn
  (most clickers) or by clicking a slide. Save the deck in PowerPoint and it reloads by itself.
- **LOCAL** follows the slide PowerPoint is on, on this PC, in the slideshow and in the editor.
  Notes come straight from PowerPoint, so edits show up before you save.
  - Tip: in PowerPoint's *Slide Show* settings, send the show to the projector and turn off *Presenter View*
    if it would take over the screen you use for notes.

## Network: PowerPoint on one PC, notes on another
Two apps, built from this project with the same version number:
- **Clean Notes Joe** on each notes PC (this app).
- **Clean Notes Joe Sender** on each PowerPoint PC: a small window that follows PowerPoint and sends the current
  slide and notes. It starts sending as soon as it opens; there's nothing to switch on.

Each notes PC is paired with one PowerPoint PC. With main and backup machines, pair the main notes PC with the main
PowerPoint PC and the backup notes PC with the backup PowerPoint PC. There is no automatic switching.

**On the PowerPoint PC:** open **Clean Notes Joe Sender** next to PowerPoint. The first time, set **ROLE** (MAIN or
BACKUP) and **THIS PC'S NAME** (e.g. STAGE-A); it remembers them. When Windows asks to allow it on the network,
allow it on **Private** networks. The window shows the slide and notes it's sending, this PC's IP address, and
which notes PCs are connected (**SENDING TO 2**). Leave it running during the show: minimizing hides it to the system
tray, where it keeps sending (click the coffee-cup icon to bring it back). Closing the window asks before it stops sending.

**On the notes PC:** click **NETWORK**, then pick the PowerPoint PC under **PAIRED WITH** (listed with
its role and IP address). If the list stays empty (some venue Wi-Fi blocks this), choose **TYPE IP ADDRESS…** and
enter the address shown in the Sender.

Slide changes arrive almost instantly, and notes come straight from PowerPoint, so edits show before you save. The
pairing is remembered by the PC's identity, not its IP address, so a new DHCP address doesn't break it. If the
connection drops (cable pulled, PC restarted), the notes screen keeps the last notes, the console shows
**CONNECTION LOST**, and it reconnects by itself. The output never shows network status.

**SHOW CODE** (optional): enter the same code in the Sender and on the notes PCs. Machines without it are refused
and are marked in the PAIRED WITH list. This is useful on shared or DHCP networks; leave it blank on a private
show network.

One way only: a notes PC can't change slides or control the PowerPoint PC. Uses TCP port 47820 and UDP port 47821.

## Test deck
`test_decks/Clean Notes Joe Test Deck.pptx` opens on the first launch. Its 10 slides cover very short notes,
several short lines, no notes, one paragraph, notes long enough to scroll, a full script, soft line breaks and
blank lines, a hidden slide, special characters and other scripts, and all-caps notes. Each slide says on it what
it tests. Rebuild it with `python tools/make-test-deck.py` (needs python-pptx).

## Display settings
| | |
|---|---|
| Text | font, bold, uppercase, alignment, line spacing, paragraph gap, side margin |
| Colour | presets (white, yellow, green, cyan on black, white on navy, black on white) or any colours |
| Fit & scroll | **auto-fit** picks the largest size between MIN and MAX that fits. If it still doesn't fit, **auto-scroll** starts after the START DELAY at the chosen SPEED. Drag the bar under the timer to scroll by hand |
| Screen | **header bar** with slide number, slide timer and clock (HEADER SIZE 3 to 12% of the screen), centre vertically, **mirror** for teleprompter glass |

Sizes are in points at 1080p and scale with the output, so text looks the same on any screen.
Settings and the last deck are remembered in `%APPDATA%\clean-notes-joe`.

## Keys
| Key | Action |
|---|---|
| **← / →**, **PgUp / PgDn** | previous / next slide (FILE) |
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
1. Add a `## [x.y.z] - date` section at the top of `CHANGELOG.md` describing the changes, and commit it.
2. Run `npm version patch` (fixes), `npm version minor` (new features) or `npm version major`. This checks the
   changelog has a section for the new version, bumps `package.json`, commits and creates the `vx.y.z` tag.
3. `npm run build`, then `git push --follow-tags` and attach both `.exe` files from `dist/` to a GitHub release
   for the tag.

## Build
Windows 10 / 11 (64-bit) for now:
```
npm run build         # dist/Clean Notes Joe <version> Portable.exe and dist/Clean Notes Joe Sender <version> Portable.exe
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
| `network.js` | network sync: senders announce themselves and serve their notes; a receiver follows one paired sender |
| `sender-main.js`, `sender-preload.js`, `sender.html` | Clean Notes Joe Sender (built with `electron-builder.sender.json`) |
| `live.js` | follows PowerPoint through a hidden Windows PowerShell process (COM). Also has an untested macOS path for later |
| `test/` | `npm test`: the `.pptx` reader, network sync (real sockets) and the changelog check |
| `test_decks/` | the test deck (bundled with the app) |
