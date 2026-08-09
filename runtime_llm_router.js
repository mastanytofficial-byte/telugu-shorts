const fs = require('fs');
const path = require('path');
const child = require('child_process');

// Stable launcher: index.js remains the single source of truth.
// No generated vN runtime files and no source rewriting/regex patching.
const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');
const QUALITY_GUARD = path.join(__dirname, 'narration_quality_guard.js');

child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });
child.execFileSync(process.execPath, ['--check', QUALITY_GUARD], { stdio: 'inherit' });

fs.copyFileSync(SOURCE, RUNTIME);
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

const guard = require(QUALITY_GUARD);
if (!guard || guard.marker !== 'NARRATION_QUALITY_GUARD_V2') {
  throw new Error('Narration quality guard v2 failed to load — refusing to run the video pipeline.');
}
console.log('LLM_ROUTER_STABLE: source + runtime syntax checks passed; narration quality guard v2 loaded.');
require(RUNTIME);
