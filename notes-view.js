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
    .nj-overlay { position: absolute; font-family: "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace;
        font-weight: bold; letter-spacing: 0.05em; opacity: 0.55; white-space: nowrap; font-variant-numeric: tabular-nums; }
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
            this.slideLabel = el('nj-overlay', this.flip);
            this.clockLabel = el('nj-overlay', this.flip);
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
            const overlays = s.showSlideNumber || s.showClock || s.showTimer;
            const padX = Math.round(W * s.margin / 100);
            const padTop = Math.round(H * (overlays ? 0.075 : 0.04));
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

            // Overlays
            const ovSize = Math.round(22 * u) + 'px';
            const edge = Math.round(H * 0.025) + 'px';
            Object.assign(this.slideLabel.style, { fontSize: ovSize, left: padX + 'px', top: edge, display: s.showSlideNumber && st.count ? '' : 'none' });
            Object.assign(this.clockLabel.style, { fontSize: ovSize, right: padX + 'px', top: edge, display: s.showClock || s.showTimer ? '' : 'none' });
            this.slideLabel.textContent = st.count ? `SLIDE ${st.index + 1} / ${st.count}` : '';
            Object.assign(this.more.style, { fontSize: Math.round(26 * u) + 'px', bottom: Math.round(H * 0.012) + 'px' });
            const barH = Math.max(2, Math.round(4 * u)) + 'px';
            Object.assign(this.track.style, { height: barH, background: s.color });
            Object.assign(this.progressWrap.style, { height: barH });
            this.progress.style.background = s.color;
            this.updateClock();
            this.applyOffset();
        }

        updateClock() {
            const s = this.settings, st = this.state;
            if (!s || !st) return;
            const parts = [];
            if (s.showTimer && st.slideStartedAt) parts.push(fmtTime(Date.now() - st.slideStartedAt));
            if (s.showClock) {
                const d = new Date();
                parts.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            }
            const t = parts.join('   ');
            if (this.clockLabel.textContent !== t) this.clockLabel.textContent = t;
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

        setOffset(px) {
            this.offset = Math.min(Math.max(0, px), this.max);
            this.applyOffset();
        }

        scrollBy(px) { this.setOffset(this.offset + px * this.unit()); }
        pageBy(dir) { this.setOffset(this.offset + dir * this.viewport.clientHeight * 0.8); }
        scrollToFraction(f) { this.setOffset(f * this.max); }
        restart() { this.shownAt = performance.now(); this.setOffset(0); }

        // Auto-scroll step (only the window in charge of scrolling calls this)
        tick(dt) {
            const s = this.settings, st = this.state;
            if (!s || !st || !s.autoScroll || st.paused || this.max <= 0) return false;
            if (this.offset >= this.max) return false;
            if (performance.now() - this.shownAt < s.scrollDelay * 1000) return false;
            this.setOffset(this.offset + s.scrollSpeed * this.unit() * dt);
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
