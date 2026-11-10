// Every version in package.json must have its own section in CHANGELOG.md
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');

assert.match(version, /^\d+\.\d+\.\d+$/, `package.json version "${version}" is not MAJOR.MINOR.PATCH`);
assert.ok(changelog.includes(`## [${version}]`), `CHANGELOG.md has no "## [${version}]" section. Add one before releasing.`);
console.log(`version ${version}: changelog entry found`);
