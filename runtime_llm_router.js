const fs = require('fs');
const path = require('path');
const child = require('child_process');

// Stable launcher: do NOT rewrite index.js with string/regex patches.
// Earlier versions generated .index.runtime.js by replacing callLLM(), and
// escaping/brace mistakes in that generated file caused recurring syntax
// errors (Invalid regular expression flags / Unexpected token }).
// The source file is now treated as the single source of truth.
const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');

// Validate the real source first. If index.js is invalid, fail here with the
// actual source error instead of manufacturing a second, harder-to-debug file.
child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });

// Copy byte-for-byte. No generated JavaScript, no regex replacement, no brace
// matching, and therefore no transformation-induced syntax errors.
fs.copyFileSync(SOURCE, RUNTIME);

// Validate the exact file that will be executed by npm start.
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

console.log('LLM_ROUTER_STABLE: index.js copied unchanged; source + runtime syntax checks passed.');
require(RUNTIME);
