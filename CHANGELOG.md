# Changelog

All notable changes to Clean Notes Joe. The version number lives in `package.json` and is shown in the
console's header badge and both window titles. Each release gets a section here and a matching git tag
(`v0.1.0`, ...). See **Versioning** in the README for how to cut a release.

Versions follow `MAJOR.MINOR.PATCH`:
- **PATCH** for fixes that don't change how the app is used
- **MINOR** for new features or settings
- **MAJOR** for changes that break saved settings or how the app is operated

## [Unreleased]

### Changed
- **HEADER SIZE** goes up to 20% of the screen (was 12%). If the slide number, timer and clock don't fit side by side, the
  header text shrinks to fit instead of being cut off; the timer stays centred.
- The header shows the slide number as **4 / 10** (the word SLIDE is gone, to save space).
- **HEADER COLOUR** presets in the SCREEN panel: MATCH (the notes colour, as before), white, grey, yellow, green and red.
  The band and line under the header follow the chosen colour.
- The header now uses the **notes font** (with fixed-width digits so the clock doesn't jiggle) instead of a monospace font.
  **HEADER FONT** switches back to MONO.

## [0.5.3] - 2026-11-10

### Fixed
- **No old slide lists in NETWORK**: starting Clean Notes Joe in NETWORK with the Sender open but PowerPoint closed showed
  the deck last loaded on that PC (its notes could reach the output). NETWORK now only ever shows what the Sender sends.
  The Sender also stops sending the previous deck when PowerPoint closes, has no presentation open, is in Protected View
  or can't be reached; a busy moment (end-of-show black screen) or a helper restart still keeps the last slide.

### Changed
- The console's right-hand pane always shows its scrollbar, so opening or closing a settings panel doesn't shift anything.

## [0.5.2] - 2026-11-10

### Fixed
- **Protected View**: a deck PowerPoint opens read-only (the yellow **Enable Editing** bar, for files from the internet,
  email or a zip) couldn't be seen by the Sender or LOCAL, which kept waiting. They now say **PROTECTED VIEW: CLICK ENABLE
  EDITING** (the Sender also explains how to unblock the file for good), paired notes PCs show it too, and following starts
  as soon as Enable Editing is clicked.

## [0.5.1] - 2026-11-10

### Fixed
- **Finding PowerPoint (Sender and LOCAL)**: when PowerPoint is open but not yet visible to other programs (Office only
  registers itself after its window has first lost focus), it is now reached another way instead of showing WAITING FOR
  POWERPOINT. Windows PowerShell is started from its fixed location rather than relying on PATH. The helper lets go of
  PowerPoint after every check, so closing PowerPoint can't leave it running invisibly.
- Clearer reasons when PowerPoint can't be read: **CAN'T REACH POWERPOINT** when it's open but one of the two apps runs as
  administrator, and a message when PowerShell is restricted on the PC (Constrained Language mode). The Sender explains
  what to do in its notes area.

- **Diagnostics in the Sender**: while it's waiting, a line under the message shows whether its PowerPoint helper (Windows
  PowerShell) is running and which version, whether Windows reports PowerPoint as running, and the last helper error.
  A helper that doesn't start, stops or doesn't answer within 20 seconds is now reported instead of waiting silently.

### Changed
- The Sender's window fits its content exactly (about 550 × 600), keeping the same look; it can be made bigger but not
  smaller.
- Bigger chevrons on the settings panel headers, centred on the header line.

## [0.5.0] - 2026-11-10

### Changed
- The source buttons are now **LOCAL** (was LIVE), **NETWORK** and **FILE**, followed by **LOAD** (was + OPEN DECK) and
  **REFRESH** (was RELOAD). Only the active source is lit: green when working, amber while waiting, red when the network
  connection is lost. FILE switches back to the loaded deck; LOAD opens a new one.
- Slide number, timer and clock now sit in a **header bar** across the top of the notes screen: a faint band in the
  text colour with a line under it, slide number on the left, timer in the centre and clock on the right. It is 5% of
  the screen height by default, adjustable with **HEADER SIZE** (3 to 12%) in the SCREEN panel. The notes always start
  below it, and it disappears when all three are off.
