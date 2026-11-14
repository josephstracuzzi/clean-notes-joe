// Builds "test_decks/Clean Notes Joe Test Deck.pptx": 10 slides on Canadian history whose notes cover the cases
// worth checking before a show. No dependencies: it takes the committed deck as a template (its theme, layouts
// and the hidden flag on slide 8) and rewrites every slide title, slide text and set of notes.
// Usage (from the project folder): node tools/make-test-deck.js [template.pptx]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'test_decks', 'Clean Notes Joe Test Deck.pptx');
const TEMPLATE = process.argv[2] || OUT;

// [title, what the slide tests, notes (paragraphs; \v is a soft line break; null = no notes)]
const SLIDES = [
    ['1. Welcome',
        'Very short notes: should be big, auto-fit to the max size.',
        ['Good evening, and welcome to a short history of Canada.']],
    ['2. Agenda',
        'A few short lines: each is its own paragraph.',
        ['Tonight, three stories:', '1. Confederation, 1867', '2. A railway from sea to sea', '3. The Klondike Gold Rush',
            'Questions at the end.']],
    ['3. No notes',
        'This slide has no speaker notes: the output shows the empty text.',
        null],
    ['4. Confederation',
        'A single medium paragraph: should fit on screen without scrolling.',
        ['On the first of July, 1867, the British North America Act joined Nova Scotia, New Brunswick and the Province '
            + 'of Canada, split into Ontario and Quebec, into a new country. John A. Macdonald became its first prime '
            + 'minister. Manitoba followed in 1870, British Columbia in 1871 and Prince Edward Island in 1873.']],
    ['5. The railway',
        'Too long to fit even at the minimum size: auto-scroll starts after the start delay.',
        ['When British Columbia joined Confederation in 1871, it did so on a promise: a railway linking the Pacific coast '
            + 'to the rest of the country, to be started within two years and finished within ten. It was an enormous '
            + 'gamble for a country of fewer than four million people. The line would have to cross the rocky Canadian '
            + 'Shield north of Lake Superior, more than a thousand kilometres of open prairie, and then several mountain '
            + 'ranges before it reached the sea.',
        'The project nearly ended before it began. In 1873 it came out that the company hoping to build the line had '
            + 'given large sums to Macdonald\'s Conservatives during the previous election. The Pacific Scandal brought '
            + 'down the government, and for several years the railway moved slowly, built in pieces with public money. '
            + 'When Macdonald returned to power in 1878, he made the railway the centre of his National Policy, along with '
            + 'tariffs to protect Canadian industry and settlement of the West.',
        'In 1881 a new syndicate formed the Canadian Pacific Railway, and work began in earnest. The American engineer '
            + 'William Van Horne drove the crews hard, laying track across the prairies at a pace few thought possible. '
            + 'In British Columbia, much of the hardest work fell to thousands of Chinese labourers, who blasted tunnels '
            + 'and cut ledges through the Fraser Canyon for lower wages than other workers. Many of them died, and when '
            + 'the work was done, the government that had relied on them placed a head tax on Chinese immigrants.',
        'On the seventh of November, 1885, at Craigellachie in the Monashee Mountains, Donald Smith drove the last spike, '
            + 'an ordinary iron one. The ceremony was short. The next summer the first scheduled passenger train left '
            + 'Montreal and reached Port Moody, on the Pacific, six days later. The railway carried settlers west and '
            + 'grain east, and for many Canadians it became a symbol of the country itself: a nation held together by '
            + 'two thin lines of steel.',
        'Before we move on, it is worth remembering that the railway also changed the West for the people who already '
            + 'lived there. The same line that carried new settlers also carried soldiers to put down the North-West '
            + 'Resistance in 1885, the year it was finished.']],
    ['6. From colonies to country',
        'A full script: tests long scrolling, pause, TOP and dragging the scroll bar.',
        ['Long before any European ship reached these shores, the land that became Canada was home to hundreds of '
            + 'Indigenous nations, from the Haudenosaunee of the Great Lakes to the Inuit of the Arctic and the many '
            + 'peoples of the Pacific coast. They traded across the continent, governed themselves, and knew this land '
            + 'in a way that newcomers would depend on for centuries.',
        'In 1608, Samuel de Champlain founded a trading post at Québec on the St. Lawrence River. New France grew slowly, '
            + 'built on the fur trade and on alliances with Indigenous nations. French explorers, traders and missionaries '
            + 'travelled deep into the interior, and by the 1700s French claims stretched from the Gulf of St. Lawrence '
            + 'to the Gulf of Mexico.',
        'Britain and France fought for control of North America for most of a century. In September 1759, British '
            + 'troops under James Wolfe defeated the French under Louis-Joseph de Montcalm on the Plains of Abraham, '
            + 'outside the walls of Québec. Both generals died of their wounds. With the Treaty of Paris in 1763, France '
            + 'gave up almost all of its North American territory.',
        'Britain now ruled tens of thousands of French-speaking Catholics. The Quebec Act of 1774 allowed them to keep '
            + 'their faith, their language and French civil law, a decision that shaped the country for good. When the '
            + 'American colonies rebelled, many of those who stayed loyal to the Crown moved north, settling in what '
            + 'became Ontario, New Brunswick and Nova Scotia.',
        'In the War of 1812, the United States invaded the British colonies more than once. British soldiers, Canadian '
            + 'militia and Indigenous allies, among them the Shawnee leader Tecumseh, turned back the attacks. Neither '
            + 'side gained territory, but the war gave the colonies a story of their own and a lasting suspicion of '
            + 'their southern neighbour.',
        'By the 1830s, many colonists resented being governed by small groups of appointed officials. Rebellions broke '
            + 'out in Upper and Lower Canada in 1837 and 1838. They were quickly put down, but they led to reform. In 1848, '
            + 'Nova Scotia and then the Province of Canada won responsible government: ministers would answer to the '
            + 'elected assembly, not to the governor.',
        'Over the next twenty years, colonial leaders began to talk about joining together. They wanted a railway, a '
            + 'larger market, and protection from an American army that had grown huge during the Civil War. Meetings '
            + 'at Charlottetown and Québec in 1864, and in London in 1866, worked out the terms. On July 1, 1867, the '
            + 'Dominion of Canada was born, with four provinces.',
        'The new country grew quickly. In 1869 it bought Rupert\'s Land, the vast territory of the Hudson\'s Bay Company. '
            + 'The Métis of the Red River, led by Louis Riel, resisted being taken over without a say, and their resistance '
            + 'led to the creation of Manitoba in 1870. British Columbia joined in 1871 and Prince Edward Island in 1873.',
        'The promise of a railway kept British Columbia in Confederation, and the Canadian Pacific Railway was finished '
            + 'in 1885. That same year, the Métis and some of their First Nations allies rose again in the North-West '
            + 'Resistance. Riel was captured, tried for treason and hanged in Regina, a decision that divided English and '
            + 'French Canada for generations.',
        'In 1896, gold was found on a tributary of the Klondike River in the Yukon. Over the next two years, about a '
            + 'hundred thousand people set out for the goldfields; perhaps a third of them arrived. Dawson City grew from a '
            + 'swampy flat into a town of thousands. The Yukon became a separate territory in 1898, and the North-West '
            + 'Mounted Police kept unusual order.',
        'In the First World War, more than six hundred thousand Canadians enlisted, out of a population of about eight '
            + 'million. In April 1917, the four divisions of the Canadian Corps fought together for the first time and '
            + 'captured Vimy Ridge in France. The victory cost more than ten thousand casualties, and it is often called '
            + 'the moment Canada became a nation.',
        'Independence came step by step rather than all at once. The Statute of Westminster in 1931 gave Canada full '
            + 'control of its own laws. Newfoundland joined in 1949, the maple leaf flag was raised in 1965, and in 1982 '
            + 'the constitution came home, with a Charter of Rights and Freedoms. In 1999, Nunavut became the newest '
            + 'territory, governed largely by the Inuit who live there.']],
    ['7. Line breaks and blank lines',
        'Soft line breaks inside a paragraph, and empty paragraphs between sections.',
        ['The first four provinces:\vOntario and Quebec\vNova Scotia and New Brunswick', '', '',
            'After two empty paragraphs: the last to join, Newfoundland, in 1949', '', 'Final line']],
    ['8. Hidden slide',
        'Hidden in PowerPoint: marked HIDDEN in the slide list (the slideshow skips it).',
        ['Cut for time: the Hudson\'s Bay Company, chartered in 1670.']],
    ['9. Special characters',
        'Accents, quotes, symbols, other scripts and a very long word.',
        ['Québec, Montréal, Trois-Rivières — “Je me souviens” is Québec\'s motto, and ‘Dominion’ was the old name.',
            'Symbols: & < > © ® ™ € £ ¥ ✓ ★ → ½ −40 °C',
            'Other scripts: ᐃᓄᒃᑎᑐᑦ (Inuktitut) · 日本語 · Ελληνικά · Русский · العربية',
            'A long address that has to wrap: https://example.com/a/very/long/path/that/keeps/going/and/going/without/any/spaces/at/all']],
    ['10. Thank you',
        'Last slide: NEXT is disabled here. All caps notes test the UPPERCASE setting.',
        ['THANK YOU — MERCI!', 'THE FLOOR IS OPEN FOR QUESTIONS.']]
];
const HIDDEN = 8;

