// Network sync: run with npm test (plain Node, real sockets on this machine)
const assert = require('assert');
const net = require('net');
const { NetSender, NetReceiver, deckHash } = require('../network');

const DISCOVERY = 47900 + Math.floor(Math.random() * 500);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(what, cond, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return; await wait(25); }
    throw new Error('timed out waiting for: ' + what);
}
const listening = s => until('sender listening', () => s.server && s.server.listening);
const live = (index, status = 'ok') => ({ status, name: 'talk.pptx', index, count: 10, title: 'T' + index, notes: 'notes ' + index });
const deck = (n) => { const slides = Array.from({ length: n }, (_, i) => ({ title: 'S' + i, notes: 'N' + i, hidden: false })); return { name: 'talk.pptx', slides, hash: deckHash(slides) }; };

(async () => {
    // Main and backup PowerPoint PCs
    const pptMain = new NetSender({ id: 'pc-main', name: 'STAGE-A', role: 'main', port: 0, discoveryPort: DISCOVERY });
    const pptBackup = new NetSender({ id: 'pc-backup', name: 'STAGE-B', role: 'backup', port: 0, discoveryPort: DISCOVERY });
    pptMain.start(); pptBackup.start();
    await listening(pptMain); await listening(pptBackup);
    pptMain.setLive(live(3)); pptMain.setDeck(deck(10));
    pptBackup.setLive(live(7)); pptBackup.setDeck(deck(10));

    // Main and backup notes PCs
    const notesMain = new NetReceiver({ id: 'notes-a', name: 'NOTES-A', discoveryPort: DISCOVERY });
    const notesBackup = new NetReceiver({ id: 'notes-b', name: 'NOTES-B', discoveryPort: DISCOVERY });
    const learned = [];
    notesMain.on('target', t => learned.push(t));
    notesMain.start(); notesBackup.start();

    // --- Discovery lists both senders, MAIN first, with their roles
    await until('both discovered', () => notesMain.snapshot().discovered.length === 2);
    assert.deepStrictEqual(notesMain.snapshot().discovered.map(d => [d.name, d.role, d.sameCode]), [['STAGE-A', 'main', true], ['STAGE-B', 'backup', true]]);
    console.log('ok  discovery lists both senders with their MAIN / BACKUP role');

    // --- Each notes PC is paired with its own sender
    notesMain.setTarget({ id: 'pc-main' });
    notesBackup.setTarget({ id: 'pc-backup' });
    await until('both healthy', () => notesMain.healthy() && notesBackup.healthy());
    assert.strictEqual(notesMain.live.notes, 'notes 3');
    assert.strictEqual(notesBackup.live.notes, 'notes 7');
    assert.strictEqual(notesMain.deck.slides.length, 10);
    assert.strictEqual(learned[0].name, 'STAGE-A');
    assert.strictEqual(learned[0].role, 'main');
    await until('senders list receivers', () => pptMain.clientNames().length === 1 && pptBackup.clientNames().length === 1);
    assert.strictEqual(pptMain.clientNames()[0].name, 'NOTES-A');
    assert.strictEqual(pptBackup.clientNames()[0].name, 'NOTES-B');
    console.log('ok  main notes follows main PowerPoint, backup follows backup; senders list their receivers');

    // --- Slide changes arrive
    const t0 = Date.now();
    pptMain.setLive(live(4));
    await until('slide 4', () => notesMain.live.index === 4);
    console.log(`ok  slide change arrives in ${Date.now() - t0} ms`);

    // --- PowerPoint closes: connected, not healthy, no switching to anything else
    pptMain.setLive(live(4, 'not-running'));
    await until('ppt closed', () => notesMain.snapshot().ppt === 'not-running');
    assert.strictEqual(notesMain.snapshot().status, 'connected');
    assert.ok(!notesMain.healthy());
    assert.strictEqual(notesMain.target.id, 'pc-main');
    pptMain.setLive(live(4));
    console.log('ok  PowerPoint closing is reported; the pairing never changes by itself');

    // --- Main PowerPoint PC disappears: LOST, last notes kept, reconnects after restart on a new port
    pptMain.stop();
    await until('lost', () => notesMain.status === 'lost');
    assert.strictEqual(notesMain.live.notes, 'notes 4');
    const pptMain2 = new NetSender({ id: 'pc-main', name: 'STAGE-A', role: 'main', port: 0, discoveryPort: DISCOVERY });
    pptMain2.start(); await listening(pptMain2);
    pptMain2.setLive(live(5));
    await until('reconnected', () => notesMain.healthy() && notesMain.live.index === 5, 6000);
    console.log('ok  connection lost keeps the last notes, then reconnects by itself (found again by id)');

    // --- Pulled cable: connection open but silent -> noticed by the heartbeat timeout
    await wait(1200);
    clearInterval(pptMain2.timer);
    for (const c of pptMain2.clients) c.ls.socket.pause();
    const t1 = Date.now();
    await until('silence noticed', () => notesMain.status === 'lost', 6000);
    const silentMs = Date.now() - t1;
    assert.ok(silentMs >= 1500 && silentMs <= 4000, 'silence noticed in ' + silentMs + ' ms');
    assert.strictEqual(notesMain.live.notes, 'notes 5');
    console.log(`ok  a silent connection (pulled cable) is noticed after ${silentMs} ms, last notes kept`);
    pptMain2.stop();

    // --- Show code: a wrong code is refused, the right one connects
    pptBackup.configure({ code: '4821' });
    await until('refused', () => notesBackup.status === 'bad-code', 6000);
    assert.ok(!notesBackup.healthy());
    notesBackup.setCode('4821');
    await until('accepted with code', () => notesBackup.healthy(), 8000);
    console.log('ok  show code: wrong code refused, matching code connects');

    // --- Senders with another show code are marked in the list
    await until('code mismatch shown', () => {
        const d = notesMain.snapshot().discovered.find(x => x.id === 'pc-backup');
        return d && d.sameCode === false;
    });
    console.log('ok  senders with a different show code are marked in the list');

    // --- Typed IP address works without discovery, and learns the id
    const notesTyped = new NetReceiver({ id: 'notes-c', name: 'NOTES-C', code: '4821', discoveryPort: DISCOVERY + 1 });
    notesTyped.start();
    notesTyped.setTarget({ address: '127.0.0.1', port: pptBackup.port });
    await until('typed ip connects', () => notesTyped.healthy());
    assert.strictEqual(notesTyped.target.id, 'pc-backup');
    notesTyped.stop();
    console.log('ok  a typed IP address connects and remembers which PC it is');

    // --- A remembered address now used by a different PC (DHCP) is not followed
    const notesWrong = new NetReceiver({ id: 'notes-d', name: 'NOTES-D', code: '4821', discoveryPort: DISCOVERY + 2 });
    notesWrong.start();
    notesWrong.setTarget({ id: 'pc-somebody-else', address: '127.0.0.1', port: pptBackup.port });
    await until('wrong sender', () => notesWrong.status === 'wrong-sender');
    notesWrong.stop();
    console.log('ok  refuses to follow a different PC at a remembered address');

    // --- Receivers can't send commands: anything but hello first closes the connection
    await new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port: pptBackup.port });
        s.on('connect', () => s.write(JSON.stringify({ type: 'live', live: live(9) }) + '\n'));
        s.on('close', resolve);
        s.on('error', reject);
        setTimeout(() => reject(new Error('not closed')), 3000);
    });
    assert.strictEqual(pptBackup.live.index, 7);
    console.log('ok  a connection that does not say hello is closed and changes nothing');

    // --- Unpair
    notesMain.setTarget(null);
    assert.strictEqual(notesMain.snapshot().status, 'unset');

    notesMain.stop(); notesBackup.stop(); pptBackup.stop();
    console.log('network: all tests passed');
    process.exit(0);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