- **Clean Notes Joe Sender**: minimizing hides it to the **system tray** (it keeps sending; click the coffee-cup icon to
  bring it back, hover for the status, right-click for Show / Quit). Closing the window asks first: **Minimize to tray**,
  **Quit sender** or **Cancel**. The bottom of the window now just says **DO NOT CLOSE THIS WINDOW**. Opening it again
  while it's running brings the running one back instead of starting a second copy.
- New default for the header bar: **slide number and clock on, timer off** (RESET ALL applies it to an existing setup).
- The settings panels (NETWORK, TEXT, COLOUR, FIT & SCROLL, SCREEN) **collapse**: click a panel's header to close or open it.
  Closed panels stay closed at the next launch.
- The console's smallest window width is now 1100 px (as in Playback Joe); below 1250 px the logo and header buttons shrink.

## [0.4.0] - 2026-11-10

### Added
- **Clean Notes Joe Sender**, a separate small app for the PowerPoint PCs. It follows PowerPoint and starts sending
  as soon as it opens, and shows the slide and notes being sent, ROLE (MAIN / BACKUP), the PC's name, show code,
  IP address and which notes PCs are connected. Built alongside Clean Notes Joe with the same version number.

### Changed
- Clean Notes Joe only receives now: the SEND section is gone from its NETWORK panel.

## [0.3.0] - 2026-11-10

### Added
- **Network sync**: PowerPoint on one PC, notes on another. Any PC can **SEND** what it shows (role MAIN or BACKUP,
  with a name); a notes PC picks **NETWORK** and is **PAIRED WITH** one sender, found automatically on the local
  network or by typing its IP address. For main and backup setups, each notes PC is paired with its own PowerPoint PC.
  - Remembered by the PC's identity, not its IP address, so a new DHCP address doesn't break the pairing.
  - Connection loss (including a pulled cable, noticed within about 3 seconds) keeps the last notes on screen,
    shows CONNECTION LOST on the console and reconnects by itself.
  - Optional **SHOW CODE** keeps other shows on a shared network out.
  - One way only: notes PCs can't control the PowerPoint PC.
- **Test deck** (10 slides covering short, long, scrolling, empty, hidden, special-character and line-break notes),
  bundled with the app and opened on the first launch.

### Fixed
- Soft line breaks (Shift+Enter) in notes now stay inside their paragraph, and a blank line between sections
  is kept, matching PowerPoint.

## [0.2.0] - 2026-11-10

### Added
- **SIZE** button (from Playback Joe): makes the operator console **SMALL**, **DEFAULT** or **LARGE**.
  The output is never affected. The minimum window size follows it, and the size is remembered for the next launch.

## [0.1.0] - 2026-11-10

First version, ported from the Python prototype to Electron and styled to match Playback Joe.

### Added
- Operator console with the slide list (titles, word count, rough speaking time, NO NOTES and HIDDEN tags),
  a PGM preview that matches the output exactly, slide counter, slide timer and scroll position bar.
- Fullscreen notes output on the second display (or a chosen one), a 16:9 window on a single screen,
  and automatic moving when a display is connected or disconnected.
- **File mode**: open a `.pptx` and step through it. The file reloads by itself when saved in PowerPoint.
- **Live mode**: follows the slide PowerPoint is showing, in the slideshow or the editor
  through PowerShell/COM, including notes edited but not yet saved.
- Text settings: font, bold, uppercase, alignment, line spacing, paragraph gap, side margins, colour
  presets and custom colours, vertical centring, mirror for teleprompter glass.
- Auto-fit (largest size between a min and max that fits the screen) and auto-scroll (speed, start delay,
  pause, top, drag to scroll) with soft fades at the edges and a progress line.
- Overlays: slide number, slide timer and clock.
- Keyboard: arrows / PgUp PgDn for slides, ↑ ↓ to scroll, Space to pause, Home for top, + − for size.
  The same keys with Ctrl+Alt work while PowerPoint has focus.
- Settings and the last deck are remembered between launches.
- Windows portable build (`npm run build`).
