// ============================================================================
// Clean Notes Joe - notes renderer
// Shared by the output window and the operator's PGM preview, so the preview is laid out exactly
// like the output: the preview builds a stage at the output's real pixel size and scales it down.
// Sizes in settings are "points at 1080p": they scale with the output's height, so the text looks
// the same on a 720p monitor and a 4K projector.
// ============================================================================

(function () {
    const STYLE = `
    .nj-stage { position: absolute; left: 0; top: 0; overflow: hidden; transform-origin: 0 0; }
    .nj-viewport { position: absolute; overflow: hidden; }
    .nj-viewport.nj-overflow { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 var(--nj-fade), #000 calc(100% - var(--nj-fade)), transparent 100%); }
    .nj-viewport.nj-overflow.nj-at-top { -webkit-mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - var(--nj-fade)), transparent 100%); }
    .nj-viewport.nj-overflow.nj-at-end { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 var(--nj-fade), #000 100%); }
    .nj-content { position: absolute; left: 0; right: 0; top: 0; will-change: transform; overflow-wrap: break-word; }
    .nj-content p { margin: 0; white-space: pre-wrap; }
    .nj-content.nj-empty { opacity: 0.35; }
    .nj-content.nj-enter { animation: nj-enter 0.18s ease-out; }
    @keyframes nj-enter { from { opacity: 0; } to { opacity: 1; } }
    /* Header bar: slide number left, timer centre, clock right, each in a fixed slot */
    .nj-header { position: absolute; left: 0; right: 0; top: 0; display: grid; grid-template-columns: 1fr auto 1fr; column-gap: 0.8em; align-items: center; box-sizing: border-box;
        font-weight: bold; letter-spacing: 0.05em; white-space: nowrap; font-variant-numeric: tabular-nums; line-height: 1; }
    /* Timer centred; slide number and clock get the room on either side of it */
    .nj-header span { min-width: 0; overflow: hidden; text-overflow: ellipsis; opacity: 0.9; }
    .nj-header .nj-h-left { text-align: left; }
    .nj-header .nj-h-mid { text-align: center; }
    .nj-header .nj-h-right { text-align: right; }
    .nj-more { position: absolute; left: 50%; transform: translateX(-50%); opacity: 0.6; line-height: 1; }
    .nj-progress { position: absolute; left: 0; bottom: 0; height: 100%; }
    .nj-progress-track { position: absolute; left: 0; right: 0; bottom: 0; opacity: 0.25; }
    `;

    function injectStyle() {
        if (document.getElementById('nj-style')) return;
        const el = document.createElement('style');
        el.id = 'nj-style';
        el.textContent = STYLE;
        document.head.appendChild(el);
    }

    function fmtTime(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        const two = n => String(n).padStart(2, '0');
        return (h ? two(h) + ':' : '') + two(m) + ':' + two(sec);
    }

    const MONO = '"Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

    // A #rrggbb colour at the given opacity
    function tint(hex, alpha) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        const n = m ? parseInt(m[1], 16) : 0xffffff;
        return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }

    function el(cls, parent) {
        const d = document.createElement('div');
        d.className = cls;
        parent.appendChild(d);
        return d;
    }

    class NotesView {
        constructor(host) {
            injectStyle();
            this.host = host;
            this.stage = el('nj-stage', host);
            // Everything is drawn in .nj-flip so MIRROR can flip it without touching the preview scaling
            this.flip = el('nj-flip', this.stage);
            Object.assign(this.flip.style, { position: 'absolute', inset: '0' });
            this.viewport = el('nj-viewport', this.flip);
            this.content = el('nj-content', this.viewport);
            this.header = el('nj-header', this.flip);
            this.slideLabel = document.createElement('span');
            this.slideLabel.className = 'nj-h-left';
            this.timerLabel = document.createElement('span');
            this.timerLabel.className = 'nj-h-mid';
            this.clockLabel = document.createElement('span');
            this.clockLabel.className = 'nj-h-right';
            this.header.append(this.slideLabel, this.timerLabel, this.clockLabel);
            this.more = el('nj-more', this.flip);
            this.more.textContent = '▼';
            this.track = el('nj-progress-track', this.flip);
            this.progressWrap = el('nj-progress-track', this.flip);
            this.progressWrap.style.opacity = '1';
            this.progressWrap.style.background = 'transparent';
            this.progress = el('nj-progress', this.progressWrap);

            this.width = 1920;
            this.height = 1080;
            this.settings = null;
            this.state = null;
            this.offset = 0;
            this.max = 0;
            this.lastKey = null;
            this.shownAt = performance.now();
            this.clockTimer = setInterval(() => this.updateClock(), 500);
        }

        // Stage size in real output pixels, and how much to shrink it on screen (preview only)
        setSize(width, height, scale = 1) {
            const w = Math.max(100, Math.round(width)), h = Math.max(100, Math.round(height));
            const changed = w !== this.width || h !== this.height;
            this.width = w;
            this.height = h;
            this.stage.style.width = w + 'px';
            this.stage.style.height = h + 'px';
            this.stage.style.transform = scale !== 1 ? `scale(${scale})` : '';
            this.scale = scale;
            if (changed) this.layout(true);
        }

        unit() { return this.height / 1080; }

        // state: { notes, title, index, count, slideStartedAt, showStartedAt, paused, key }
        update(state, settings) {
            this.state = state;
            this.settings = settings;
            this.flip.style.transform = settings.mirror ? 'scaleX(-1)' : '';
            const key = state.key;
            const newSlide = key !== this.lastKey;
            this.lastKey = key;
            if (newSlide) {
                this.offset = 0;
                this.glide = null;
                this.shownAt = performance.now();
                this.content.classList.remove('nj-enter');
                void this.content.offsetWidth; // restart the fade-in
                this.content.classList.add('nj-enter');
            }
            this.layout(!newSlide);
        }

        layout(keepOffset = true) {
            const s = this.settings, st = this.state;
            if (!s || !st) return;
            const u = this.unit();
            const W = this.width, H = this.height;
            const showHeader = s.showSlideNumber || s.showClock || s.showTimer;
            const headerH = showHeader ? Math.round(H * s.headerSize / 100) : 0;
            const padX = Math.round(W * s.margin / 100);
            // Notes always start below the header bar, with a gap
            const padTop = headerH + Math.round(H * (showHeader ? 0.03 : 0.04));
            const padBottom = Math.round(H * 0.05);
            const availH = H - padTop - padBottom;

            this.stage.style.background = s.background;
            this.stage.style.color = s.color;
            Object.assign(this.viewport.style, { left: padX + 'px', right: padX + 'px', top: padTop + 'px', height: availH + 'px' });
            this.viewport.style.setProperty('--nj-fade', Math.round(H * 0.06) + 'px');

            const c = this.content;
            c.style.fontFamily = s.fontFamily;
            c.style.fontWeight = s.bold ? '700' : '400';
            c.style.textAlign = s.align;
            c.style.lineHeight = String(s.lineSpacing);
            c.style.textTransform = s.uppercase ? 'uppercase' : 'none';

            // Rebuild the paragraphs only when the text changed
            const text = (st.notes || '').trim();
            const empty = !text;
            const shown = empty ? (st.count ? s.emptyText : 'NO NOTES LOADED') : text;
            if (c.dataset.text !== shown) {
                c.textContent = '';
                // One <p> per paragraph; a blank paragraph between sections is kept as an empty line;
                // soft line breaks (U+2028) stay inside their paragraph with normal line spacing
                for (const para of shown.split('\n')) {
                    const p = document.createElement('p');
                    const text = para.replace(/\u2028/g, '\n');
                    if (!text.trim()) { p.textContent = '\u00a0'; p.className = 'nj-blank'; } else p.textContent = text;
                    c.appendChild(p);
                }
                c.dataset.text = shown;
                this.words = empty ? 0 : shown.split(/\s+/).filter(Boolean).length;
            }
            c.classList.toggle('nj-empty', empty);

            const applySize = (pt) => {
                c.style.fontSize = (pt * u) + 'px';
                const gap = (pt * u * s.paraSpacing) + 'px';
                for (const p of c.children) p.style.marginBottom = gap;
                if (c.lastChild) c.lastChild.style.marginBottom = '0';
            };

            let size = s.fontSize;
            if (s.autoFit && !empty) {
                let lo = Math.round(Math.min(s.fitMin, s.fitMax)), hi = Math.round(Math.max(s.fitMin, s.fitMax)), best = lo;
                while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    applySize(mid);
                    if (c.offsetHeight <= availH) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
                }
                size = best;
            } else if (empty) {
                size = Math.min(s.autoFit ? s.fitMax : s.fontSize, 60);
            }
            applySize(size);
            this.fontPt = size;

            const h = c.offsetHeight;
            this.max = Math.max(0, h - availH);
            const top = (s.centerVertical || empty) && h < availH ? Math.round((availH - h) / 2) : 0;
            c.style.top = top + 'px';
            if (!keepOffset) this.offset = 0;
            this.offset = Math.min(this.offset, this.max);

            // Header bar: a faint band in the text colour with a thin line under it; text scales with the bar
            const line = Math.max(1, Math.round(2 * u));
            // Header colour: its own preset, or the notes colour; the band and line are tinted with it.
            // Font: the notes font by default (digits fixed-width so the clock doesn't jiggle), or monospace.
            const hc = s.headerColor && s.headerColor !== 'auto' ? s.headerColor : s.color;
            Object.assign(this.header.style, {
                display: showHeader ? 'grid' : 'none',
                height: headerH + 'px',
                padding: `0 ${padX}px`,
                fontSize: Math.round(headerH * 0.5) + 'px',
                fontFamily: s.headerFont === 'mono' ? MONO : s.fontFamily,
                color: hc,
                background: tint(hc, 0.08),
                borderBottom: `${line}px solid ${tint(hc, 0.3)}`
            });
            this.headerFontPx = Math.round(headerH * 0.5);
            this.slideLabel.textContent = s.showSlideNumber && st.count ? `${st.index + 1} / ${st.count}` : '';
            // Auto-scroll progress bar along the bottom (20 px at 1080p), with the "more" arrow just above it.
            // It matches the header: the band's colour behind, the header colour for the part scrolled.
            const bar = Math.max(6, Math.round(20 * u));
            Object.assign(this.more.style, { fontSize: Math.round(26 * u) + 'px', bottom: (bar + Math.round(H * 0.008)) + 'px' });
            Object.assign(this.track.style, { height: bar + 'px', background: tint(hc, 0.08), opacity: '1' });
            Object.assign(this.progressWrap.style, { height: bar + 'px' });
            this.progress.style.background = hc;
            this.updateClock();
            this.applyOffset();
        }

        updateClock() {
            const s = this.settings, st = this.state;
            if (!s || !st) return;
            const timer = s.showTimer && st.slideStartedAt ? fmtTime(Date.now() - st.slideStartedAt) : '';
            // 24-hour (14:30) or 12-hour with AM/PM (2:30 PM), whatever the PC's own clock setting
            const clock = !s.showClock ? '' : s.clockFormat === '12h'
                ? new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                : new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
            const changed = this.timerLabel.textContent !== timer || this.clockLabel.textContent !== clock;
            if (this.timerLabel.textContent !== timer) this.timerLabel.textContent = timer;
            if (this.clockLabel.textContent !== clock) this.clockLabel.textContent = clock;
            if (changed || this.header.dataset.fitFor !== this.slideLabel.textContent + '|' + this.headerFontPx) this.fitHeader();
        }

        // Header text starts at half the bar's height and shrinks only if the three items don't fit side by side
        fitHeader() {
            if (!this.headerFontPx || this.header.style.display === 'none') return;
            const spans = [this.slideLabel, this.timerLabel, this.clockLabel];
            let px = this.headerFontPx;
            this.header.style.fontSize = px + 'px';
            const overflows = () => spans.some(sp => sp.scrollWidth > sp.clientWidth + 1);
            while (overflows() && px > this.headerFontPx * 0.4) {
                px = Math.floor(px * 0.92);
                this.header.style.fontSize = px + 'px';
            }
            this.header.dataset.fitFor = this.slideLabel.textContent + '|' + this.headerFontPx;
        }

        applyOffset() {
            this.content.style.transform = `translateY(${-this.offset}px)`;
            const overflow = this.max > 0;
            this.viewport.classList.toggle('nj-overflow', overflow);
            this.viewport.classList.toggle('nj-at-top', overflow && this.offset <= 0.5);
            this.viewport.classList.toggle('nj-at-end', overflow && this.offset >= this.max - 0.5);
            this.more.style.display = overflow && this.offset < this.max - 1 ? '' : 'none';
            const showBar = overflow && this.settings && this.settings.autoScroll;
            this.track.style.display = showBar ? '' : 'none';
            this.progressWrap.style.display = showBar ? '' : 'none';
            this.progress.style.width = (overflow ? (this.offset / this.max) * 100 : 0) + '%';
        }

        // Jumps straight there (dragging the scroll bar, TOP, a new slide); stops any glide
        setOffset(px) {
            this.glide = null;
            this.moveTo(px);
        }

        moveTo(px) {
            this.offset = Math.min(Math.max(0, px), this.max);
            this.applyOffset();
        }

        // The arrow keys and Page Up/Down glide to the new position (see tick) instead of jumping; pressing again
        // while it glides adds to where it's heading
        glideBy(px) {
            const from = this.glide !== null && this.glide !== undefined ? this.glide : this.offset;
            this.glide = Math.min(Math.max(0, from + px), this.max);
        }

        scrollBy(px) { this.glideBy(px * this.unit()); }
        pageBy(dir) { this.glideBy(dir * this.viewport.clientHeight * 0.8); }
        scrollToFraction(f) { this.setOffset(f * this.max); }
        restart() { this.shownAt = performance.now(); this.setOffset(0); }

        // Scroll step (only the window in charge of scrolling calls this). A key glide eases gently towards its
        // target (most of the way in about half a second); then auto-scroll carries on from there. Auto-scroll is
        // paced to reading speed: the time to read every word at scrollWpm, less the start delay, is spread evenly
        // over the scroll, so the end comes into view as the last word is reached and the text never runs ahead.
        tick(dt) {
            if (this.glide !== null && this.glide !== undefined) {
                const target = Math.min(this.glide, this.max);
                const diff = target - this.offset;
                if (Math.abs(diff) < 0.5) { this.moveTo(target); this.glide = null; }
                else this.moveTo(this.offset + diff * Math.min(1, dt * 5));
                return true;
            }
            const s = this.settings, st = this.state;
            if (!s || !st || !s.autoScroll || st.paused || this.max <= 0) return false;
            if (this.offset >= this.max) return false;
            if (performance.now() - this.shownAt < s.scrollDelay * 1000) return false;
            const readSeconds = (this.words || 0) * 60 / s.scrollWpm;
            this.setOffset(this.offset + this.max / Math.max(5, readSeconds - s.scrollDelay) * dt);
            return true;
        }

        status() {
            const s = this.settings, st = this.state;
            let phase = 'fits';
            if (this.max > 0) {
                if (this.offset >= this.max - 0.5) phase = 'end';
                else if (st && st.paused) phase = 'paused';
                else if (s && !s.autoScroll) phase = 'manual';
                else if (performance.now() - this.shownAt < (s ? s.scrollDelay : 0) * 1000) phase = 'waiting';
                else phase = 'scrolling';
            }
            return { offset: this.offset, max: this.max, fontPt: this.fontPt, phase };
        }
    }

    window.NotesView = NotesView;
    window.njFormatTime = fmtTime;
})();
