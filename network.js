// ============================================================================
// Clean Notes Joe - network sync (one way: PowerPoint PCs -> notes PCs)
//
// SENDER (a PowerPoint PC, role MAIN or BACKUP): announces itself on the local network once a second
// (UDP broadcast) and serves its current slide, notes and slide list to any receiver that connects
// (TCP, one JSON message per line).
// RECEIVER (a notes PC): is paired with one sender and shows its notes. With main and backup machines,
// the main notes PC pairs with the main PowerPoint PC and the backup with the backup; there is no
// automatic failover. If the connection drops, the last notes stay up and it reconnects by itself.
//
// Senders are remembered by a fixed id (and name), not by IP address, because venue networks often
// hand out new addresses; a typed IP address is the fallback when broadcasts are blocked.
// A shared SHOW CODE (optional) keeps machines from another show on the same network apart.
// Nothing a receiver sends can control the sender: the only messages it can send are hello and
// heartbeat. Everything received is size-checked and rebuilt field by field before use.
// No Electron in here, so it can be tested with plain Node (test/network.test.js).
// ============================================================================

const net = require('net');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const EventEmitter = require('events');

const APP = 'clean-notes-joe';
const PROTOCOL = 1;
const DEFAULT_PORT = 47820;
const DISCOVERY_PORT = 47821;
const HEARTBEAT_MS = 1000;
const TIMEOUT_MS = 2500;          // no message for this long = connection lost
const HELLO_TIMEOUT_MS = 3000;
const MAX_LINE = 16 * 1024 * 1024;
const LIVE_STATUSES = ['ok', 'not-running', 'no-presentation', 'busy', 'error', 'off'];
const ROLES = ['main', 'backup'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function codeHash(code) {
    return crypto.createHash('sha256').update('cnj-show-code:' + String(code || '')).digest('hex');
}

function codeTag(code) {
    return codeHash(code).slice(0, 8);
}

function sameHash(a, b) {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function str(v, max) {
    return typeof v === 'string' ? v.slice(0, max) : '';
}

function int(v, min = 0, max = 1e6) {
    return Number.isInteger(v) && v >= min && v <= max ? v : min;
}

// This machine's IPv4 addresses with their broadcast addresses
function localAddresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) {
            if (a.family !== 'IPv4' && a.family !== 4) continue;
            if (a.internal) continue;
            const ip = a.address.split('.').map(Number);
            const mask = a.netmask.split('.').map(Number);
            const broadcast = ip.map((b, i) => (b | (~mask[i] & 255))).join('.');
            out.push({ address: a.address, broadcast });
        }
    }
    return out;
}

function deckHash(slides) {
    return crypto.createHash('sha1').update(JSON.stringify((slides || []).map(s => [s.title, s.notes]))).digest('hex');
}

function cleanLive(s) {
    if (!s || typeof s !== 'object') return null;
    return {
        status: LIVE_STATUSES.includes(s.status) ? s.status : 'error',
        name: str(s.name, 300),
        index: int(s.index, 0, 100000),
        count: int(s.count, 0, 100000),
        title: str(s.title, 500),
        notes: str(s.notes, 200000)
    };
}

function cleanDeck(d) {
    if (!d || typeof d !== 'object') return null;
    const slides = Array.isArray(d.slides) ? d.slides.slice(0, 5000).map(s => ({
        title: str(s && s.title, 500),
        notes: str(s && s.notes, 200000),
        hidden: !!(s && s.hidden)
    })) : [];
    return { name: str(d.name, 300), slides, hash: /^[0-9a-f]{40}$/.test(d.hash) ? d.hash : deckHash(slides) };
}