// ---- zip (read the template, write the deck) ----
function readZip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('template is not a .pptx');
    const count = buf.readUInt16LE(eocd + 10);
    let ptr = buf.readUInt32LE(eocd + 16);
    const entries = [];
    for (let n = 0; n < count; n++) {
        const method = buf.readUInt16LE(ptr + 10);
        const compSize = buf.readUInt32LE(ptr + 20);
        const nameLen = buf.readUInt16LE(ptr + 28);
        const extraLen = buf.readUInt16LE(ptr + 30);
        const commentLen = buf.readUInt16LE(ptr + 32);
        const local = buf.readUInt32LE(ptr + 42);
        const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + compSize);
        entries.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });
        ptr += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

function writeZip(entries) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const comp = zlib.deflateRawSync(data);
        const crc = zlib.crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18);
        local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
        locals.push(local, nameBuf, comp);
        centrals.push(central, nameBuf);
        offset += 30 + nameBuf.length + comp.length;
    }
    const centralBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBuf, end]);
}

// ---- XML ----
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Paragraphs for a text box; \v becomes a soft line break, an empty string an empty paragraph
function paragraphs(list, rPr = '') {
    return list.map(p => {
        if (!p) return '<a:p/>';
        const runs = p.split('\v').map(t => `<a:r>${rPr}<a:t>${esc(t)}</a:t></a:r>`);
        return `<a:p>${runs.join('<a:br/>')}</a:p>`;
    }).join('');
}

