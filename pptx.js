// ============================================================================
// Clean Notes Joe - .pptx and .odp reader
// Reads slide titles and speaker notes straight from the file, with no dependencies:
// a .pptx (PowerPoint) or .odp (LibreOffice Impress) is a zip of XML files, and Node's zlib can
// inflate the entries.
// ============================================================================

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// ---- Minimal zip reader (central directory) ----
function readZip(buf) {
    // End of central directory record: last 22 bytes + up to 64KB comment
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('NOT A POWERPOINT (.PPTX) OR LIBREOFFICE (.ODP) FILE');
    const count = buf.readUInt16LE(eocd + 10);
    let ptr = buf.readUInt32LE(eocd + 16);
    const entries = new Map();
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('DAMAGED .PPTX FILE');
        const method = buf.readUInt16LE(ptr + 10);
        const compSize = buf.readUInt32LE(ptr + 20);
        const nameLen = buf.readUInt16LE(ptr + 28);
        const extraLen = buf.readUInt16LE(ptr + 30);
        const commentLen = buf.readUInt16LE(ptr + 32);
        const localOffset = buf.readUInt32LE(ptr + 42);
        const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
        entries.set(name, { method, compSize, localOffset });
        ptr += 46 + nameLen + extraLen + commentLen;
    }
    return {
        has: (name) => entries.has(name),
        text(name) {
            const e = entries.get(name);
            if (!e) return null;
            const lnameLen = buf.readUInt16LE(e.localOffset + 26);
            const lextraLen = buf.readUInt16LE(e.localOffset + 28);
            const start = e.localOffset + 30 + lnameLen + lextraLen;
            const data = buf.subarray(start, start + e.compSize);
            if (e.method === 0) return data.toString('utf8');
            if (e.method === 8) return zlib.inflateRawSync(data).toString('utf8');
            throw new Error('UNSUPPORTED ZIP COMPRESSION IN .PPTX');
        }
    };
}

