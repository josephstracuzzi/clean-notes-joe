# Changelog

All notable changes to Clean Notes Joe. The version number lives in `package.json` and is shown in the
console's header badge and both window titles. Each release gets a section here and a matching git tag
(`v0.1.0`, ...). See **Versioning** in the README for how to cut a release.

Versions follow `MAJOR.MINOR.PATCH`:
- **PATCH** for fixes that don't change how the app is used
- **MINOR** for new features or settings
- **MAJOR** for changes that break saved settings or how the app is operated

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
