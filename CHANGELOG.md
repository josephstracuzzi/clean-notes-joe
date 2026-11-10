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
- The source buttons are now **LOCAL** (was LIVE), **NETWORK** and **FILE**, followed by **LOAD** (was + OPEN DECK) and
  **REFRESH** (was RELOAD). Only the active source is lit: green when working, amber while waiting, red when the network
  connection is lost. FILE switches back to the loaded deck; LOAD opens a new one.
- Slide number, timer and clock now sit in a **header bar** across the top of the notes screen: a faint band in the
  text colour with a line under it, slide number on the left, timer in the centre and clock on the right. It is 5% of
  the screen height by default, adjustable with **HEADER SIZE** (3 to 12%) in the SCREEN panel. The notes always start
  below it, and it disappears when all three are off.
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