// A socket that sends and receives one JSON object per line
class LineSocket extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        this.buffer = '';
        this.closed = false;
        socket.setEncoding('utf8');
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 2000);
        socket.on('data', chunk => {
            this.buffer += chunk;
            if (this.buffer.length > MAX_LINE) { this.close(); return; }
            let nl;
            while ((nl = this.buffer.indexOf('\n')) >= 0) {
                const line = this.buffer.slice(0, nl);
                this.buffer = this.buffer.slice(nl + 1);
                if (!line.trim()) continue;
                let msg;
                try { msg = JSON.parse(line); } catch (e) { continue; }
                if (msg && typeof msg === 'object' && typeof msg.type === 'string') this.emit('message', msg);
            }
        });
        socket.on('error', () => {});
        socket.on('close', () => { this.closed = true; this.emit('close'); });
    }
    send(obj) {
        if (this.closed || this.socket.destroyed) return;
        try { this.socket.write(JSON.stringify(obj) + '\n'); } catch (e) { /* closing */ }
    }
    close() {
        if (!this.socket.destroyed) this.socket.destroy();
    }
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------
class NetSender extends EventEmitter {
    constructor({ id, name, role = 'main', code = '', port = DEFAULT_PORT, discoveryPort = DISCOVERY_PORT }) {
        super();
        this.id = id;
        this.name = name;
        this.role = ROLES.includes(role) ? role : 'main';
        this.code = code;
        this.port = port;
        this.discoveryPort = discoveryPort;
        this.clients = new Set();
        this.live = { status: 'off', name: '', index: 0, count: 0, title: '', notes: '' };
        this.deck = { name: '', slides: [], hash: deckHash([]) };
        this.server = null;
        this.udp = null;
        this.timer = null;
        this.error = '';
    }

    start() {
        if (this.server) return;
        this.server = net.createServer(socket => this.onClient(socket));
        this.server.on('error', err => {
            this.error = err.code === 'EADDRINUSE'
                ? `PORT ${this.port} IS ALREADY IN USE (IS CLEAN NOTES JOE ALREADY SENDING ON THIS PC?)`
                : 'COULD NOT START SENDING: ' + String(err.message).toUpperCase();
            this.emit('change');
        });
        this.server.listen(this.port, '0.0.0.0', () => {
            this.port = this.server.address().port;
            this.error = '';
            this.emit('change');
        });
        this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.udp.on('error', () => {});
        this.udp.bind(0, () => { try { this.udp.setBroadcast(true); } catch (e) { /* no broadcast here */ } });
        this.timer = setInterval(() => this.everySecond(), HEARTBEAT_MS);
        this.everySecond();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        for (const c of this.clients) c.ls.close();
        this.clients.clear();
        if (this.server) this.server.close();
        this.server = null;
        if (this.udp) { try { this.udp.close(); } catch (e) { /* closed */ } }
        this.udp = null;
    }

    configure({ name, role, code }) {
        if (typeof name === 'string' && name) this.name = name;
        if (ROLES.includes(role)) this.role = role;
        if (typeof code === 'string' && code !== this.code) {
            this.code = code;
            // Receivers reconnect and prove the new code
            for (const c of this.clients) c.ls.close();
        }
        this.broadcast({ type: 'welcome', id: this.id, name: this.name, role: this.role });
        this.everySecond();
    }

    setLive(live) {
        const clean = cleanLive(live);
        if (!clean || JSON.stringify(clean) === JSON.stringify(this.live)) return;
        this.live = clean;
        this.broadcast({ type: 'live', live: this.live });
    }

    setDeck(deck) {
        const clean = cleanDeck(deck);
        if (!clean || clean.hash === this.deck.hash && clean.name === this.deck.name) return;
        this.deck = clean;
        this.broadcast({ type: 'deck', deck: this.deck });
    }

    broadcast(msg) {
        for (const c of this.clients) if (c.authed) c.ls.send(msg);
    }

    clientNames() {
        return [...this.clients].filter(c => c.authed).map(c => ({ name: c.name, address: c.address }));
    }

    everySecond() {
        // Beacon so receivers can find this PC without typing an address
        if (this.udp && this.server && !this.error) {
            const beacon = Buffer.from(JSON.stringify({ app: APP, v: PROTOCOL, id: this.id, name: this.name, role: this.role, port: this.port, tag: codeTag(this.code) }));
            // Loopback too, so a receiver on this same PC (testing, or a backup display) finds it
            const targets = new Set(['255.255.255.255', '127.0.0.1', ...localAddresses().map(a => a.broadcast)]);
            for (const t of targets) this.udp.send(beacon, this.discoveryPort, t, () => {});
        }
        const now = Date.now();
        for (const c of this.clients) {
            if (!c.authed) continue;
            if (now - c.lastSeen > TIMEOUT_MS * 2) { c.ls.close(); continue; }
            c.ls.send({ type: 'hb' });
        }
    }