// ---- XML helpers (the Office XML we need is regular enough for patterns) ----
function decodeEntities(s) {
    return s
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function attr(tag, name) {
    const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"'));
    return m ? decodeEntities(m[1]) : null;
}

// Relationship id -> target path (resolved against the part's folder)
function readRels(zip, partPath) {
    const relsPath = path.posix.join(path.posix.dirname(partPath), '_rels', path.posix.basename(partPath) + '.rels');
    const xml = zip.text(relsPath);
    const rels = new Map();
    if (!xml) return rels;
    for (const tag of xml.match(/<Relationship\b[^>]*>/g) || []) {
        const id = attr(tag, 'Id');
        const target = attr(tag, 'Target');
        const type = attr(tag, 'Type') || '';
        if (!id || !target || attr(tag, 'TargetMode') === 'External') continue;
        const resolved = target.startsWith('/')
            ? target.slice(1)
            : path.posix.normalize(path.posix.join(path.posix.dirname(partPath), target));
        rels.set(id, { target: resolved, type });
    }
    return rels;
}

// Text of a <p:txBody>: paragraphs (<a:p>) separated by \n; a soft line break (<a:br/>, Shift+Enter)
// is U+2028 so it stays inside its paragraph. At most one blank paragraph is kept between sections.
function bodyText(spXml) {
    const paras = [];
    const paraRe = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>|<a:p(?:\s[^>]*)?\/>/g;
    let m;
    while ((m = paraRe.exec(spXml))) {
        const inner = m[1] || '';
        let line = '';
        const tokRe = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>/g;
        let t;
        while ((t = tokRe.exec(inner))) {
            line += t[1] !== undefined ? decodeEntities(t[1]) : '\u2028';
        }
        paras.push(line);
    }
    return paras.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The shapes of a slide/notes part, with their placeholder type
function shapes(xml) {
    const out = [];
    for (const sp of xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) || []) {
        const ph = sp.match(/<p:ph\b[^>]*>/);
        out.push({ xml: sp, phType: ph ? (attr(ph[0], 'type') || 'body') : null, phIdx: ph ? attr(ph[0], 'idx') : null });
    }
    return out;
}

function notesFromXml(xml) {
    if (!xml) return '';
    // The notes text box is the body placeholder (sometimes written without a type, idx 1)
    const sp = shapes(xml).find(s => s.phType === 'body');
    return sp ? bodyText(sp.xml) : '';
}

function titleFromXml(xml) {
    if (!xml) return '';
    const sp = shapes(xml).find(s => s.phType === 'title' || s.phType === 'ctrTitle');
    return sp ? bodyText(sp.xml).replace(/\s+/g, ' ').trim() : '';
}

// ---- LibreOffice Impress (.odp) ----
// Text of an ODF text box: paragraphs (<text:p>, <text:h>, also inside lists) separated by \n; a soft line
// break (<text:line-break/>, Shift+Enter) is U+2028, as in bodyText
function odfText(xml) {
    const paras = [];
    const paraRe = /<text:(p|h)\b[^>]*\/>|<text:(p|h)\b[^>]*>([\s\S]*?)<\/text:\2>/g;
    let m;
    while ((m = paraRe.exec(xml))) {
        const inner = (m[3] || '')
            .replace(/<text:line-break\s*\/>/g, ' ')
            .replace(/<text:tab\s*\/>/g, '\t')
            .replace(/<text:s\b[^>]*\/>/g, tag => ' '.repeat(Math.max(1, parseInt(attr(tag, 'text:c') || '1', 10))))
            .replace(/<[^>]+>/g, '');
        paras.push(decodeEntities(inner));
    }
    return paras.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The text box of the frame with that presentation:class ('title', 'notes') in a piece of a page
function odfFrameText(xml, cls) {
    for (const frame of xml.match(/<draw:frame\b[\s\S]*?<\/draw:frame>/g) || []) {
        if (attr(frame.match(/<draw:frame\b[^>]*>/)[0], 'presentation:class') === cls) return odfText(frame);
    }
    return '';
}

function readOdp(zip) {
    const xml = zip.text('content.xml');
    if (!xml) throw new Error('NOT A LIBREOFFICE (.ODP) FILE');
    // Hidden slides: their page style says presentation:visibility="hidden"
    const hiddenStyles = new Set();
    for (const st of xml.match(/<style:style\b[^>]*style:family="drawing-page"[^>]*>[\s\S]*?<\/style:style>/g) || []) {
        if (/presentation:visibility="hidden"/.test(st)) hiddenStyles.add(attr(st.match(/<style:style\b[^>]*>/)[0], 'style:name'));
    }
    const slides = [];
    for (const page of xml.match(/<draw:page\b[\s\S]*?<\/draw:page>/g) || []) {
        const pageTag = page.match(/<draw:page\b[^>]*>/)[0];
        const notesPart = (page.match(/<presentation:notes\b[\s\S]*?<\/presentation:notes>/) || [''])[0];
        slides.push({
            title: odfFrameText(page.replace(notesPart, ''), 'title').replace(/\s+/g, ' ').trim(),
            notes: odfFrameText(notesPart, 'notes'),
            hidden: hiddenStyles.has(attr(pageTag, 'draw:style-name'))
        });
    }
    return { slides };
}

// Returns { slides: [{ title, notes, hidden }] } in presentation order
function readPresentation(filePath) {
    const zip = readZip(fs.readFileSync(filePath));
    if ((zip.text('mimetype') || '').trim() === 'application/vnd.oasis.opendocument.presentation') return readOdp(zip);
    const presPath = 'ppt/presentation.xml';
    const presXml = zip.text(presPath);
    if (!presXml) throw new Error('NOT A POWERPOINT (.PPTX) OR LIBREOFFICE (.ODP) FILE');
    const presRels = readRels(zip, presPath);
    const slides = [];
    for (const tag of presXml.match(/<p:sldId\b[^>]*>/g) || []) {
        const rel = presRels.get(attr(tag, 'r:id'));
        if (!rel) continue;
        const slideXml = zip.text(rel.target) || '';
        const slideRels = readRels(zip, rel.target);
        const notesRel = [...slideRels.values()].find(r => r.type.endsWith('/notesSlide'));
        const sldTag = slideXml.match(/<p:sld\b[^>]*>/);
        slides.push({
            title: titleFromXml(slideXml),
            notes: notesRel ? notesFromXml(zip.text(notesRel.target)) : '',
            hidden: !!sldTag && attr(sldTag[0], 'show') === '0'
        });
    }
    return { slides };
}

module.exports = { readPresentation };
