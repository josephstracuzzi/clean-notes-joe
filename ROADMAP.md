# Roadmap

Ideas agreed for later, in no particular order. When one is built, it moves to CHANGELOG.md.

- **Reset sizing to default**: a quick way to put the text size settings (auto-fit min/max, fixed size) back to
  their defaults without resetting everything else.
- **Per-deck settings**: a deck reopens with the size settings it had last time (for example after a rehearsal),
  so each presentation keeps its own sizing.
- **Skip hidden slides in file mode**: when a `.pptx` is opened directly, ◀ PREV / NEXT ▶ (and the arrow keys)
  step over slides hidden in PowerPoint, the way the slideshow does. They stay in the slide list, marked HIDDEN,
  and can still be clicked. (LIVE and NETWORK already follow whatever PowerPoint shows.)
- **LibreOffice support**: open LibreOffice Impress files (`.odp`) in file mode, and follow a running LibreOffice
  Impress live, in Clean Notes Joe and in the Sender. Impress can already save as `.pptx`, which works today.
- **Clearer source indicator**: make it obvious at a glance whether the notes come from **NETWORK** (and which PC),
  **LIVE** (PowerPoint on this PC) or a **LOADED FILE**. For example, one prominent source label in the header in its
  own colour, rather than the small badge on the PGM bar and the line under it.
- **Mac builds**: the code has a macOS live path (AppleScript), untested; builds were dropped to focus on Windows.
- **Remote slide control**: deliberately not built (network sync is one way). Revisit only if wanted.
