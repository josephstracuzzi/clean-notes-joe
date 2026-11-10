// ============================================================================
// Clean Notes Joe - live PowerPoint follower
// Reports which slide PowerPoint is on (slideshow or editor) and that slide's notes.
//   Windows: a hidden Windows PowerShell process talks to PowerPoint over COM and prints a JSON
//            line whenever something changes. Notes come straight from PowerPoint, so unsaved
//            edits show up too.
//   macOS:   AppleScript is asked for the open file and slide number twice a second; the notes are
//            read from the saved file (save in PowerPoint to see note edits).
// Each report is passed to onUpdate(state):
//   { state: 'ok', file, name, index, count, title?, notes? }   index is 1-based
//   { state: 'not-running' | 'no-presentation' | 'busy' | 'unsupported' | 'error', message? }
// ============================================================================

const { spawn, execFile } = require('child_process');

const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$last = ''
while ($true) {
    $out = $null
    $app = $null
    try { $app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { $out = '{"state":"not-running"}' }
    if ($app) {
        try {
            $pres = $null; $idx = 0; $mode = ''
            if ($app.SlideShowWindows.Count -gt 0) {
                $w = $app.SlideShowWindows.Item(1)
                $pres = $w.Presentation
                $idx = $w.View.Slide.SlideIndex
                $mode = 'show'
            } elseif ($app.Presentations.Count -gt 0) {
                $win = $app.ActiveWindow
                $pres = $win.Presentation
                $idx = $win.View.Slide.SlideIndex
                $mode = 'edit'
            }
            if ($pres) {
                $slide = $pres.Slides.Item($idx)
                $notes = ''
                foreach ($shp in $slide.NotesPage.Shapes) {
                    try {
                        if ($shp.Type -eq 14 -and $shp.PlaceholderFormat.Type -eq 2 -and $shp.HasTextFrame) {
                            $notes = $shp.TextFrame.TextRange.Text; break
                        }
                    } catch {}
                }
                $title = ''
                try { if ($slide.Shapes.HasTitle) { $title = $slide.Shapes.Title.TextFrame.TextRange.Text } } catch {}
                $out = @{ state = 'ok'; mode = $mode; file = $pres.FullName; name = $pres.Name; index = $idx; count = $pres.Slides.Count; title = $title; notes = $notes } | ConvertTo-Json -Compress
            } else {
                $out = '{"state":"no-presentation"}'
            }
        } catch {
            # End-of-show black screen, a dialog open in PowerPoint, focus in the slide sorter...
            $out = '{"state":"busy"}'
        }
    }
    if ($out -ne $last) { [Console]::Out.WriteLine($out); [Console]::Out.Flush(); $last = $out }
    Start-Sleep -Milliseconds 200
}
`;

const MAC_SCRIPT = `
if application "Microsoft PowerPoint" is running then
    tell application "Microsoft PowerPoint"
        try
            if (count of slide show windows) > 0 then
                set w to slide show window 1
                set p to presentation of w
                set i to slide index of slide of slide show view of w
            else if (count of presentations) > 0 then
                set p to active presentation
                set i to slide index of slide of view of document window 1
            else
                return "no-presentation"
            end if
            return "ok" & tab & (full name of p) & tab & (name of p) & tab & i & tab & (count of slides of p)
        on error errMsg
            return "busy" & tab & errMsg
        end try
    end tell
end if
return "not-running"
`;

function cleanNotes(s) {
    return String(s || '').replace(/\r\n?/g, '\n').replace(/\v/g, '\u2028').trim(); // \v = soft line break (Shift+Enter)
}

class LiveFollower {
    constructor(onUpdate) {
        this.onUpdate = onUpdate;
        this.proc = null;
        this.timer = null;
        this.running = false;
        this.lastKey = '';
    }

    static isSupported() {
        return process.platform === 'win32' || process.platform === 'darwin';
    }

    emit(state) {
        const key = JSON.stringify(state);
        if (key === this.lastKey) return;
        this.lastKey = key;
        this.onUpdate(state);
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.lastKey = '';
        if (process.platform === 'win32') this.startWindows();
        else if (process.platform === 'darwin') this.pollMac();
        else this.emit({ state: 'unsupported', message: 'NEEDS POWERPOINT ON WINDOWS' });
    }

    stop() {
        this.running = false;
        if (this.proc) { try { this.proc.kill(); } catch (e) { /* already gone */ } this.proc = null; }
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }

    startWindows() {
        const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
        // Windows PowerShell 5.1 (not pwsh): it has Marshal.GetActiveObject for reaching PowerPoint
        const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
        this.proc = proc;
        let buffer = '';
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', chunk => {
            buffer += chunk;
            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line) continue;
                try {
                    const s = JSON.parse(line);
                    if (s.state === 'ok') {
                        this.emit({ state: 'ok', file: String(s.file || ''), name: String(s.name || ''), index: Number(s.index) || 1, count: Number(s.count) || 0, title: String(s.title || '').replace(/\s+/g, ' ').trim(), notes: cleanNotes(s.notes) });
                    } else {
                        this.emit({ state: s.state });
                    }
                } catch (e) { /* partial or non-JSON line */ }
            }
        });
        let stderr = '';
        proc.stderr.on('data', d => { stderr = (stderr + d).slice(-500); });
        proc.on('error', err => this.emit({ state: 'error', message: 'COULD NOT START POWERSHELL: ' + err.message }));
        proc.on('exit', () => {
            if (this.proc !== proc) return;
            this.proc = null;
            if (!this.running) return;
            if (stderr.trim()) this.emit({ state: 'error', message: 'POWERPOINT HELPER STOPPED: ' + stderr.trim().split('\n').pop() });
            // Restart after a pause (PowerShell killed, machine woke from sleep...)
            this.timer = setTimeout(() => { if (this.running) this.startWindows(); }, 2000);
        });
    }

    pollMac() {
        if (!this.running) return;
        execFile('osascript', ['-e', MAC_SCRIPT], { timeout: 3000 }, (err, stdout, stderr) => {
            if (!this.running) return;
            if (err) {
                const msg = String(stderr || err.message);
                // -1743: the user hasn't allowed Clean Notes Joe to control PowerPoint (System Settings > Privacy > Automation)
                this.emit(/-1743|not authori[sz]ed/i.test(msg)
                    ? { state: 'error', message: 'ALLOW CLEAN NOTES JOE TO CONTROL POWERPOINT IN SYSTEM SETTINGS > PRIVACY & SECURITY > AUTOMATION' }
                    : { state: 'busy' });
            } else {
                const parts = stdout.replace(/\n$/, '').split('\t');
                if (parts[0] === 'ok' && parts.length >= 5) {
                    this.emit({ state: 'ok', file: macPathToPosix(parts[1]), name: parts[2], index: parseInt(parts[3], 10) || 1, count: parseInt(parts[4], 10) || 0 });
                } else {
                    this.emit({ state: parts[0] === 'not-running' || parts[0] === 'no-presentation' ? parts[0] : 'busy' });
                }
            }
            this.timer = setTimeout(() => this.pollMac(), 400);
        });
    }
}

// PowerPoint for Mac may give an HFS path ("Macintosh HD:Users:joe:talk.pptx")
function macPathToPosix(p) {
    if (!p || p.startsWith('/')) return p;
    const parts = p.split(':');
    parts.shift(); // volume name
    return '/' + parts.join('/');
}

module.exports = { LiveFollower };