// Replaces the paragraphs of the shape whose placeholder tag matches
function setShapeText(xml, phMatch, parasXml) {
    let done = false;
    const out = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, sp => {
        if (done || !phMatch.test(sp)) return sp;
        done = true;
        return sp.replace(/(<p:txBody>[\s\S]*?<a:lstStyle\/>)[\s\S]*?(<\/p:txBody>)/, `$1${parasXml}$2`);
    });
    if (!done) throw new Error('shape not found: ' + phMatch);
    return out;
}

// ---- build ----
const entries = readZip(fs.readFileSync(TEMPLATE));
const file = (name) => entries.find(e => e.name === name);
const words = (list) => list ? list.join(' ').split(/\s+/).filter(Boolean).length : 0;

SLIDES.forEach(([title, what, notes], i) => {
    const n = i + 1;
    const slide = file(`ppt/slides/slide${n}.xml`);
    let xml = slide.data.toString('utf8');
    xml = setShapeText(xml, /<p:ph type="title"\/>/, paragraphs([title]));
    xml = setShapeText(xml, /<p:ph idx="1"\/>/, paragraphs(['Tests: ' + what, notes ? `Notes: ${words(notes)} words` : 'Notes: none'], '<a:rPr sz="2800"/>'));
    xml = xml.replace(/<p:sld\b[^>]*>/, tag => (n === HIDDEN ? (/ show="/.test(tag) ? tag : tag.replace('<p:sld', '<p:sld show="0"')) : tag.replace(/ show="[^"]*"/, '')));
    slide.data = Buffer.from(xml, 'utf8');

    const rels = file(`ppt/slides/_rels/slide${n}.xml.rels`).data.toString('utf8');
    const notesTarget = (rels.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/) || [])[1];
    if (!notes) {
        if (notesTarget) throw new Error(`slide ${n} should have no notes, but the template has some`);
        return;
    }
    if (!notesTarget) throw new Error(`slide ${n} has no notes slide in the template`);
    const notesFile = file(`ppt/notesSlides/${notesTarget}`);
    notesFile.data = Buffer.from(setShapeText(notesFile.data.toString('utf8'), /<p:ph type="body"/, paragraphs(notes)), 'utf8');
});

fs.writeFileSync(OUT, writeZip(entries));
console.log('wrote ' + path.relative(process.cwd(), OUT));
SLIDES.forEach(([title, , notes]) => console.log(`  ${title}: ${notes ? words(notes) + ' words' : 'no notes'}`));