    onClient(socket) {
        const ls = new LineSocket(socket);
        const client = { ls, authed: false, name: '', address: String(socket.remoteAddress || '').replace(/^::ffff:/, ''), lastSeen: Date.now() };
        this.clients.add(client);
        const helloTimer = setTimeout(() => { if (!client.authed) ls.close(); }, HELLO_TIMEOUT_MS);
        ls.on('message', msg => {
            client.lastSeen = Date.now();
            if (!client.authed) {
                if (msg.type !== 'hello' || msg.app !== APP) { ls.close(); return; }
                if (!sameHash(msg.code, codeHash(this.code))) {
                    ls.send({ type: 'refused', reason: 'code' });
                    setTimeout(() => ls.close(), 100);
                    return;
                }
                client.authed = true;
                client.name = str(msg.name, 100) || client.address;
                clearTimeout(helloTimer);
                ls.send({ type: 'welcome', id: this.id, name: this.name, role: this.role });
                ls.send({ type: 'deck', deck: this.deck });
                ls.send({ type: 'live', live: this.live });
                this.emit('change');
            }
            // After hello a receiver only sends heartbeats; anything else is ignored
        });
        ls.on('close', () => {
            clearTimeout(helloTimer);
            const was = client.authed;
            this.clients.delete(client);
            if (was) this.emit('change');
        });
    }

    snapshot() {
        return {
            port: this.port,
            error: this.error,
            addresses: localAddresses().map(a => a.address),
            clients: this.clientNames()
        };
    }
}

// ---------------------------------------------------------------------------
// Receiver
// ---------------------------------------------------------------------------
// target = { id?, name?, role?, address?, port? }: picked from the discovered list (id) or typed (address)
class NetReceiver extends EventEmitter {
    constructor({ id, name, code = '', target = null, discoveryPort = DISCOVERY_PORT }) {
        super();
        this.id = id;
        this.name = name;
        this.code = code;
        this.discoveryPort = discoveryPort;
        this.target = target ? { ...target } : null;
        this.discovered = new Map();
        this.ls = null;
        this.status = target ? 'searching' : 'unset';
        this.live = null;     // kept when the connection drops, so the last notes stay up
        this.deck = null;
        this.remote = null;
        this.address = '';
        this.lastMsg = 0;
        this.everConnected = false;
        this.retry = null;
        this.udp = null;
        this.timer = null;
        this.running = false;
        this.discoveryError = '';
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.udp.on('error', err => {
            this.discoveryError = 'AUTOMATIC DISCOVERY UNAVAILABLE (' + String(err.code || err.message) + '). TYPE THE IP ADDRESS INSTEAD.';
            this.emit('change');
        });
        this.udp.on('message', (buf, rinfo) => this.onBeacon(buf, rinfo));
        this.udp.bind(this.discoveryPort);
        this.connect();
        this.timer = setInterval(() => this.tick(), 500);
    }

    stop() {
        this.running = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        if (this.udp) { try { this.udp.close(); } catch (e) { /* closed */ } }
        this.udp = null;
        this.disconnect();
    }

    onBeacon(buf, rinfo) {
        if (buf.length > 4096) return;
        let b;
        try { b = JSON.parse(buf.toString('utf8')); } catch (e) { return; }
        if (!b || b.app !== APP || typeof b.id !== 'string' || b.id === this.id) return;
        const entry = {
            id: str(b.id, 64), name: str(b.name, 100), role: ROLES.includes(b.role) ? b.role : 'main',
            port: int(b.port, 1, 65535), address: rinfo.address, sameCode: b.tag === codeTag(this.code), lastSeen: Date.now()
        };
        const old = this.discovered.get(entry.id);
        this.discovered.set(entry.id, entry);
        if (!old || old.address !== entry.address || old.name !== entry.name || old.role !== entry.role || old.sameCode !== entry.sameCode) this.emit('change');
        // Waiting for this sender (or its address changed): connect straight away
        if (this.target && this.target.id === entry.id && entry.sameCode && !this.ls) this.connect();
    }

    setCode(code) {
        if (code === this.code) return;
        this.code = code;
        for (const d of this.discovered.values()) d.sameCode = false; // re-checked on the next beacon
        this.disconnect();
        this.connect();
        this.emit('change');
    }

    // Pair with a sender (or null to unpair)
    setTarget(target) {
        this.disconnect();
        this.target = target ? { ...target } : null;
        this.status = this.target ? 'searching' : 'unset';
        this.live = null;
        this.deck = null;
        this.remote = null;
        this.address = '';
        this.everConnected = false;
        this.connect();
        this.emit('change');
    }

    disconnect() {
        if (this.retry) { clearTimeout(this.retry); this.retry = null; }
        if (this.ls) { const ls = this.ls; this.ls = null; ls.removeAllListeners(); ls.close(); }
    }

