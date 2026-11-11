// ============================================================================
// Clean Notes Joe - live PowerPoint follower
// Reports which slide PowerPoint is on (slideshow or editor) and that slide's notes.
//   Windows: a hidden Windows PowerShell process talks to PowerPoint over COM and prints a JSON
//            line whenever something changes. Notes come straight from PowerPoint, so unsaved
//            edits show up too. With no presentation open in PowerPoint, LibreOffice Impress is
//            followed the same way (through its own COM bridge) when it's running.
//   macOS:   AppleScript is asked for the open file and slide number twice a second; the notes are
//            read from the saved file (save in PowerPoint to see note edits).
// Each report is passed to onUpdate(state):
//   { state: 'ok', file, name, index, count, title?, notes? }   index is 1-based
//   { state: 'not-running' | 'unreachable' | 'no-presentation' | 'protected' | 'busy' | 'unsupported' | 'error', message? }
//   protected = the deck is open in Protected View (Enable Editing not clicked yet)
//   unreachable = PowerPoint is running but can't be reached (one of the two runs as administrator)
// ============================================================================

const { spawn, execFile } = require('child_process');

const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
# Company PCs can lock PowerShell into Constrained Language mode, which blocks talking to PowerPoint: say so
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
    Write-Output '{"state":"error","message":"POWERSHELL IS RESTRICTED ON THIS PC (CONSTRAINED LANGUAGE MODE), SO POWERPOINT CANNOT BE READ"}'
    exit
}
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::Out.WriteLine((@{ state = 'hello'; ps = $PSVersionTable.PSVersion.ToString() } | ConvertTo-Json -Compress)); [Console]::Out.Flush()
$last = ''
$unreachable = $false
$nextFallback = [DateTime]::MinValue

# Finds the running PowerPoint. Office only registers itself for other programs after its window has
# lost focus once, so when PowerPoint is running but not registered yet, it is reached through COM
# activation instead (PowerPoint hands back its running instance). If that produces a hidden, empty
# PowerPoint, the real one is out of reach (one of the two runs as administrator): close it and say so.
function Get-PowerPoint {
    try { $a = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); $script:unreachable = $false; return $a } catch {}
    if (-not (Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)) { $script:unreachable = $false; return $null }
    # Only an unreachable PowerPoint waits 5 seconds between tries (each try may start and close a hidden PowerPoint)
    if ($script:unreachable -and [DateTime]::Now -lt $script:nextFallback) { return $null }
    try {
        $a = New-Object -ComObject PowerPoint.Application
        if ($a.Presentations.Count -eq 0 -and $a.Visible -eq 0) {
            try { $a.Quit() } catch {}
            $script:unreachable = $true
            $script:nextFallback = [DateTime]::Now.AddSeconds(5)
            return $null
        }
        $script:unreachable = $false
        return $a
    } catch {
        $script:unreachable = $true
        $script:nextFallback = [DateTime]::Now.AddSeconds(5)
        return $null
    }
}

# LibreOffice Impress, through its COM bridge (com.sun.star.ServiceManager). Its methods are called by name
# (PowerShell can't bind them directly). It's only asked once LibreOffice is running: asking would start one.
# Returns a JSON line, or $null when LibreOffice isn't running.
function U($obj, [string]$name) { [System.__ComObject].InvokeMember($name, [Reflection.BindingFlags]::InvokeMethod, $null, $obj, [object[]]$args) }
function Read-Impress {
    if (-not (Get-Process -Name soffice.bin -ErrorAction SilentlyContinue)) { return $null }
    try { $sm = New-Object -ComObject com.sun.star.ServiceManager; $desk = U $sm createInstance 'com.sun.star.frame.Desktop' }
    catch { return '{"state":"busy","app":"libreoffice"}' } # starting up or closing
    try {
        # The presentation in front, or else any open one
        $doc = U $desk getCurrentComponent
        if (-not $doc -or -not (U $doc supportsService 'com.sun.star.presentation.PresentationDocument')) {
            $doc = $null
            $all = U (U $desk getComponents) createEnumeration
            while (-not $doc -and (U $all hasMoreElements)) {
                $c = U $all nextElement
                if (U $c supportsService 'com.sun.star.presentation.PresentationDocument') { $doc = $c }
            }
        }
        if (-not $doc) { return '{"state":"no-presentation","app":"libreoffice"}' }
        $show = U $doc getPresentation
        if (U $show isRunning) { $slide = U (U $show getController) getCurrentSlide; $mode = 'show' }
        else { $slide = U (U $doc getCurrentController) getCurrentPage; $mode = 'edit' }
        # The page number counts hidden slides too (the slideshow's own index skips them)
        $idx = U $slide getPropertyValue 'Number'
        $notes = ''
        $np = U $slide getNotesPage
        for ($i = 0; $i -lt (U $np getCount); $i++) {
            $s = U $np getByIndex $i
            if ((U $s getShapeType) -eq 'com.sun.star.presentation.NotesShape') { $notes = U $s getString; break }
        }
        $title = ''
        for ($i = 0; $i -lt (U $slide getCount); $i++) {
            $s = U $slide getByIndex $i
            if ((U $s getShapeType) -eq 'com.sun.star.presentation.TitleTextShape') { $title = U $s getString; break }
        }
        $url = U $doc getURL
        $file = ''; $name = 'UNTITLED'
        if ($url) { $file = ([Uri]$url).LocalPath; $name = [IO.Path]::GetFileName($file) }
        return (@{ state = 'ok'; app = 'libreoffice'; mode = $mode; file = $file; name = $name; index = $idx; count = (U (U $doc getDrawPages) getCount); title = $title; notes = $notes } | ConvertTo-Json -Compress)
    } catch {
        # Starting or ending the show, a dialog open in LibreOffice...
        return '{"state":"busy","app":"libreoffice"}'
    }
}

