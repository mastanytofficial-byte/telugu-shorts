const fs = require('fs');
const path = require('path');
const child = require('child_process');

// Stable launcher: index.js remains the single source of truth.
// No generated vN runtime files and no source rewriting/regex patching.
const SOURCE = path.join(__dirname, 'index.js');
const RUNTIME = path.join(__dirname, '.index.runtime.js');
const QUALITY_GUARD = path.join(__dirname, 'narration_quality_guard.js');
const EXPECTED_GUARD = 'NARRATION_QUALITY_GUARD_V4';

child.execFileSync(process.execPath, ['--check', SOURCE], { stdio: 'inherit' });
child.execFileSync(process.execPath, ['--check', QUALITY_GUARD], { stdio: 'inherit' });

fs.copyFileSync(SOURCE, RUNTIME);
child.execFileSync(process.execPath, ['--check', RUNTIME], { stdio: 'inherit' });

const guard = require(QUALITY_GUARD);
if (!guard || guard.marker !== EXPECTED_GUARD) {
  throw new Error(`Narration quality guard ${EXPECTED_GUARD} failed to load — refusing to run the video pipeline.`);
}
console.log(`${EXPECTED_GUARD}: source + runtime syntax checks passed; narration quality guard loaded.`);
require(RUNTIME);