    scheduleRetry(ms) {
        if (!this.running || this.retry || !this.target) return;
        this.retry = setTimeout(() => { this.retry = null; this.connect(); }, ms);
    }

    connect() {
        if (!this.running || !this.target || this.ls) return;
        const seen = this.target.id && this.discovered.get(this.target.id);
        const host = (seen && seen.address) || this.target.address;
        const port = (seen && seen.port) || this.target.port || DEFAULT_PORT;
        if (!host) { this.setStatus(this.everConnected ? 'lost' : 'searching'); return; } // waits for its beacon
        const socket = net.connect({ host, port });
        const ls = new LineSocket(socket);
        this.ls = ls;
        this.address = host;
        if (!this.everConnected) this.setStatus('connecting');
        const connectTimer = setTimeout(() => ls.close(), 4000);
        socket.on('connect', () => {
            clearTimeout(connectTimer);
            this.lastMsg = Date.now();
            ls.send({ type: 'hello', app: APP, v: PROTOCOL, code: codeHash(this.code), id: this.id, name: this.name });
        });
        ls.on('message', msg => this.onMessage(msg));
        ls.on('close', () => {
            clearTimeout(connectTimer);
            if (this.ls !== ls) return;
            this.ls = null;
            const refused = ['bad-code', 'wrong-sender'].includes(this.status);
            if (!refused) this.setStatus(this.everConnected ? 'lost' : 'unreachable');
            this.scheduleRetry(refused ? 5000 : 1500);
        });
    }

    onMessage(msg) {
        this.lastMsg = Date.now();
        if (msg.type === 'welcome') {
            const remoteId = str(msg.id, 64);
            if (this.target.id && remoteId && remoteId !== this.target.id) {
                // The address now belongs to a different PC (new DHCP lease); keep looking for ours
                this.status = 'wrong-sender';
                this.ls.close();
                this.emit('change');
                return;
            }
            this.remote = { id: remoteId, name: str(msg.name, 100), role: ROLES.includes(msg.role) ? msg.role : 'main' };
            const t = this.target;
            if (t.id !== remoteId || t.name !== this.remote.name || t.role !== this.remote.role || t.address !== this.address) {
                // Remember who we paired with, so it's found by id next time even if its address changes
                this.target = { ...t, id: remoteId, name: this.remote.name, role: this.remote.role, address: this.address };
                this.emit('target', this.target);
            }
            this.everConnected = true;
            this.setStatus('connected');
        } else if (msg.type === 'live') {
            this.live = cleanLive(msg.live);
            this.emit('change');
        } else if (msg.type === 'deck') {
            this.deck = cleanDeck(msg.deck);
            this.emit('change');
        } else if (msg.type === 'refused') {
            this.setStatus('bad-code');
        }
        // 'hb' only refreshes lastMsg
    }

    setStatus(status) {
        if (this.status === status) return;
        this.status = status;
        this.emit('change');
    }

    tick() {
        const now = Date.now();
        if (this.ls && this.status === 'connected') {
            if (now - this.lastMsg > TIMEOUT_MS) this.ls.close(); // went quiet: pulled cable, sleeping PC...
            else this.ls.send({ type: 'hb' });
        }
        let changed = false;
        for (const [id, d] of this.discovered) {
            if (now - d.lastSeen > 5000) { this.discovered.delete(id); changed = true; }
        }
        if (changed) this.emit('change');
    }

    // Connected and the sender's PowerPoint is showing a presentation
    healthy() {
        return this.status === 'connected' && !!this.live && this.live.status === 'ok';
    }

    snapshot() {
        const now = Date.now();
        return {
            set: !!this.target,
            id: this.target ? this.target.id || '' : '',
            name: (this.remote && this.remote.name) || (this.target && (this.target.name || this.target.address)) || '',
            role: (this.remote && this.remote.role) || (this.target && this.target.role) || '',
            address: this.address || (this.target && this.target.address) || '',
            status: this.status,
            ppt: this.live ? this.live.status : null,
            healthy: this.healthy(),
            discoveryError: this.discoveryError,
            discovered: [...this.discovered.values()]
                .filter(d => now - d.lastSeen <= 5000)
                .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'main' ? -1 : 1))
                .map(d => ({ id: d.id, name: d.name, role: d.role, address: d.address, port: d.port, sameCode: d.sameCode }))
        };
    }
}


module.exports = { NetSender, NetReceiver, deckHash, localAddresses, DEFAULT_PORT, DISCOVERY_PORT, codeHash };