while ($true) {
    $out = $null
    $app = Get-PowerPoint
    if (-not $app) {
        if ($unreachable) { $out = '{"state":"unreachable"}' }
        else {
            # Diagnostics: is PowerPoint's process running at all?
            $found = [bool](Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
            $out = '{"state":"not-running","proc":' + $found.ToString().ToLower() + '}'
        }
    } else {
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
            } elseif ($app.ProtectedViewWindows.Count -gt 0) {
                # Opened from the internet, email or a zip: read-only until Enable Editing is clicked, and not
                # listed in Presentations until then
                $out = '{"state":"protected"}'
            } else {
                $out = '{"state":"no-presentation"}'
            }
        } catch {
            # End-of-show black screen, a dialog open in PowerPoint, focus in the slide sorter...
            $out = '{"state":"busy"}'
        }
    }
    # No presentation in PowerPoint (or no PowerPoint): follow LibreOffice Impress instead, if it's running
    if ($out -match '"state":"(not-running|no-presentation|unreachable)"') {
        $lo = Read-Impress
        if ($lo -and ($lo -notmatch '"state":"no-presentation"' -or $out -match '"state":"not-running"')) { $out = $lo }
    }
    # Let go of PowerPoint and LibreOffice after every look: held references can keep them running invisibly after they are closed
    $app = $null; $pres = $null; $w = $null; $win = $null; $slide = $null; $shp = $null; $lo = $null
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
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
    // onDiag (optional) gets { helper, ps, powerpointProcess, restarts, lastError } for the Sender's diagnostics line
    constructor(onUpdate, onDiag) {
        this.onUpdate = onUpdate;
        this.onDiag = onDiag || (() => {});
        this.diag = { helper: 'starting', ps: '', powerpointProcess: null, restarts: 0, lastError: '' };
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
        // Windows PowerShell 5.1 from its fixed location (PATH can be changed or missing it)
        const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
        const fixed = require('path').join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const exe = require('fs').existsSync(fixed) ? fixed : 'powershell.exe';
        const proc = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
        this.proc = proc;
        this.setDiag({ helper: 'starting' });
        // No hello within 20 s: PowerShell is blocked or hanging (antivirus, policy). Say so instead of waiting silently.
        let helloSeen = false;
        const helloTimer = setTimeout(() => {
            if (helloSeen || this.proc !== proc) return;
            this.setDiag({ helper: 'not responding', lastError: 'NO ANSWER FROM WINDOWS POWERSHELL AFTER 20 SECONDS' });
            this.emit({ state: 'error', message: 'THE POWERPOINT HELPER (WINDOWS POWERSHELL) IS NOT RESPONDING. IT MAY BE BLOCKED BY ANTIVIRUS OR A COMPANY POLICY.' });
        }, 20000);
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
                    if (s.state === 'hello') {
                        helloSeen = true;
                        this.setDiag({ helper: 'running', ps: String(s.ps || '').slice(0, 30), lastError: '' });
                        continue;
                    }
                    if (s.state === 'not-running' && typeof s.proc === 'boolean') this.setDiag({ powerpointProcess: s.proc });
                    else if (s.state !== 'not-running' && s.app !== 'libreoffice') this.setDiag({ powerpointProcess: ['unreachable', 'ok', 'no-presentation', 'busy', 'protected'].includes(s.state) ? true : this.diag.powerpointProcess });
                    if (s.state === 'ok') {
                        this.emit({ state: 'ok', file: String(s.file || ''), name: String(s.name || ''), index: Number(s.index) || 1, count: Number(s.count) || 0, title: String(s.title || '').replace(/\s+/g, ' ').trim(), notes: cleanNotes(s.notes) });
                    } else {
                        this.emit(typeof s.message === 'string' ? { state: s.state, message: s.message.slice(0, 300) } : { state: s.state });
                    }
                } catch (e) { /* partial or non-JSON line */ }
            }
        });
        let stderr = '';
        proc.stderr.on('data', d => { stderr = (stderr + d).slice(-500); });
        proc.on('error', err => {
            this.setDiag({ helper: 'failed', lastError: String(err.message).toUpperCase().slice(0, 200) });
            this.emit({ state: 'error', message: 'COULD NOT START WINDOWS POWERSHELL: ' + String(err.message).toUpperCase() });
        });
        proc.on('exit', (code) => {
            clearTimeout(helloTimer);
            if (this.proc !== proc) return;
            this.proc = null;
            if (!this.running) return;
            const why = stderr.trim() ? stderr.trim().split('\n').pop().trim().slice(0, 200) : (code === null ? 'STOPPED BY THE SYSTEM' : 'EXIT CODE ' + code);
            this.setDiag({ helper: 'stopped', restarts: this.diag.restarts + 1, lastError: why.toUpperCase() });
            this.emit({ state: 'error', message: 'THE POWERPOINT HELPER STOPPED (' + why.toUpperCase() + '). RESTARTING IT.' });
            // Restart after a pause (PowerShell killed, machine woke from sleep...)
            this.timer = setTimeout(() => { if (this.running) this.startWindows(); }, 2000);
        });
    }

    setDiag(changes) {
        const next = { ...this.diag, ...changes };
        if (JSON.stringify(next) === JSON.stringify(this.diag)) return;
        this.diag = next;
        this.onDiag(this.diag);
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
