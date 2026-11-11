// Run with: npm test
const assert = require('assert');
const path = require('path');
const { readPresentation } = require('../pptx');

const { slides } = readPresentation(path.join(__dirname, 'fixture.pptx'));
assert.strictEqual(slides.length, 5);
assert.deepStrictEqual(slides.map(s => s.title), ['Welcome', 'Line breaks', 'No notes', 'Hidden one', 'Unicode']);
assert.strictEqual(slides[0].notes, 'Welcome everyone.\nToday: results, roadmap & Q&A.');
assert.strictEqual(slides[1].notes, 'First line\u2028Second line <after> a break');
assert.strictEqual(slides[2].notes, '');
assert.strictEqual(slides[3].hidden, true);
assert.strictEqual(slides[0].hidden, false);
assert.strictEqual(slides[4].notes, 'Café — “quotes” ✓ 日本語');
assert.throws(() => readPresentation(__filename), /PPTX/);

// The same deck saved by LibreOffice Impress as .odp (fixture.odp) reads the same
const odp = readPresentation(path.join(__dirname, 'fixture.odp')).slides;
assert.deepStrictEqual(odp, slides);
console.log('pptx and odp reader: all tests passed');
